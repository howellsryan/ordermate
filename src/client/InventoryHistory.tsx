import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, History, Search } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { date, tenantOpsApi } from "./api";
import { DataState } from "./ui";
import { useWorkspaceFeatures } from "./workspace-features";

type Movement = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  location_id: string;
  location_name: string;
  quantity_delta: number;
  movement_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  actor_id: string;
  actor_name: string;
  created_at: string;
};

export default function InventoryHistory({ tenant }: { tenant: OrganizationSummary }) {
  const features = useWorkspaceFeatures(tenant.id);
  if (!features.data || !features.enabled.has("inventory_history")) return null;
  return <EnabledInventoryHistory tenant={tenant} />;
}

function EnabledInventoryHistory({ tenant }: { tenant: OrganizationSummary }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const history = useQuery({
    queryKey: ["tenant", tenant.id, "inventory-movements"],
    queryFn: () => tenantOpsApi<Movement[]>(tenant.id, "/movements"),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const types = useMemo(() => [...new Set((history.data || []).map(item => item.movement_type))].sort(), [history.data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (history.data || []).filter(item => {
      if (type !== "all" && item.movement_type !== type) return false;
      if (!needle) return true;
      return [item.product_name, item.variant_name, item.sku, item.barcode, item.location_name, item.reason, item.reference_type, item.reference_id, item.actor_name]
        .some(value => value?.toLocaleLowerCase().includes(needle));
    });
  }, [history.data, query, type]);

  return <section className="panel inventory-history">
    <div className="panel-heading"><div><p className="eyebrow">Immutable ledger</p><h3>Stock history</h3></div><History size={21} /></div>
    <p>Every physical stock change is recorded here. Reservations are tracked separately because they do not change on-hand quantity.</p>
    <div className="history-filters">
      <label className="filter-search"><Search size={15} /><input aria-label="Search stock history" value={query} onChange={event => setQuery(event.target.value)} placeholder="Item, SKU, location, reason, reference or person…" /></label>
      <select aria-label="Filter stock history by movement type" value={type} onChange={event => setType(event.target.value)}><option value="all">All movements</option>{types.map(value => <option key={value} value={value}>{movementLabel(value)}</option>)}</select>
    </div>
    <DataState loading={history.isLoading} error={history.error} empty={!filtered.length} emptyText={history.data?.length ? "No stock movements match these filters." : "Physical stock changes will appear here."}>
      <div className="movement-list">
        <div className="movement-head"><span>Movement</span><span>Location</span><span>Change</span><span>Reference</span><span>By</span><span>When</span></div>
        {filtered.map(item => <div className="movement-row" key={item.id}>
          <div className="movement-item"><span className={`movement-icon ${item.quantity_delta >= 0 ? "positive" : "negative"}`}>{item.quantity_delta >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</span><span><strong>{item.product_name} · {item.variant_name}</strong><small className="mono">{item.sku}</small><em>{movementLabel(item.movement_type)}{item.reason ? ` · ${item.reason}` : ""}</em></span></div>
          <span>{item.location_name}</span>
          <strong className={item.quantity_delta >= 0 ? "positive-text" : "danger-text"}>{item.quantity_delta > 0 ? "+" : ""}{item.quantity_delta}</strong>
          <span>{reference(item)}</span>
          <span>{item.actor_name}</span>
          <time>{date(item.created_at)}</time>
        </div>)}
      </div>
    </DataState>
  </section>;
}

function movementLabel(value: string) {
  const labels: Record<string, string> = {
    adjustment: "Stock adjustment",
    transfer_in: "Transfer in",
    transfer_out: "Transfer out",
    purchase_receipt: "Purchase receipt",
    order_fulfilment: "Order fulfilment",
    return_restock: "Return restock",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function reference(item: Movement) {
  if (!item.reference_type || !item.reference_id) return "—";
  const label = item.reference_type.replaceAll("_", " ");
  return `${label} · ${item.reference_id.slice(0, 8)}`;
}
