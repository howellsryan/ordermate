import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Building2, Database, LockKeyhole, Save } from "lucide-react";
import type { WorkspaceModuleKey } from "../../shared/modules";
import type { OrganizationSummary } from "../../shared/types";
import { tenantApi } from "../api";
import { isDemoTenant } from "../demo-store";
import { ErrorText, Field, PageHeader } from "../ui";

type TenantSettings = {
  business_name: string;
  currency: string;
  prices_include_tax: number;
  default_tax_rate_bps: number;
  low_stock_threshold: number;
};

type BusinessProfile = {
  businessName: string;
  address: Record<string, unknown> | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  companyNumber: string | null;
  updatedAt: string | null;
};

type ModuleState = {
  key: WorkspaceModuleKey;
  label: string;
  description: string;
  dependencies: WorkspaceModuleKey[];
  enabled: boolean;
};
type ModulesResponse = { modules: ModuleState[] };

export default function Settings({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const demo = isDemoTenant(tenant.id);
  const settings = useQuery({ queryKey: ["tenant", tenant.id, "settings"], queryFn: () => tenantApi<TenantSettings>(tenant.id, "/settings") });
  const profile = useQuery({ queryKey: ["tenant", tenant.id, "business-profile"], queryFn: () => tenantApi<BusinessProfile>(tenant.id, "/business-profile") });
  const modules = useQuery({ queryKey: ["tenant", tenant.id, "modules"], queryFn: () => tenantApi<ModulesResponse>(tenant.id, "/modules") });
  const [currency, setCurrency] = useState("GBP");
  const [includeTax, setIncludeTax] = useState(true);
  const [tax, setTax] = useState("20");
  const [lowStock, setLowStock] = useState("5");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("GB");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const canEdit = ["owner", "admin", "manager"].includes(tenant.role);
  const canConfigureModules = ["owner", "admin"].includes(tenant.role);

  useEffect(() => {
    if (!settings.data) return;
    setCurrency(settings.data.currency);
    setIncludeTax(!!settings.data.prices_include_tax);
    setTax((settings.data.default_tax_rate_bps / 100).toString());
    setLowStock(String(settings.data.low_stock_threshold));
  }, [settings.data]);

  useEffect(() => {
    if (!profile.data) return;
    const address = profile.data.address || {};
    setLine1(String(address.line1 || ""));
    setLine2(String(address.line2 || ""));
    setCity(String(address.city || address.locality || ""));
    setCounty(String(address.county || address.region || ""));
    setPostcode(String(address.postcode || ""));
    setCountry(String(address.country || "GB"));
    setBusinessEmail(profile.data.email || "");
    setBusinessPhone(profile.data.phone || "");
    setVatNumber(profile.data.vatNumber || "");
    setCompanyNumber(profile.data.companyNumber || "");
  }, [profile.data]);

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
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] });
    },
  });

  const saveProfile = useMutation({
    mutationFn: () => tenantApi<BusinessProfile>(tenant.id, "/business-profile", {
      method: "PATCH",
      body: JSON.stringify({
        address: line1 || line2 || city || county || postcode ? { line1, line2, city, county, postcode, country: country || "GB" } : null,
        email: businessEmail || null,
        phone: businessPhone || null,
        vatNumber: vatNumber || null,
        companyNumber: companyNumber || null,
      }),
    }),
    onSuccess: data => {
      qc.setQueryData(["tenant", tenant.id, "business-profile"], data);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  const toggleModule = useMutation({
    mutationFn: ({ key, enabled }: { key: WorkspaceModuleKey; enabled: boolean }) => tenantApi<ModulesResponse>(tenant.id, `/modules/${key}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
    onSuccess: data => {
      qc.setQueryData(["tenant", tenant.id, "modules"], data);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  return <>
    <PageHeader eyebrow="Workspace" title="Settings" description={demo ? "Choose which operating modules this browser-only demo uses and change its business defaults." : "Choose only the operating modules this business needs, then configure its commercial and invoice identity settings."} />
    <div className="settings-grid">
      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">Optional modules</p><h3>Use only what the business needs</h3></div><Boxes size={21} /></div>
        <p className="settings-note">Disabling a module removes its workflows from day-to-day navigation but preserves its records. Re-enable it later and the data is still there. Dependencies are checked before a module can be switched off.</p>
        {modules.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : modules.error ? <ErrorText error={modules.error} /> : <div className="module-grid">
          {modules.data?.modules.map(module => <article className="module-card" key={module.key}>
            <div><h4>{module.label}</h4><p>{module.description}</p>{module.dependencies.length > 0 && <small>Requires {module.dependencies.map(dependency => modules.data?.modules.find(item => item.key === dependency)?.label || dependency).join(", ")}</small>}</div>
            <label className="module-switch" title={!canConfigureModules ? "Only owners and admins can change modules" : `${module.enabled ? "Disable" : "Enable"} ${module.label}`}>
              <input type="checkbox" checked={module.enabled} disabled={!canConfigureModules || toggleModule.isPending} onChange={event => toggleModule.mutate({ key: module.key, enabled: event.target.checked })} />
              <span aria-hidden="true" />
            </label>
          </article>)}
        </div>}
        {toggleModule.error && <ErrorText error={toggleModule.error} />}
      </section>

      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">Business identity</p><h3>Invoice details</h3></div><Building2 size={21} /></div>
        <p className="settings-note">This identity is independent of Inventory. Service-only businesses can therefore issue invoices without creating a warehouse or stock location. Issued invoices snapshot these details so later edits never rewrite history.</p>
        {profile.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : profile.error ? <ErrorText error={profile.error} /> : <form className="settings-form" onSubmit={event => { event.preventDefault(); saveProfile.mutate(); }}>
          <Field label="Business name"><input value={profile.data?.businessName || settings.data?.business_name || ""} disabled title="Business name follows the workspace identity" /></Field>
          <Field label="Address line 1"><input value={line1} disabled={!canEdit} onChange={event => setLine1(event.target.value)} /></Field>
          <Field label="Address line 2"><input value={line2} disabled={!canEdit} onChange={event => setLine2(event.target.value)} /></Field>
          <Field label="Town / city"><input value={city} disabled={!canEdit} onChange={event => setCity(event.target.value)} /></Field>
          <Field label="County / region"><input value={county} disabled={!canEdit} onChange={event => setCounty(event.target.value)} /></Field>
          <Field label="Postcode"><input value={postcode} disabled={!canEdit} onChange={event => setPostcode(event.target.value)} /></Field>
          <Field label="Country code"><input maxLength={2} value={country} disabled={!canEdit} onChange={event => setCountry(event.target.value.toUpperCase())} /></Field>
          <Field label="Invoice email"><input type="email" value={businessEmail} disabled={!canEdit} onChange={event => setBusinessEmail(event.target.value)} /></Field>
          <Field label="Phone"><input inputMode="tel" value={businessPhone} disabled={!canEdit} onChange={event => setBusinessPhone(event.target.value)} /></Field>
          <Field label="VAT number"><input value={vatNumber} disabled={!canEdit} onChange={event => setVatNumber(event.target.value)} /></Field>
          <Field label="Company number"><input value={companyNumber} disabled={!canEdit} onChange={event => setCompanyNumber(event.target.value)} /></Field>
          {saveProfile.error && <ErrorText error={saveProfile.error} />}
          {canEdit && <button className="primary" disabled={saveProfile.isPending}><Save size={16} /> Save invoice details</button>}
        </form>}
      </section>

      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">Commercial defaults</p><h3>Tax & inventory</h3></div><Database size={21} /></div>
        {settings.isLoading ? <div className="empty-state compact"><div className="loader" /></div> : <form className="settings-form" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
          <Field label="Currency"><select value={currency} disabled={!canEdit} onChange={event => setCurrency(event.target.value)}><option value="GBP">GBP — Pound sterling</option><option value="EUR">EUR — Euro</option><option value="USD">USD — US dollar</option></select></Field>
          <Field label="Default tax / VAT rate (%)"><input type="number" min="0" step="0.01" value={tax} disabled={!canEdit} onChange={event => setTax(event.target.value)} /></Field>
          <Field label="Low-stock threshold"><input type="number" min="0" step="1" value={lowStock} disabled={!canEdit} onChange={event => setLowStock(event.target.value)} /></Field>
          <label className="toggle-row"><input type="checkbox" checked={includeTax} disabled={!canEdit} onChange={event => setIncludeTax(event.target.checked)} /><span><strong>Catalogue prices include tax</strong><small>Operating Layer derives net/tax/gross snapshots from the entered selling price.</small></span></label>
          {save.error && <ErrorText error={save.error} />}
          {canEdit && <button className="primary" disabled={save.isPending}><Save size={16} /> Save defaults</button>}
        </form>}
      </section>

      <section className="panel settings-card">
        <div className="panel-heading"><div><p className="eyebrow">{demo ? "Guest demo storage" : "Data residency"}</p><h3>{demo ? "Browser only" : "Cloudflare-only runtime"}</h3></div><LockKeyhole size={21} /></div>
        {demo ? <>
          <div className="residency-list"><div><span>Identity</span><strong>No Google account</strong></div><div><span>Operational demo data</span><strong>Browser localStorage</strong></div><div><span>Documents & media</span><strong>Not uploaded</strong></div><div><span>Reset behaviour</span><strong>Seed data restored locally</strong></div></div>
          <p className="settings-note">This guest workspace has no cloud tenant. Its sample CRM, service work, catalogue, orders, purchasing, inventory, settings, team and activity remain in this browser. Reset demo restores the original local seed; Exit demo returns to the public site.</p>
        </> : <>
          <div className="residency-list"><div><span>Identity & memberships</span><strong>EU D1</strong></div><div><span>Operational business data</span><strong>EU Durable Object</strong></div><div><span>Documents & media</span><strong>EU R2</strong></div><div><span>Application runtime</span><strong>Cloudflare Workers</strong></div></div>
          <p className="settings-note">The tenant selector from the browser is never an authorization boundary. Membership is verified before the Worker routes to the tenant's isolated data object.</p>
        </>}
      </section>
    </div>
  </>;
}
