import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Clock3, Layers3, PackagePlus, RotateCcw, Sparkles, TrendingDown } from "lucide-react";
import { buildBuyBatches, deterministicPlanningSupplier } from "../shared/buy-batches";
import { applyPlanningContext } from "../shared/operating-intelligence";
import { orderableQuantity } from "../shared/supplier-ordering";
import type { OrganizationSummary } from "../shared/types";
import { calendarDate, money, tenantApi } from "./api";
import type { ReplenishmentResponse, ReplenishmentSuggestion, ReplenishmentSupplier } from "./model";
import ReplenishmentPolicies from "./ReplenishmentPolicies";
import { DataState } from "./ui";

export type PurchaseOrderSeedLine = {
  variantId: string;
  quantity: number;
  costMinor: number | null;
};

export type PurchaseOrderSeed = {
  supplierId: string;
  locationId: string;
  lines: PurchaseOrderSeedLine[];
  sourceLabel: string;
};

type ScenarioName = "minimum" | "recommended" | "maximum";

export default function Replenishment({ tenant, onCreatePurchaseOrder }: { tenant: OrganizationSummary; onCreatePurchaseOrder: (seed: PurchaseOrderSeed) => void }) {
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const [demandAdjustment, setDemandAdjustment] = useState(0);
  const [extraLeadDays, setExtraLeadDays] = useState(0);
  const query = useQuery({
    queryKey: ["tenant", tenant.id, "replenishment"],
    queryFn: () => tenantApi<ReplenishmentResponse>(tenant.id, "/replenishment"),
    staleTime: 30_000,
  });

  const planning = useMemo(() => {
    if (!query.data) return null;
    const date = query.data.generated_at.slice(0, 10);
    const positions = query.data.positions.map(row => {
      const planned = applyPlanningContext(row, row.abc_class, date, {
        demandAdjustmentPercent: demandAdjustment,
        extraLeadTimeDays: extraLeadDays,
      }) as ReplenishmentSuggestion;
      const constraints = row.ordering_constraints;
      if (!constraints) return planned;
      const scenarios = {
        minimum: orderableQuantity(planned.scenarios.minimum, constraints.minimum_order_quantity, constraints.order_multiple),
        recommended: orderableQuantity(planned.scenarios.recommended, constraints.minimum_order_quantity, constraints.order_multiple),
        maximum: orderableQuantity(planned.scenarios.maximum, constraints.minimum_order_quantity, constraints.order_multiple),
      };
      return {
        ...planned,
        ordering_constraints: constraints,
        scenarios,
        recommended_quantity: scenarios.recommended,
      };
    });
    const suggestions = positions.filter(row => row.risk !== "healthy" && row.scenarios.recommended > 0);
    return {
      positions,
      suggestions,
      summary: {
        tracked_positions: positions.length,
        at_risk: suggestions.length,
        critical: positions.filter(row => row.risk === "critical").length,
        projected_stockouts_30d: positions.filter(row => row.days_of_cover !== null && row.days_of_cover <= 30).length,
        a_class_positions: positions.filter(row => row.abc_class === "A").length,
      },
    };
  }, [query.data, demandAdjustment, extraLeadDays]);

  const buyBatches = useMemo(() => {
    if (!planning || !query.data) return [];
    return buildBuyBatches(planning.suggestions, query.data.generated_at.slice(0, 10));
  }, [planning, query.data]);

  const create = (suggestion: ReplenishmentSuggestion, scenario: ScenarioName) => {
    const supplier = planningSupplier(suggestion);
    const quantity = suggestion.scenarios[scenario];
    if (!supplier || quantity <= 0) return;
    onCreatePurchaseOrder({
      supplierId: supplier.supplierId,
      locationId: suggestion.location_id,
      lines: [{ variantId: suggestion.variant_id, quantity, costMinor: supplier.lastCostMinor ?? null }],
      sourceLabel: `${suggestion.product_name} · ${suggestion.variant_name} · ${scenario} intelligence scenario`,
    });
  };

  const createBatch = (batch: ReturnType<typeof buildBuyBatches>[number]) => {
    onCreatePurchaseOrder({
      supplierId: batch.supplierId,
      locationId: batch.locationId,
      lines: batch.lines.map(line => ({ variantId: line.variantId, quantity: line.quantity, costMinor: line.costMinor })),
      sourceLabel: `Smart buy batch for ${batch.supplierName} · ${batch.locationName}`,
    });
  };

  const contextActive = demandAdjustment !== 0 || extraLeadDays !== 0;
  const resetContext = () => { setDemandAdjustment(0); setExtraLeadDays(0); };

  return <section className="panel replenishment-panel intelligence-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Operating intelligence</p><h3>Plan the shortage before it happens</h3></div>
      <div className="replenishment-heading-actions"><ReplenishmentPolicies tenant={tenant} defaultThreshold={query.data?.default_threshold ?? 5} /><BrainCircuit size={21} /></div>
    </div>
    <p>Operating Layer blends up to 90 days of fulfilment history with current availability, incoming supply, supplier lead time and your stock policy. Every recommendation exposes the calculation and stays a draft until a person approves it.</p>

    {planning && <div className="intelligence-summary" aria-label="Planning summary">
      <InsightMetric label="At risk" value={planning.summary.at_risk} />
      <InsightMetric label="Critical" value={planning.summary.critical} danger={planning.summary.critical > 0} />
      <InsightMetric label="Stockouts ≤30d" value={planning.summary.projected_stockouts_30d} danger={planning.summary.projected_stockouts_30d > 0} />
      <InsightMetric label="A-class positions" value={planning.summary.a_class_positions} />
    </div>}

    <div className="planning-context">
      <div className="planning-context-copy"><Sparkles size={17} /><span><strong>What if the numbers cannot see the context?</strong><small>Simulate a campaign-driven demand change or supplier delay. This changes the plan in your browser only; it never edits stock, lead times or policies.</small></span></div>
      <label>Demand change <span>{demandAdjustment > 0 ? "+" : ""}{demandAdjustment}%</span><input type="range" min="-50" max="100" step="5" value={demandAdjustment} onChange={event => setDemandAdjustment(Number(event.target.value))} /></label>
      <label>Supplier delay <span>+{extraLeadDays}d</span><input type="range" min="0" max="30" step="1" value={extraLeadDays} onChange={event => setExtraLeadDays(Number(event.target.value))} /></label>
      <button type="button" className="table-action quiet" disabled={!contextActive} onClick={resetContext}><RotateCcw size={14} /> Reset scenario</button>
    </div>

    {!!buyBatches.length && <div className="smart-buy-section">
      <div className="smart-buy-heading"><span><Layers3 size={17} /><span><strong>Smart buy batches</strong><small>Due recommendations grouped by supplier + destination so one review replaces several draft POs.</small></span></span><b>{buyBatches.reduce((sum, batch) => sum + batch.lines.length, 0)} SKU{buyBatches.reduce((sum, batch) => sum + batch.lines.length, 0) === 1 ? "" : "s"} ready</b></div>
      <div className="smart-buy-grid">{buyBatches.map(batch => <article className="smart-buy-card" key={batch.id}>
        <div><small>Supplier batch</small><strong>{batch.supplierName}</strong><span>{batch.locationName} · {batch.lines.length} SKU{batch.lines.length === 1 ? "" : "s"} · {batch.totalUnits} units</span></div>
        <div className="smart-buy-lines">{batch.lines.slice(0, 3).map(line => <span key={line.variantId}><b>{line.productName} · {line.variantName}</b><small>{line.sku} · +{line.quantity}{line.risk === "critical" ? " · critical" : ""}</small></span>)}{batch.lines.length > 3 && <span><b>+{batch.lines.length - 3} more</b><small>Included in the reviewable draft</small></span>}</div>
        <div className="smart-buy-footer"><span><small>Estimated goods cost</small><strong>{batch.estimatedCostMinor == null ? "Review costs" : money(batch.estimatedCostMinor)}</strong></span><button type="button" className="secondary" disabled={!canWrite} onClick={() => createBatch(batch)}>Review draft PO <ArrowRight size={14} /></button></div>
      </article>)}</div>
    </div>}

    <DataState loading={query.isLoading} error={query.error} empty={!planning?.suggestions.length} emptyText={contextActive ? "Nothing is forecast to need replenishment under this planning scenario." : "No tracked stock is forecast to need replenishment under the current plan."}>
      <div className="replenishment-list intelligence-list">
        {planning?.suggestions.map(suggestion => {
          const supplier = planningSupplier(suggestion);
          return <article className={`replenishment-row intelligence-row risk-${suggestion.risk}`} key={suggestion.id}>
            <div className="intelligence-row-top">
              <div className="replenishment-item">
                <span className="replenishment-icon"><TrendingDown size={17} /></span>
                <span><strong>{suggestion.product_name} · {suggestion.variant_name}</strong><small className="mono">{suggestion.sku} · {suggestion.location_name}</small><span className="intelligence-badges"><small className={`risk-badge risk-${suggestion.risk}`}>{suggestion.risk}</small><small className="abc-badge">ABC {suggestion.abc_class}</small>{suggestion.policy_custom && <small className="policy-badge">Custom rule</small>}</span></span>
              </div>
              <div className="forecast-status"><strong>{suggestion.stockout_date ? `Projected stockout ${calendarDate(suggestion.stockout_date)}` : "No stockout inside forecast confidence window"}</strong><span>{suggestion.order_by_date ? `Order by ${calendarDate(suggestion.order_by_date)}` : "No immediate order date"} · {suggestion.days_of_cover == null ? "No demand history" : `${suggestion.days_of_cover} days cover`}</span></div>
            </div>

            <div className="replenishment-facts intelligence-facts">
              <Fact label="Available" value={suggestion.available} />
              <Fact label="Incoming" value={suggestion.incoming} />
              <Fact label="Forecast / day" value={suggestion.forecast_daily_demand} />
              <Fact label="Trend" value={trendCopy(suggestion)} />
              <Fact label="Safety stock" value={suggestion.safety_stock} />
              <Fact label="Lead time" value={`${suggestion.effective_lead_time_days}d`} />
              <Fact label="Projected on arrival" value={suggestion.projected_at_lead_time} danger={suggestion.projected_at_lead_time <= suggestion.safety_stock} />
            </div>

            <ForecastStrip suggestion={suggestion} />

            <div className="intelligence-action-grid">
              <div className="replenishment-action">
                {supplier ? <div className="planning-supplier"><span>{supplier.preferred ? "Preferred supplier" : "Only mapped supplier"}</span><strong>{supplier.supplierName}</strong><small>{supplier.supplierSku ? `${supplier.supplierSku} · ` : ""}{supplier.leadTimeDays ?? suggestion.effective_lead_time_days}d recorded lead{supplier.lastCostMinor != null ? ` · ${money(supplier.lastCostMinor)}` : ""}</small>{suggestion.ordering_constraints?.adjusted && <small>Recommended quantities respect MOQ / order multiple.</small>}</div> : <div className="supplier-missing"><Clock3 size={15} /><span><strong>{suggestion.suppliers.length > 1 ? "Choose a preferred supplier" : "No supplier mapped"}</strong><small>{suggestion.suppliers.length > 1 ? "Several suppliers are mapped. Set a preferred supplier before Operating Layer prepares a PO." : "Link this variant in Suppliers before creating a suggested PO."}</small></span></div>}
              </div>
              <div className="scenario-actions" aria-label="Purchase scenarios">
                <ScenarioButton label="Minimum" quantity={suggestion.scenarios.minimum} helper="Protect buffer" disabled={!canWrite || !supplier} onClick={() => create(suggestion, "minimum")} />
                <ScenarioButton label="Recommended" quantity={suggestion.scenarios.recommended} helper={suggestion.policy_custom ? "Policy target" : "28d cover"} primary disabled={!canWrite || !supplier} onClick={() => create(suggestion, "recommended")} />
                <ScenarioButton label="Maximum" quantity={suggestion.scenarios.maximum} helper="42d cover" disabled={!canWrite || !supplier} onClick={() => create(suggestion, "maximum")} />
              </div>
            </div>

            <details className="intelligence-explain"><summary>Why this recommendation?</summary><ul>{suggestion.explanation.map((line, index) => <li key={index}>{line}</li>)}</ul></details>
          </article>;
        })}
      </div>
    </DataState>
    <div className="replenishment-method"><BrainCircuit size={15} /><span><strong>Forecast, explain, group, propose.</strong> The base plan weights recent and prior demand when both windows exist; with only recent history it uses that observed run-rate rather than treating missing history as zero. Safety stock scales with effective supplier lead time, supplier buying terms are preserved after scenario simulation, and custom SKU/location targets remain authoritative. Choosing a scenario or batch only pre-fills the existing reviewed draft-PO flow.</span></div>
  </section>;
}

function planningSupplier(suggestion: ReplenishmentSuggestion): ReplenishmentSupplier | undefined {
  return deterministicPlanningSupplier(suggestion);
}

function trendCopy(suggestion: ReplenishmentSuggestion) {
  if (suggestion.trend_percent == null) return suggestion.trend_label === "insufficient_history" ? "New" : "Stable";
  const prefix = suggestion.trend_percent > 0 ? "+" : "";
  return `${prefix}${suggestion.trend_percent}%`;
}

function ForecastStrip({ suggestion }: { suggestion: ReplenishmentSuggestion }) {
  const values = suggestion.forecast_12_weeks.map(point => point.projected);
  const max = Math.max(1, ...values.map(value => Math.abs(value)), suggestion.safety_stock);
  return <div className="forecast-strip" aria-label="12 week projected inventory">
    <span className="forecast-strip-label">12 week projection</span>
    <div className="forecast-bars">{suggestion.forecast_12_weeks.map(point => {
      const height = Math.max(8, Math.round(Math.min(1, Math.abs(point.projected) / max) * 44));
      return <span key={point.week} className={point.projected <= 0 ? "below-zero" : point.projected <= suggestion.safety_stock ? "near-buffer" : ""} title={`Week ${point.week}: ${point.projected} projected`}><i style={{ height }} /><small>{point.week}</small></span>;
    })}</div>
  </div>;
}

function InsightMetric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={danger ? "insight-metric danger" : "insight-metric"}><span>{label}</span><strong>{value}</strong></div>;
}

function ScenarioButton({ label, quantity, helper, disabled, primary = false, onClick }: { label: string; quantity: number; helper: string; disabled: boolean; primary?: boolean; onClick: () => void }) {
  return <button type="button" className={primary ? "scenario-button primary-scenario" : "scenario-button"} disabled={disabled || quantity <= 0} onClick={onClick}><span>{label}<small>{helper}</small></span><strong>+{quantity}</strong><PackagePlus size={15} /><ArrowRight size={13} /></button>;
}

function Fact({ label, value, danger = false, strong = false }: { label: string; value: string | number; danger?: boolean; strong?: boolean }) {
  return <span className={`${danger ? "fact-danger" : ""} ${strong ? "fact-strong" : ""}`}><small>{label}</small><strong>{value}</strong></span>;
}
