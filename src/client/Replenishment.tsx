import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BrainCircuit, Clock3, PackagePlus, TrendingDown } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { money, tenantApi } from "./api";
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
      <div className="replenishment-heading-actions"><ReplenishmentPolicies tenant={tenant} defaultThreshold={query.data?.default_threshold ?? 5} /><BrainCircuit size={21} /></div>
    </div>
    <p>Operating Layer uses fulfilled demand, reservations, incoming POs and mapped supplier lead times. Most stock positions use the workspace defaults; you can add a SKU/location rule when a product needs a different reorder point, target stock or preferred supplier.</p>
    <DataState loading={query.isLoading} error={query.error} empty={!query.data?.suggestions.length} emptyText="No tracked stock currently needs replenishment under its effective reorder rules.">
      <div className="replenishment-list">
        {query.data?.suggestions.map(suggestion => {
          const supplier = planningSupplier(suggestion);
          return <article className={`replenishment-row ${suggestion.projected_at_lead_time <= 0 ? "replenishment-critical" : ""}`} key={suggestion.id}>
            <div className="replenishment-item">
              <span className="replenishment-icon"><TrendingDown size={17} /></span>
              <span><strong>{suggestion.product_name} · {suggestion.variant_name}</strong><small className="mono">{suggestion.sku} · {suggestion.location_name}</small>{suggestion.policy_custom && <small className="policy-badge">Custom replenishment rule</small>}</span>
            </div>
            <div className="replenishment-facts">
              <Fact label="Available" value={suggestion.available} />
              <Fact label="Incoming" value={suggestion.incoming} />
              <Fact label="Reorder at" value={suggestion.threshold} />
              <Fact label="Target" value={suggestion.target_stock ?? "—"} />
              <Fact label="Lead time" value={`${suggestion.effective_lead_time_days}d`} />
              <Fact label="Projected" value={suggestion.projected_at_lead_time} danger={suggestion.projected_at_lead_time <= 0} />
              <Fact label="Suggested" value={`+${suggestion.recommended_quantity}`} strong />
            </div>
            <div className="replenishment-action">
              {supplier ? <div className="planning-supplier"><span>{supplier.preferred ? "Preferred supplier" : "Planning supplier"}</span><strong>{supplier.supplierName}</strong><small>{supplier.supplierSku ? `${supplier.supplierSku} · ` : ""}{supplier.leadTimeDays ?? suggestion.effective_lead_time_days}d lead{supplier.lastCostMinor != null ? ` · ${money(supplier.lastCostMinor)}` : ""}</small></div> : <div className="supplier-missing"><Clock3 size={15} /><span><strong>No supplier mapped</strong><small>Link this variant in Suppliers before creating a suggested PO.</small></span></div>}
              {canWrite && <button className="secondary" disabled={!supplier} onClick={() => create(suggestion)}><PackagePlus size={15} /> Review draft PO <ArrowRight size={14} /></button>}
            </div>
          </article>;
        })}
      </div>
    </DataState>
    <div className="replenishment-method"><BrainCircuit size={15} /><span><strong>Explainable, not autonomous.</strong> Projected stock accounts for current availability, incoming POs and demand during the effective supplier lead time. Custom rules use their configured reorder point and target; everything else keeps Operating Layer's demand-based target and workspace threshold. Every suggested PO remains a draft for human review.</span></div>
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

function Fact({ label, value, danger = false, strong = false }: { label: string; value: string | number; danger?: boolean; strong?: boolean }) {
  return <span className={`${danger ? "fact-danger" : ""} ${strong ? "fact-strong" : ""}`}><small>{label}</small><strong>{value}</strong></span>;
}
