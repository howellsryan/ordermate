import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, History, Search, ShieldCheck } from "lucide-react";
import type { OrganizationSummary, Role } from "../../shared/types";
import { date, downloadTenantCsv, tenantApi } from "../api";
import { isDemoTenant } from "../demo-store";
import type { AuditEvent } from "../model";
import { DataState, ErrorText, PageHeader } from "../ui";

type ExportKind = "products" | "inventory" | "orders" | "purchase-orders" | "delivery-discrepancies" | "customers" | "suppliers" | "audit";
type ExportDefinition = { kind: ExportKind; label: string; description: string };

const exports: ExportDefinition[] = [
  { kind: "products", label: "Products & variants", description: "Product, variant, SKU, barcode, option, price, cost and tax snapshots." },
  { kind: "inventory", label: "Inventory position", description: "On-hand, reserved, available and incoming stock by variant and location." },
  { kind: "orders", label: "Orders", description: "Order headers, lifecycle state and commercial totals." },
  { kind: "purchase-orders", label: "Purchase orders", description: "Supplier, destination, lifecycle, expected arrival and commercial totals." },
  { kind: "delivery-discrepancies", label: "Delivery discrepancies", description: "PO, supplier, issue evidence and audited resolution history for delivery mismatches." },
  { kind: "customers", label: "Customers", description: "Saved customer contact details." },
  { kind: "suppliers", label: "Suppliers", description: "Saved supplier contact details." },
  { kind: "audit", label: "Audit trail", description: "Actor, role, action, entity and timestamp for recent operational mutations." },
];

function allowedExports(role: Role): ExportKind[] {
  if (role === "fulfilment") return ["products", "inventory", "orders", "customers", "audit"];
  return exports.map(item => item.kind);
}

export default function Activity({ tenant }: { tenant: OrganizationSummary }) {
  const demo = isDemoTenant(tenant.id);
  const audit = useQuery({ queryKey: ["tenant", tenant.id, "audit"], queryFn: () => tenantApi<AuditEvent[]>(tenant.id, "/audit") });
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const exportMutation = useMutation({ mutationFn: (kind: ExportKind) => downloadTenantCsv(tenant.id, kind) });
  const permitted = allowedExports(tenant.role);

  const roles = useMemo(() => [...new Set((audit.data || []).map(event => event.actor_role))].sort(), [audit.data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (audit.data || []).filter(event => {
      if (role !== "all" && event.actor_role !== role) return false;
      if (!needle) return true;
      return [event.action, event.entity_type, event.entity_id, event.actor_id, event.actor_role].some(value => value?.toLocaleLowerCase().includes(needle));
    });
  }, [audit.data, query, role]);

  return <>
    <PageHeader eyebrow="Operations" title="Activity & data" description={demo ? "Trace local demo changes and download browser-generated CSV snapshots without sending demo data anywhere." : "Trace operational changes and take clean, tenant-scoped CSV snapshots without leaving the workspace."} actions={<button className="secondary" onClick={() => exportMutation.mutate("audit")} disabled={exportMutation.isPending}><Download size={16} /> Export audit CSV</button>} />

    <section className="activity-grid">
      <div className="panel activity-audit-card">
        <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h3>Recent workspace activity</h3></div><History size={21} /></div>
        <div className="activity-filters">
          <label className="filter-search"><Search size={15} /><input aria-label="Filter activity" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter action, entity or actor…" /></label>
          <select aria-label="Filter activity by role" value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option>{roles.map(value => <option value={value} key={value}>{value}</option>)}</select>
        </div>
        <DataState loading={audit.isLoading} error={audit.error} empty={!filtered.length} emptyText={audit.data?.length ? "No activity matches these filters." : "Operational mutations will appear here."}>
          <div className="activity-list">{filtered.map(event => <div className="activity-row" key={event.id}><span className="activity-dot" /><div className="activity-copy"><strong>{humanAction(event.action)}</strong><small>{event.entity_type.replaceAll("_", " ")}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ""}</small></div><span className="activity-role">{event.actor_role}</span><time>{date(event.created_at)}</time></div>)}</div>
        </DataState>
      </div>

      <aside className="panel export-panel">
        <div className="panel-heading"><div><p className="eyebrow">Portable by default</p><h3>CSV exports</h3></div><FileSpreadsheet size={21} /></div>
        <p>{demo ? "Guest-demo exports are generated entirely in this browser from the local workspace state." : "Exports are generated only after the current membership and dataset permission are re-checked on the Worker."}</p>
        <div className="export-list">{exports.filter(item => permitted.includes(item.kind)).map(item => <button key={item.kind} onClick={() => exportMutation.mutate(item.kind)} disabled={exportMutation.isPending}><span className="export-icon"><Download size={15} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}</div>
        {exportMutation.error && <ErrorText error={exportMutation.error} />}
        <div className="export-trust"><ShieldCheck size={17} /><span>{demo ? "Exports contain sample demo data and do not call the Operating Layer API." : "Exports never bypass tenant membership or role checks."}</span></div>
      </aside>
    </section>
  </>;
}

function humanAction(action: string) {
  return action.split(".").map(part => part.replaceAll("_", " ")).join(" · ");
}
