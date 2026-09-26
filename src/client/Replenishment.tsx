import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Clock3, PackagePlus, RotateCcw, Sparkles, TrendingDown } from "lucide-react";
import { applyPlanningContext } from "../shared/operating-intelligence";
import type { OrganizationSummary } from "../shared/types";
import { calendarDate, money, tenantApi } from "./api";
import type { ReplenishmentResponse, ReplenishmentSuggestion, ReplenishmentSupplier } from "./model";
import ReplenishmentPolicies from "./ReplenishmentPolicies";
import { DataState } from "./ui";

export type PurchaseOrderSeed = {
  supplierId: string;
  locationId: string;
  variantId: string;
  quantity: number;
  costMinor: number | null;
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
    const positions = query.data.positions.map(row => applyPlanningContext(row, row.abc_class, date, {
      demandAdjustmentPercent: demandAdjustment,
      extraLeadTimeDays: extraLeadDays,
    }));
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

  const create = (suggestion: ReplenishmentSuggestion, scenario: ScenarioName) => {
    const supplier = planningSupplier(suggestion);
    const quantity = suggestion.scenarios[scenario];
    if (!supplier || quantity <= 0) return;
    onCreatePurchaseOrder({
      supplierId: supplier.supplierId,
      locationId: suggestion.location_id,
      variantId: suggestion.variant_id,
      quantity,
      costMinor: supplier.lastCostMinor ?? null,
      sourceLabel: `${suggestion.product_name} · ${suggestion.variant_name} · ${scenario} intelligence scenario`,
    });
  };

  const contextActive = demandAdjustment !== 0 || extraLeadDays !== 0;
  const resetContext = () => { setDemandAdjustment(0); setExtraLeadDays(0); };

  return <section className="panel replenishment-panel intelligence-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Operating intelligence</p><h3>Plan the shortage before it happens</h3></div>
      <div className="replenishment-heading-actions"><ReplenishmentPolicies tenant={tenant} defaultThreshold={query.data?.default_threshold ?? 5} /><BrainCircuit size={21} /></div>
    </div>
    <p>Operating Layer blends 90 days of fulfilment history with current availability, incoming supply, supplier lead time and your stock policy. Every recommendation exposes the calculation and stays a draft until a person approves it.</p>

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
                {supplier ? <div className="planning-supplier"><span>{supplier.preferred ? "Preferred supplier" : "Planning supplier"}</span><strong>{supplier.supplierName}</strong><small>{supplier.supplierSku ? `${supplier.supplierSku} · ` : ""}{supplier.leadTimeDays ?? suggestion.effective_lead_time_days}d recorded lead{supplier.lastCostMinor != null ? ` · ${money(supplier.lastCostMinor)}` : ""}</small></div> : <div className="supplier-missing"><Clock3 size={15} /><span><strong>No supplier mapped</strong><small>Link this variant in Suppliers before creating a suggested PO.</small></span></div>}
              </div>
              <div className="scenario-actions" aria-label="Purchase scenarios">
                <ScenarioButton label="Minimum" quantity={suggestion.scenarios.minimum} helper="Protect buffer" disabled={!canWrite || !supplier} onClick={() => create(suggestion, "minimum")} />
                <ScenarioButton label="Recommended" quantity={suggestion.scenarios.recommended} helper="28d cover" primary disabled={!canWrite || !supplier} onClick={() => create(suggestion, "recommended")} />
                <ScenarioButton label="Maximum" quantity={suggestion.scenarios.maximum} helper="42d cover" disabled={!canWrite || !supplier} onClick={() => create(suggestion, "maximum")} />
              </div>
            </div>

            <details className="intelligence-explain"><summary>Why this recommendation?</summary><ul>{suggestion.explanation.map((line, index) => <li key={index}>{line}</li>)}</ul></details>
          </article>;
        })}
      </div>
    </DataState>
    <div className="replenishment-method"><BrainCircuit size={15} /><span><strong>Forecast, explain, propose.</strong> The base plan uses 70% recent 30-day demand and 30% of the prior 60-day run rate, with a bounded trend adjustment. Safety stock scales with effective supplier lead time. Context simulation is temporary; choosing a scenario only pre-fills the existing reviewed draft-PO flow.</span></div>
  </section>;
}

function planningSupplier(suggestion: ReplenishmentSuggestion): ReplenishmentSupplier | undefined {
  const preferred = suggestion.suppliers.find(supplier => supplier.preferred);
  if (preferred) return preferred;
  const exact = suggestion.suppliers.find(supplier => supplier.leadTimeDays === suggestion.effective_lead_time_days);
  if (exact) return exact;
  const withKnownLead = suggestion.suppliers
    .filter((supplier): supplier is ReplenishmentSupplier & { leadTimeDays: number } => supplier.leadTimeDays != null)
    .sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0];
  return withKnownLead || suggestion.suppliers[0];
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
