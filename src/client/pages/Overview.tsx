import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, Sparkles, Warehouse } from "lucide-react";
import type { OrganizationSummary, DashboardSummary } from "../../shared/types";
import { money, tenantApi, tenantOpsApi } from "../api";
import type { AttentionResponse, SearchResult } from "../model";
import { DataState, PageHeader } from "../ui";

export default function Overview({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const query = useQuery({
    queryKey: ["tenant", tenant.id, "dashboard"],
    queryFn: () => tenantApi<DashboardSummary>(tenant.id, "/dashboard"),
  });
  const attention = useQuery({
    queryKey: ["tenant", tenant.id, "attention"],
    queryFn: () => tenantOpsApi<AttentionResponse>(tenant.id, "/attention"),
  });
  const data = query.data;

  return <>
    <PageHeader eyebrow="Today" title={tenant.name} description="The work that needs attention, without hunting for it." />
    <section className="metric-grid">
      <Metric label="Open orders" value={data?.ordersOpen ?? "—"} helper="Draft + confirmed" tone="ink" />
      <Metric label="Awaiting fulfilment" value={data?.ordersAwaitingFulfilment ?? "—"} helper="Ready to pick" tone="amber" />
      <Metric label="Open purchase orders" value={data?.purchaseOrdersOpen ?? "—"} helper="Including partial receipts" tone="blue" />
      <Metric label="Low stock" value={data?.lowStockVariants ?? "—"} helper="Variant/location pairs" tone="rose" />
    </section>

    <section className="panel attention-panel">
      <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h3>Operational inbox</h3></div><AlertTriangle size={21} /></div>
      <DataState loading={attention.isLoading} error={attention.error} empty={!attention.data?.items.length} emptyText="Nothing needs attention right now.">
        <div className="attention-list">{attention.data?.items.slice(0, 8).map(item => <button key={item.id} className={`attention-item attention-${item.severity}`} onClick={() => onNavigate(item.page)}><span className="attention-marker" /><span className="attention-copy"><small>{item.type}</small><strong>{item.title}</strong><span>{item.detail}</span></span><span className="attention-open">Open</span></button>)}</div>
      </DataState>
    </section>

    <section className="overview-grid">
      <div className="panel spotlight">
        <div className="panel-heading"><div><p className="eyebrow">Inventory position</p><h2>{money(data?.inventoryValueMinor, data?.currency)}</h2></div><Warehouse size={24} /></div>
        <p>Current on-hand inventory valued at recorded variant cost.</p>
        <div className="soft-rule" />
        <div className="automation-callout"><Sparkles size={18} /><div><strong>Automation-ready by design</strong><span>PO document intake, delivery-note matching and replenishment recommendations will propose changes against the same audited inventory ledger.</span></div></div>
      </div>
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Operating model</p><h3>One source of stock truth</h3></div><Archive size={21} /></div>
        <div className="principle-list"><span><i>01</i>Orders reserve before they consume.</span><span><i>02</i>Purchase receipts create stock movements.</span><span><i>03</i>Every mutation records who did it.</span></div>
      </div>
    </section>
  </>;
}

function Metric({ label, value, helper, tone }: { label: string; value: string | number; helper: string; tone: string }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>;
}
