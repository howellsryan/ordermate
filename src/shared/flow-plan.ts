import type { OperatingIntelligenceResponse } from "./operating-intelligence";

export type FlowPlanPage = "orders" | "warehouse" | "inventory" | "purchasing";
export type FlowPlanSeverity = "critical" | "warning" | "info";

export type FlowPlanAttentionItem = {
  id: string;
  severity: FlowPlanSeverity;
  type: string;
  title: string;
  detail: string;
  page: FlowPlanPage | string;
};

export type FlowPlanAction = {
  id: string;
  category: "customer_promise" | "stock_risk" | "supply_risk" | "receiving_exception";
  severity: FlowPlanSeverity;
  title: string;
  detail: string;
  nextAction: string;
  page: FlowPlanPage;
  score: number;
  evidence: string[];
};

export type FlowPlan = {
  generatedAt: string;
  checks: string[];
  critical: number;
  actions: FlowPlanAction[];
};

const severityScore = { critical: 30, warning: 15, info: 5 } as const;

function attentionAction(item: FlowPlanAttentionItem): FlowPlanAction | null {
  if (item.type === "Required-by overdue") {
    return {
      id: `flow:${item.id}`,
      category: "customer_promise",
      severity: "critical",
      title: `${item.title} is past its required-by date`,
      detail: item.detail,
      nextAction: "Move this order to the front of fulfilment",
      page: "warehouse",
      score: 120,
      evidence: ["Required-by date has passed", "Order is still confirmed and awaiting fulfilment"],
    };
  }

  if (item.type === "Urgent fulfilment") {
    return {
      id: `flow:${item.id}`,
      category: "customer_promise",
      severity: "warning",
      title: `${item.title} is marked urgent`,
      detail: item.detail,
      nextAction: "Review and fulfil before lower-priority work",
      page: "warehouse",
      score: 95,
      evidence: ["Order priority is urgent", "Order remains in the fulfilment queue"],
    };
  }

  if (item.type === "Overdue purchase order") {
    return {
      id: `flow:${item.id}`,
      category: "supply_risk",
      severity: "critical",
      title: `${item.title} is overdue from its supplier`,
      detail: item.detail,
      nextAction: "Review the PO and chase the supplier",
      page: "purchasing",
      score: 112,
      evidence: ["Expected delivery date has passed", "Purchase order is still open"],
    };
  }

  if (item.type === "Partial receipt") {
    return {
      id: `flow:${item.id}`,
      category: "supply_risk",
      severity: "warning",
      title: `${item.title} still has stock outstanding`,
      detail: item.detail,
      nextAction: "Confirm whether the remaining quantity is still due",
      page: "purchasing",
      score: 72,
      evidence: ["Purchase order has only been partially received"],
    };
  }

  if (item.type === "Open delivery discrepancy") {
    return {
      id: `flow:${item.id}`,
      category: "receiving_exception",
      severity: "warning",
      title: `${item.title} has an unresolved receiving exception`,
      detail: item.detail,
      nextAction: "Resolve the discrepancy before it becomes supplier debt",
      page: "purchasing",
      score: 88,
      evidence: ["Receiving evidence does not fully match the purchase order"],
    };
  }

  return null;
}

export function buildFlowPlan(
  attention: FlowPlanAttentionItem[],
  replenishment: Pick<OperatingIntelligenceResponse, "suggestions">,
  now = new Date().toISOString(),
): FlowPlan {
  const actions: FlowPlanAction[] = [];

  for (const item of attention) {
    const action = attentionAction(item);
    if (action) actions.push(action);
  }

  for (const row of replenishment.suggestions) {
    if (row.risk !== "critical" && row.risk !== "warning") continue;
    const supplier = row.suppliers.find(item => item.preferred)
      || (row.suppliers.length === 1 ? row.suppliers[0] : undefined);
    const classBoost = row.abc_class === "A" ? 12 : row.abc_class === "B" ? 6 : 0;
    const riskBoost = row.risk === "critical" ? 70 : 45;
    const days = row.days_of_cover === null ? "unknown cover" : `${row.days_of_cover} day${row.days_of_cover === 1 ? "" : "s"} cover`;
    const buy = row.scenarios.recommended;

    actions.push({
      id: `flow:stock:${row.id}`,
      category: "stock_risk",
      severity: row.risk === "critical" ? "critical" : "warning",
      title: `${row.product_name} · ${row.variant_name} needs a buying decision`,
      detail: `${row.location_name} · ${days}${row.stockout_date ? ` · projected stockout ${row.stockout_date}` : ""}`,
      nextAction: supplier
        ? `Review ${buy} units from ${supplier.supplierName}`
        : `Review the recommended buy of ${buy} units and choose a supplier`,
      page: "purchasing",
      score: riskBoost + classBoost + severityScore[row.risk === "critical" ? "critical" : "warning"],
      evidence: [
        `${row.abc_class}-class inventory position`,
        `${row.forecast_daily_demand} forecast units/day`,
        `${row.safety_stock} units safety stock`,
        row.order_by_date ? `Order-by date ${row.order_by_date}` : "No safe order-by date available",
      ],
    });
  }

  const deduped = new Map<string, FlowPlanAction>();
  for (const action of actions) {
    const existing = deduped.get(action.id);
    if (!existing || action.score > existing.score) deduped.set(action.id, action);
  }

  const sorted = [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 8);

  return {
    generatedAt: now,
    checks: ["Customer promise dates", "Forecast stock risk", "Incoming supplier dates", "Receiving discrepancies"],
    critical: sorted.filter(action => action.severity === "critical").length,
    actions: sorted,
  };
}
