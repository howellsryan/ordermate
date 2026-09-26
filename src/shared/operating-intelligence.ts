export type IntelligenceSupplier = {
  supplierId: string;
  supplierName: string;
  supplierSku?: string | null;
  lastCostMinor?: number | null;
  leadTimeDays?: number | null;
  preferred?: boolean;
};

export type IncomingSupply = {
  daysFromNow: number;
  quantity: number;
};

export type IntelligenceInput = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  incoming_schedule?: IncomingSupply[];
  fulfilled_30d: number;
  fulfilled_prev_60d: number;
  cost_minor: number;
  threshold: number;
  target_stock: number;
  policy_custom: boolean;
  preferred_supplier_id?: string | null;
  effective_lead_time_days: number;
  suppliers: IntelligenceSupplier[];
};

export type PlanningContext = {
  demandAdjustmentPercent?: number;
  extraLeadTimeDays?: number;
};

export type ForecastPoint = {
  week: number;
  projected: number;
};

export type ReplenishmentScenario = {
  minimum: number;
  recommended: number;
  maximum: number;
};

export type OperatingIntelligenceRow = IntelligenceInput & {
  average_daily_demand: number;
  prior_daily_demand: number;
  forecast_daily_demand: number;
  trend_percent: number | null;
  trend_label: "rising" | "falling" | "stable" | "insufficient_history";
  safety_stock: number;
  buffer_days: number;
  projected_at_lead_time: number;
  days_of_cover: number | null;
  stockout_date: string | null;
  order_by_date: string | null;
  recommended_quantity: number;
  scenarios: ReplenishmentScenario;
  forecast_12_weeks: ForecastPoint[];
  risk: "critical" | "warning" | "watch" | "healthy";
  abc_class: "A" | "B" | "C";
  explanation: string[];
};

export type OperatingIntelligenceResponse = {
  generated_at: string;
  window_days: number;
  history_window_days: number;
  forecast_horizon_weeks: number;
  default_threshold: number;
  summary: {
    tracked_positions: number;
    at_risk: number;
    critical: number;
    projected_stockouts_30d: number;
    a_class_positions: number;
  };
  positions: OperatingIntelligenceRow[];
  suggestions: OperatingIntelligenceRow[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function isoDateFromOffset(todayIso: string, offsetDays: number) {
  const date = new Date(`${todayIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.floor(offsetDays)));
  return date.toISOString().slice(0, 10);
}

function normalizedIncomingSchedule(input: IntelligenceInput, fallbackLeadTimeDays: number) {
  const supplied = (input.incoming_schedule || [])
    .filter(item => Number.isFinite(item.daysFromNow) && Number.isFinite(item.quantity) && item.quantity > 0)
    .map(item => ({ daysFromNow: Math.max(0, Math.round(item.daysFromNow)), quantity: Math.max(0, Math.round(item.quantity)) }))
    .sort((a, b) => a.daysFromNow - b.daysFromNow);
  if (supplied.length) return supplied;
  return input.incoming > 0 ? [{ daysFromNow: fallbackLeadTimeDays, quantity: input.incoming }] : [];
}

function abcClasses(inputs: IntelligenceInput[]) {
  const ranked = inputs
    .map(input => ({ id: input.id, value: Math.max(0, input.fulfilled_30d + input.fulfilled_prev_60d) * Math.max(0, input.cost_minor) }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const total = ranked.reduce((sum, row) => sum + row.value, 0);
  const result = new Map<string, "A" | "B" | "C">();
  if (total <= 0) {
    for (const row of ranked) result.set(row.id, "C");
    return result;
  }

  let cumulative = 0;
  for (const row of ranked) {
    const shareBeforeRow = cumulative / total;
    result.set(row.id, shareBeforeRow < 0.8 ? "A" : shareBeforeRow < 0.95 ? "B" : "C");
    cumulative += row.value;
  }
  return result;
}

function demandSignals(input: IntelligenceInput, demandAdjustmentPercent: number) {
  const recentDaily = Math.max(0, input.fulfilled_30d) / 30;
  const priorDaily = Math.max(0, input.fulfilled_prev_60d) / 60;
  const hasPriorHistory = priorDaily > 0;
  const weighted = hasPriorHistory ? recentDaily * 0.7 + priorDaily * 0.3 : recentDaily;
  const rawTrend = hasPriorHistory ? (recentDaily - priorDaily) / priorDaily : 0;
  const trendFactor = clamp(1 + rawTrend * 0.35, 0.75, 1.25);
  const contextFactor = clamp(1 + demandAdjustmentPercent / 100, 0.1, 3);
  const forecastDaily = weighted * trendFactor * contextFactor;
  const trendPercent = hasPriorHistory ? Math.round(rawTrend * 100) : null;
  const trendLabel = !hasPriorHistory
    ? "insufficient_history"
    : rawTrend > 0.12 ? "rising" : rawTrend < -0.12 ? "falling" : "stable";
  return { recentDaily, priorDaily, forecastDaily, trendPercent, trendLabel } as const;
}

function forecastCurve(input: IntelligenceInput, forecastDaily: number, leadTimeDays: number) {
  const schedule = normalizedIncomingSchedule(input, leadTimeDays);
  const points: ForecastPoint[] = [];
  let projected = input.available;
  let previousDay = 0;
  for (let week = 1; week <= 12; week++) {
    const weekEndDay = week * 7;
    projected -= forecastDaily * (weekEndDay - previousDay);
    projected += schedule
      .filter(item => item.daysFromNow > previousDay && item.daysFromNow <= weekEndDay)
      .reduce((sum, item) => sum + item.quantity, 0);
    points.push({ week, projected: Math.round(projected) });
    previousDay = weekEndDay;
  }
  return points;
}

function projectedStockAtDay(input: IntelligenceInput, forecastDaily: number, day: number, leadTimeDays: number) {
  const arrivals = normalizedIncomingSchedule(input, leadTimeDays)
    .filter(item => item.daysFromNow <= day)
    .reduce((sum, item) => sum + item.quantity, 0);
  return Math.round(input.available + arrivals - forecastDaily * day);
}

function daysOfCoverWithIncoming(input: IntelligenceInput, forecastDaily: number, leadTimeDays: number) {
  if (forecastDaily <= 0) return null;
  const schedule = normalizedIncomingSchedule(input, leadTimeDays);
  let stock = input.available;
  for (let day = 0; day <= 365; day++) {
    stock += schedule.filter(item => item.daysFromNow === day).reduce((sum, item) => sum + item.quantity, 0);
    if (stock <= 0) return day;
    stock -= forecastDaily;
    if (stock <= 0) return day + 1;
  }
  return null;
}

function orderByOffsetWithIncoming(input: IntelligenceInput, forecastDaily: number, leadTimeDays: number, safetyStock: number) {
  if (forecastDaily <= 0) return null;
  for (let orderDay = 0; orderDay <= 365; orderDay++) {
    const projectedOnArrival = projectedStockAtDay(input, forecastDaily, orderDay + leadTimeDays, leadTimeDays);
    if (projectedOnArrival <= safetyStock) return orderDay;
  }
  return null;
}

export function applyPlanningContext(
  input: IntelligenceInput,
  abcClass: "A" | "B" | "C",
  todayIso: string,
  context: PlanningContext = {},
): OperatingIntelligenceRow {
  const demandAdjustmentPercent = clamp(context.demandAdjustmentPercent || 0, -90, 200);
  const extraLeadTimeDays = Math.round(clamp(context.extraLeadTimeDays || 0, 0, 120));
  const leadTimeDays = Math.max(1, Math.round(input.effective_lead_time_days + extraLeadTimeDays));
  const scenarioInput: IntelligenceInput = extraLeadTimeDays > 0 && input.incoming_schedule?.length
    ? { ...input, incoming_schedule: input.incoming_schedule.map(item => ({ ...item, daysFromNow: item.daysFromNow + extraLeadTimeDays })) }
    : input;
  const signals = demandSignals(input, demandAdjustmentPercent);
  const bufferDays = Math.max(3, Math.min(14, Math.ceil(leadTimeDays * 0.5)));
  const safetyStock = Math.max(input.threshold, Math.ceil(signals.forecastDaily * bufferDays));
  const projectedAtLead = projectedStockAtDay(scenarioInput, signals.forecastDaily, leadTimeDays, leadTimeDays);
  const daysOfCover = daysOfCoverWithIncoming(scenarioInput, signals.forecastDaily, leadTimeDays);
  const stockoutDate = daysOfCover === null ? null : isoDateFromOffset(todayIso, daysOfCover);
  const orderByOffset = orderByOffsetWithIncoming(scenarioInput, signals.forecastDaily, leadTimeDays, safetyStock);
  const orderByDate = orderByOffset === null ? null : isoDateFromOffset(todayIso, orderByOffset);

  const minimumTarget = safetyStock;
  const recommendedTarget = input.policy_custom
    ? input.target_stock
    : Math.max(input.target_stock, Math.ceil(signals.forecastDaily * 28) + safetyStock);
  const maximumTarget = Math.max(recommendedTarget, Math.ceil(signals.forecastDaily * 42) + safetyStock);
  const minimum = Math.max(0, minimumTarget - projectedAtLead);
  const recommended = Math.max(minimum, recommendedTarget - projectedAtLead);
  const maximum = Math.max(recommended, maximumTarget - projectedAtLead);

  const stockoutWithinLead = daysOfCover !== null && daysOfCover <= leadTimeDays;
  const stockoutWithin30 = daysOfCover !== null && daysOfCover <= 30;
  const risk: OperatingIntelligenceRow["risk"] = input.available <= 0 || stockoutWithinLead
    ? "critical"
    : stockoutWithin30 || projectedAtLead <= safetyStock
      ? "warning"
      : daysOfCover !== null && daysOfCover <= 60
        ? "watch"
        : "healthy";

  const datedIncoming = normalizedIncomingSchedule(scenarioInput, leadTimeDays);
  const explanation = [
    `${input.fulfilled_30d} units fulfilled in the last 30 days and ${input.fulfilled_prev_60d} in the prior 60 days.`,
    `Forecast demand is ${round2(signals.forecastDaily)} units/day after weighting available history, bounded trend and the active planning context.`,
    `${leadTimeDays} days effective lead time with ${bufferDays} days of demand buffer produces ${safetyStock} units of safety stock.`,
    `Current available stock plus ${datedIncoming.reduce((sum, item) => sum + item.quantity, 0)} dated incoming units projects to ${projectedAtLead} units when a new replenishment order would be expected to arrive.`,
  ];

  if (input.policy_custom) explanation.push(`The configured target stock of ${input.target_stock} units remains the recommended post-arrival target for this SKU/location policy.`);
  if (demandAdjustmentPercent) explanation.push(`Planning scenario adjusts demand by ${demandAdjustmentPercent > 0 ? "+" : ""}${demandAdjustmentPercent}%.`);
  if (extraLeadTimeDays) explanation.push(`Planning scenario adds ${extraLeadTimeDays} days to supplier timing, including dated incoming supply.`);

  return {
    ...input,
    effective_lead_time_days: leadTimeDays,
    average_daily_demand: round2(signals.recentDaily),
    prior_daily_demand: round2(signals.priorDaily),
    forecast_daily_demand: round2(signals.forecastDaily),
    trend_percent: signals.trendPercent,
    trend_label: signals.trendLabel,
    safety_stock: safetyStock,
    buffer_days: bufferDays,
    projected_at_lead_time: projectedAtLead,
    days_of_cover: daysOfCover,
    stockout_date: stockoutDate,
    order_by_date: orderByDate,
    recommended_quantity: recommended,
    scenarios: { minimum, recommended, maximum },
    forecast_12_weeks: forecastCurve(scenarioInput, signals.forecastDaily, leadTimeDays),
    risk,
    abc_class: abcClass,
    explanation,
  };
}

export function buildOperatingIntelligence(
  inputs: IntelligenceInput[],
  options: { defaultThreshold: number; todayIso?: string; context?: PlanningContext } = { defaultThreshold: 0 },
): OperatingIntelligenceResponse {
  const todayIso = options.todayIso || new Date().toISOString().slice(0, 10);
  const classes = abcClasses(inputs);
  const positions = inputs.map(input => applyPlanningContext(input, classes.get(input.id) || "C", todayIso, options.context));
  const riskRank = { critical: 0, warning: 1, watch: 2, healthy: 3 } as const;
  positions.sort((a, b) => riskRank[a.risk] - riskRank[b.risk]
    || (a.days_of_cover ?? Number.MAX_SAFE_INTEGER) - (b.days_of_cover ?? Number.MAX_SAFE_INTEGER)
    || b.scenarios.recommended - a.scenarios.recommended
    || a.product_name.localeCompare(b.product_name));

  const suggestions = positions.filter(row => row.risk !== "healthy" && row.scenarios.recommended > 0);
  return {
    generated_at: new Date().toISOString(),
    window_days: 90,
    history_window_days: 90,
    forecast_horizon_weeks: 12,
    default_threshold: options.defaultThreshold,
    summary: {
      tracked_positions: positions.length,
      at_risk: suggestions.length,
      critical: positions.filter(row => row.risk === "critical").length,
      projected_stockouts_30d: positions.filter(row => row.days_of_cover !== null && row.days_of_cover <= 30).length,
      a_class_positions: positions.filter(row => row.abc_class === "A").length,
    },
    positions,
    suggestions: suggestions.slice(0, 100),
  };
}
