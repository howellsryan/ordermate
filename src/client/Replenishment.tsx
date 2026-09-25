import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Clock3, PackagePlus, TrendingDown } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { money, tenantApi } from "./api";
import type { ReplenishmentResponse, ReplenishmentSuggestion, ReplenishmentSupplier } from "./model";
import { DataState } from "./ui";

export type PurchaseOrderSeed = {
  supplierId: string;
  locationId: string;
  variantId: string;
  quantity: number;
  costMinor: number | null;
  sourceLabel: string;
};

export default function Replenishment({ tenant, onCreatePurchaseOrder }: { tenant: OrganizationSummary; onCreatePurchaseOrder: (seed: PurchaseOrderSeed) => void }) {
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const query = useQuery({
    queryKey: ["tenant", tenant.id, "replenishment"],
    queryFn: () => tenantApi<ReplenishmentResponse>(tenant.id, "/replenishment"),
    staleTime: 30_000,
  });

  const create = (suggestion: ReplenishmentSuggestion) => {
    const supplier = planningSupplier(suggestion);
    if (!supplier) return;
    onCreatePurchaseOrder({
      supplierId: supplier.supplierId,
      locationId: suggestion.location_id,
      variantId: suggestion.variant_id,
      quantity: suggestion.recommended_quantity,
      costMinor: supplier.lastCostMinor ?? null,
      sourceLabel: `${suggestion.product_name} · ${suggestion.variant_name}`,
    });
  };

  return <section className="panel replenishment-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">Replenishment</p><h3>What looks likely to run short?</h3></div>
      <BrainCircuit size={21} />
    </div>
    <p>OrderMate uses the last 30 days of fulfilled units, stock already reserved, incoming POs and the fastest known mapped supplier lead time. It proposes a quantity; you decide whether to order it.</p>
    <DataState loading={query.isLoading} error={query.error} empty={!query.data?.suggestions.length} emptyText="No tracked stock currently needs replenishment under the workspace threshold.">
      <div className="replenishment-list">
        {query.data?.suggestions.map(suggestion => {
          const supplier = planningSupplier(suggestion);
          return <article className={`replenishment-row ${suggestion.projected_at_lead_time <= 0 ? "replenishment-critical" : ""}`} key={suggestion.id}>
            <div className="replenishment-item">
              <span className="replenishment-icon"><TrendingDown size={17} /></span>
              <span><strong>{suggestion.product_name} · {suggestion.variant_name}</strong><small className="mono">{suggestion.sku} · {suggestion.location_name}</small></span>
            </div>
            <div className="replenishment-facts">
              <Fact label="Available" value={suggestion.available} />
              <Fact label="Incoming" value={suggestion.incoming} />
              <Fact label="Fulfilled 30d" value={suggestion.fulfilled_30d} />
              <Fact label="Lead time" value={`${suggestion.effective_lead_time_days}d`} />
              <Fact label="Projected" value={suggestion.projected_at_lead_time} danger={suggestion.projected_at_lead_time <= 0} />
              <Fact label="Suggested" value={`+${suggestion.recommended_quantity}`} strong />
            </div>
            <div className="replenishment-action">
              {supplier ? <div className="planning-supplier"><span>Planning supplier</span><strong>{supplier.supplierName}</strong><small>{supplier.supplierSku ? `${supplier.supplierSku} · ` : ""}{supplier.leadTimeDays ?? suggestion.effective_lead_time_days}d lead{supplier.lastCostMinor != null ? ` · ${money(supplier.lastCostMinor)}` : ""}</small></div> : <div className="supplier-missing"><Clock3 size={15} /><span><strong>No supplier mapped</strong><small>Link this variant in Suppliers before creating a suggested PO.</small></span></div>}
              {canWrite && <button className="secondary" disabled={!supplier} onClick={() => create(suggestion)}><PackagePlus size={15} /> Review draft PO <ArrowRight size={14} /></button>}
            </div>
          </article>;
        })}
      </div>
    </DataState>
    <div className="replenishment-method"><BrainCircuit size={15} /><span><strong>Explainable, not autonomous.</strong> Lead-time demand = 30-day average daily fulfilment × fastest known mapped lead time. Suggested stock then adds a 14-day operating buffer plus your low-stock threshold. Incoming POs are deducted first. The resulting PO is still a draft for human review.</span></div>
  </section>;
}

function planningSupplier(suggestion: ReplenishmentSuggestion): ReplenishmentSupplier | undefined {
  const exact = suggestion.suppliers.find(supplier => supplier.leadTimeDays === suggestion.effective_lead_time_days);
  if (exact) return exact;
  const withKnownLead = suggestion.suppliers
    .filter((supplier): supplier is ReplenishmentSupplier & { leadTimeDays: number } => supplier.leadTimeDays != null)
    .sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0];
  return withKnownLead || suggestion.suppliers[0];
}

function Fact({ label, value, danger = false, strong = false }: { label: string; value: string | number; danger?: boolean; strong?: boolean }) {
  return <span className={`${danger ? "fact-danger" : ""} ${strong ? "fact-strong" : ""}`}><small>{label}</small><strong>{value}</strong></span>;
}
