import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, History, LockKeyhole, Save } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import { date, tenantApi } from "../api";
import type { AuditEvent } from "../model";
import { DataState, ErrorText, Field, PageHeader } from "../ui";

type TenantSettings = {
  business_name: string;
  currency: string;
  prices_include_tax: number;
  default_tax_rate_bps: number;
  low_stock_threshold: number;
};

export default function Settings({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["tenant", tenant.id, "settings"], queryFn: () => tenantApi<TenantSettings>(tenant.id, "/settings") });
  const audit = useQuery({ queryKey: ["tenant", tenant.id, "audit"], queryFn: () => tenantApi<AuditEvent[]>(tenant.id, "/audit") });
  const [currency, setCurrency] = useState("GBP");
  const [includeTax, setIncludeTax] = useState(true);
  const [tax, setTax] = useState("20");
  const [lowStock, setLowStock] = useState("5");
  const canEdit = ["owner", "admin", "manager"].includes(tenant.role);

  useEffect(() => {
    if (!settings.data) return;
    setCurrency(settings.data.currency);
    setIncludeTax(!!settings.data.prices_include_tax);
    setTax((settings.data.default_tax_rate_bps / 100).toString());
    setLowStock(String(settings.data.low_stock_threshold));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/settings", {
      method: "PATCH",
      body: JSON.stringify({
        currency,
        pricesIncludeTax: includeTax,
        defaultTaxRateBps: Math.round((Number(tax) || 0) * 100),
        lowStockThreshold: Number(lowStock),
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "settings"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] });
    },
  });

  return <>
    <PageHeader eyebrow="Workspace" title="Settings & activity" description="Commercial defaults and an immutable view of who changed operational data." />
    <div className="settings-grid">
      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">Commercial defaults</p><h3>Tax & inventory</h3></div><Database size={21} /></div>
        {settings.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : <form className="settings-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
          <Field label="Currency"><select value={currency} disabled={!canEdit} onChange={event => setCurrency(event.target.value)}><option value="GBP">GBP — Pound sterling</option><option value="EUR">EUR — Euro</option><option value="USD">USD — US dollar</option></select></Field>
          <Field label="Default tax / VAT rate (%)"><input type="number" min="0" step="0.01" value={tax} disabled={!canEdit} onChange={event => setTax(event.target.value)} /></Field>
          <Field label="Low-stock threshold"><input type="number" min="0" step="1" value={lowStock} disabled={!canEdit} onChange={event => setLowStock(event.target.value)} /></Field>
          <label className="toggle-row"><input type="checkbox" checked={includeTax} disabled={!canEdit} onChange={event => setIncludeTax(event.target.checked)} /><span><strong>Catalogue prices include tax</strong><small>OrderMate derives net/tax/gross snapshots from the entered selling price.</small></span></label>
          {save.error && <ErrorText error={save.error} />}
          {canEdit && <button className="primary" disabled={save.isPending}><Save size={16} /> Save defaults</button>}
        </form>}
      </section>
      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">Data residency</p><h3>Cloudflare-only runtime</h3></div><LockKeyhole size={21} /></div>
        <div className="residency-list"><div><span>Identity & memberships</span><strong>EU D1</strong></div><div><span>Operational business data</span><strong>EU Durable Object</strong></div><div><span>Documents & media</span><strong>EU R2</strong></div><div><span>Application runtime</span><strong>Cloudflare Workers</strong></div></div>
        <p className="settings-note">The tenant selector from the browser is never an authorization boundary. Membership is verified before the Worker routes to the tenant's isolated data object.</p>
      </section>
    </div>
    <section className="panel audit-panel">
      <div className="panel-heading audit-heading"><div><p className="eyebrow">Audit trail</p><h3>Recent workspace activity</h3></div><History size={21} /></div>
      <DataState loading={audit.isLoading} error={audit.error} empty={!audit.data?.length} emptyText="Operational mutations will appear here.">
        <div className="audit-list">{audit.data?.map(event => <div className="audit-row" key={event.id}><span className="audit-dot" /><div><strong>{humanAction(event.action)}</strong><small>{event.entity_type.replaceAll("_", " ")}{event.entity_id ? ` · ${event.entity_id.slice(0, 8)}` : ""}</small></div><span className="audit-role">{event.actor_role}</span><time>{date(event.created_at)}</time></div>)}</div>
      </DataState>
    </section>
  </>;
}

function humanAction(action: string) {
  return action.split(".").map(part => part.replaceAll("_", " ")).join(" · ");
}
