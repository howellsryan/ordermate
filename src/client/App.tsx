import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowRightLeft,
  Boxes,
  Building2,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import type { DashboardSummary, OrganizationSummary, SessionPayload } from "../shared/types";
import { authClient } from "./auth-client";
import { createOrganization, date, getSession, money, tenantApi } from "./api";

type Page = "overview" | "orders" | "products" | "inventory" | "purchasing" | "suppliers" | "customers";

type Product = {
  id: string; name: string; description?: string | null; category_name?: string | null; status: string;
  variants: Array<{ id: string; name: string; sku: string; barcode?: string | null; price_minor: number; cost_minor: number; options: Record<string, string> }>;
};
type Location = { id: string; name: string; code: string };
type InventoryRow = { variant_id: string; product_name: string; variant_name: string; sku: string; barcode?: string | null; location_id: string; location_name: string; on_hand: number; reserved: number; available: number; incoming: number };
type Supplier = { id: string; name: string; email?: string | null; phone?: string | null };
type Customer = { id: string; name: string; email?: string | null; phone?: string | null };
type PurchaseOrder = { id: string; number: string; supplier_name: string; location_name: string; status: string; total_minor: number; currency: string; line_count: number; created_at: string };
type Order = { id: string; number: string; customer_name?: string | null; location_name: string; status: string; fulfilment_status: string; total_minor: number; currency: string; line_count: number; created_at: string };

type NavItem = { id: Page; label: string; icon: typeof LayoutDashboard };
const nav: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: ShoppingCart },
  { id: "products", label: "Products", icon: Boxes },
  { id: "inventory", label: "Inventory", icon: Warehouse },
  { id: "purchasing", label: "Purchase orders", icon: ClipboardList },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "customers", label: "Customers", icon: Users },
];

function App() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: getSession, retry: false });
  const [activeTenantId, setActiveTenantId] = useState(() => localStorage.getItem("ordermate:tenant") || "");
  const [page, setPage] = useState<Page>("overview");
  const [mobileNav, setMobileNav] = useState(false);

  const session = sessionQuery.data;
  const activeTenant = useMemo(() => session?.organizations.find(org => org.id === activeTenantId) ?? session?.organizations[0], [session, activeTenantId]);

  useEffect(() => {
    if (activeTenant && activeTenant.id !== activeTenantId) setActiveTenantId(activeTenant.id);
  }, [activeTenant?.id]);

  useEffect(() => {
    if (activeTenantId) localStorage.setItem("ordermate:tenant", activeTenantId);
  }, [activeTenantId]);

  if (sessionQuery.isLoading) return <LoadingScreen />;
  if (!session) return <SignIn />;
  if (!session.organizations.length) return <CreateBusiness session={session} onCreated={() => queryClient.invalidateQueries({ queryKey: ["session"] })} />;
  if (!activeTenant) return <LoadingScreen />;

  const switchTenant = (tenantId: string) => {
    setActiveTenantId(tenantId);
    setPage("overview");
    queryClient.removeQueries({ queryKey: ["tenant"] });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark">OM</div><div><strong>OrderMate</strong><span>Operations, in order.</span></div></div>
        <button className="tenant-switcher" onClick={() => {}} aria-label="Current business">
          <span className="tenant-avatar"><Building2 size={18} /></span>
          <span><small>Business</small><strong>{activeTenant.name}</strong></span>
          <ChevronDown size={16} />
          <select aria-label="Switch business" value={activeTenant.id} onChange={e => switchTenant(e.target.value)}>
            {session.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {nav.map(item => {
            const Icon = item.icon;
            return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => { setPage(item.id); setMobileNav(false); }}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip"><CircleUserRound size={20} /><span><strong>{session.user.name}</strong><small>{activeTenant.role}</small></span></div>
          <button className="icon-button" title="Sign out" onClick={() => authClient.signOut().then(() => location.reload())}><LogOut size={18} /></button>
        </div>
      </aside>
      {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="global-search"><Search size={17} /><input placeholder="Search products, orders, SKUs…" aria-label="Search" /><kbd>⌘ K</kbd></div>
          <div className="topbar-actions"><span className="role-pill">{activeTenant.role}</span></div>
        </header>
        <div className="workspace">
          {page === "overview" && <Overview tenant={activeTenant} />}
          {page === "products" && <Products tenant={activeTenant} />}
          {page === "inventory" && <Inventory tenant={activeTenant} />}
          {page === "suppliers" && <Suppliers tenant={activeTenant} />}
          {page === "customers" && <Customers tenant={activeTenant} />}
          {page === "purchasing" && <Purchasing tenant={activeTenant} />}
          {page === "orders" && <Orders tenant={activeTenant} />}
        </div>
      </main>
    </div>
  );
}

function LoadingScreen() {
  return <div className="splash"><div className="brand-mark large">OM</div><div className="loader" /></div>;
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  return <div className="auth-page">
    <div className="auth-copy"><div className="brand"><div className="brand-mark">OM</div><strong>OrderMate</strong></div><p className="eyebrow">Inventory without the noise</p><h1>Know what you have.<br />Know what happens next.</h1><p className="lede">Orders, purchasing and multi-location inventory in one calm workspace — designed for the people actually running the operation.</p><div className="auth-points"><span><Archive size={18} /> Complete stock history</span><span><ArrowRightLeft size={18} /> Multi-location by default</span><span><Sparkles size={18} /> Automation-ready workflows</span></div></div>
    <div className="auth-card"><div><p className="eyebrow">Welcome to OrderMate</p><h2>Start with your business</h2><p>Sign in securely with Google. No password to remember.</p></div><button className="google-button" disabled={busy} onClick={async () => { setBusy(true); await authClient.signIn.social({ provider: "google", callbackURL: window.location.origin }); }}><GoogleGlyph />{busy ? "Opening Google…" : "Continue with Google"}</button><small>By continuing you agree to keep your workspace activity attributable for audit and security.</small></div>
  </div>;
}

function GoogleGlyph() { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>; }

function CreateBusiness({ session, onCreated }: { session: SessionPayload; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({ mutationFn: () => createOrganization(name), onSuccess: onCreated });
  return <div className="onboarding"><div className="brand"><div className="brand-mark">OM</div><strong>OrderMate</strong></div><div className="onboarding-card"><div className="step-dot">1</div><p className="eyebrow">Good to meet you, {session.user.name.split(" ")[0]}</p><h1>What should we call your business?</h1><p>This becomes your first isolated OrderMate workspace. You can join or create others later.</p><form onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><label>Business name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Supply Co." /></label>{mutation.error && <ErrorText error={mutation.error} />}<button className="primary" disabled={!name.trim() || mutation.isPending}>Create workspace <PackagePlus size={18} /></button></form></div></div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function Overview({ tenant }: { tenant: OrganizationSummary }) {
  const query = useQuery({ queryKey: ["tenant", tenant.id, "dashboard"], queryFn: () => tenantApi<DashboardSummary>(tenant.id, "/dashboard") });
  const data = query.data;
  return <>
    <PageHeader eyebrow="Today" title={`Morning, ${tenant.name}`} description="The work that needs attention, without hunting for it." />
    <section className="metric-grid">
      <Metric label="Open orders" value={data?.ordersOpen ?? "—"} helper="Draft + confirmed" tone="ink" />
      <Metric label="Awaiting fulfilment" value={data?.ordersAwaitingFulfilment ?? "—"} helper="Ready to pick" tone="amber" />
      <Metric label="Open purchase orders" value={data?.purchaseOrdersOpen ?? "—"} helper="Including partial receipts" tone="blue" />
      <Metric label="Low stock" value={data?.lowStockVariants ?? "—"} helper="Variant/location pairs" tone="rose" />
    </section>
    <section className="overview-grid">
      <div className="panel spotlight"><div className="panel-heading"><div><p className="eyebrow">Inventory position</p><h2>{money(data?.inventoryValueMinor, data?.currency)}</h2></div><Warehouse size={24} /></div><p>Current on-hand inventory valued at recorded variant cost.</p><div className="soft-rule" /><div className="automation-callout"><Sparkles size={18} /><div><strong>Designed for the next layer</strong><span>Purchase-order document intake, receipt matching and replenishment recommendations will sit on the same audited inventory ledger.</span></div></div></div>
      <div className="panel"><div className="panel-heading"><div><p className="eyebrow">Operating model</p><h3>One source of stock truth</h3></div><Archive size={21} /></div><div className="principle-list"><span><i>01</i>Orders reserve before they consume.</span><span><i>02</i>Purchase receipts create stock movements.</span><span><i>03</i>Every mutation records who did it.</span></div></div>
    </section>
  </>;
}

function Metric({ label, value, helper, tone }: { label: string; value: string | number; helper: string; tone: string }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>;
}

function Products({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  return <><PageHeader eyebrow="Catalogue" title="Products" description="Products describe what you sell; variants hold the SKU, barcode, tax, price and stock identity." actions={<button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Add product</button>} />
    <div className="panel table-panel"><DataState loading={query.isLoading} error={query.error} empty={!query.data?.length} emptyText="No products yet. Add your first sellable item."><table><thead><tr><th>Product</th><th>Variants</th><th>SKUs</th><th>Price range</th><th>Status</th></tr></thead><tbody>{query.data?.map(product => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.category_name || "Uncategorised"}</small></td><td>{product.variants.length}</td><td className="mono">{product.variants.slice(0,2).map(v => v.sku).join(", ")}{product.variants.length > 2 ? "…" : ""}</td><td>{priceRange(product.variants)}</td><td><Status value={product.status} /></td></tr>)}</tbody></table></DataState></div>
    {open && <ProductModal tenant={tenant} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "products"] }); }} />}
  </>;
}

function ProductModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", category: "", variant: "Default", sku: "", barcode: "", price: "", cost: "", tax: "20", optionName: "", optionValue: "" });
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/products", { method: "POST", body: JSON.stringify({ name: form.name, category: form.category || undefined, variants: [{ name: form.variant || "Default", sku: form.sku, barcode: form.barcode || undefined, priceMinor: pounds(form.price), costMinor: pounds(form.cost), taxRateBps: Math.round(Number(form.tax || 0) * 100), options: form.optionName && form.optionValue ? { [form.optionName]: form.optionValue } : {} }] }) }), onSuccess: onCreated });
  return <Modal title="Add product" subtitle="Start with one variant. The model supports any number of option dimensions and variants." onClose={onClose}><form className="form-grid" onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><Field label="Product name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Classic T-shirt" /></Field><Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Apparel" /></Field><Field label="Variant name"><input required value={form.variant} onChange={e => setForm({ ...form, variant: e.target.value })} /></Field><Field label="SKU"><input required value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="TSH-BLK-M" /></Field><Field label="Barcode"><input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} inputMode="numeric" /></Field><div /><Field label="Sell price (£)"><input required type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></Field><Field label="Cost (£)"><input type="number" step="0.01" min="0" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></Field><Field label="Tax rate (%)"><input type="number" step="0.01" min="0" value={form.tax} onChange={e => setForm({ ...form, tax: e.target.value })} /></Field><div /><Field label="Option name"><input value={form.optionName} onChange={e => setForm({ ...form, optionName: e.target.value })} placeholder="Size" /></Field><Field label="Option value"><input value={form.optionValue} onChange={e => setForm({ ...form, optionValue: e.target.value })} placeholder="Medium" /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Create product</button></div></form></Modal>;
}

function Inventory({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [locationOpen, setLocationOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "inventory"], queryFn: () => tenantApi<InventoryRow[]>(tenant.id, "/inventory") });
  return <><PageHeader eyebrow="Stock" title="Inventory" description="On hand, reserved, available and incoming stock by sellable variant and location." actions={<><button className="secondary" onClick={() => setLocationOpen(true)}><Store size={17} /> Add location</button><button className="primary" onClick={() => setAdjustOpen(true)}><ArrowRightLeft size={17} /> Adjust stock</button></>} />
    <div className="panel table-panel"><DataState loading={query.isLoading} error={query.error} empty={!query.data?.length} emptyText="Create a product and stock location to start tracking inventory."><table><thead><tr><th>Item</th><th>Location</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Incoming</th></tr></thead><tbody>{query.data?.map((row, i) => <tr key={`${row.variant_id}:${row.location_id}:${i}`}><td><strong>{row.product_name} <span className="muted">· {row.variant_name}</span></strong><small className="mono">{row.sku}{row.barcode ? ` · ${row.barcode}` : ""}</small></td><td>{row.location_name}</td><td>{row.on_hand}</td><td>{row.reserved}</td><td><strong className={row.available <= 5 ? "danger-text" : ""}>{row.available}</strong></td><td>{row.incoming}</td></tr>)}</tbody></table></DataState></div>
    {locationOpen && <LocationModal tenant={tenant} onClose={() => setLocationOpen(false)} onCreated={() => { setLocationOpen(false); qc.invalidateQueries({ queryKey: ["tenant", tenant.id] }); }} />}
    {adjustOpen && <AdjustModal tenant={tenant} rows={query.data || []} onClose={() => setAdjustOpen(false)} onDone={() => { setAdjustOpen(false); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] }); }} />}
  </>;
}

function LocationModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/locations", { method: "POST", body: JSON.stringify({ name, code }) }), onSuccess: onCreated });
  return <Modal title="Add stock location" subtitle="Warehouses, shops and stock rooms all use the same location model." onClose={onClose}><form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="form-grid"><Field label="Location name"><input required value={name} onChange={e => setName(e.target.value)} placeholder="Derby warehouse" /></Field><Field label="Short code"><input required value={code} onChange={e => setCode(e.target.value)} placeholder="DER" maxLength={30} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Add location</button></div></form></Modal>;
}

function AdjustModal({ tenant, rows, onClose, onDone }: { tenant: OrganizationSummary; rows: InventoryRow[]; onClose: () => void; onDone: () => void }) {
  const unique = Array.from(new Map(rows.map(r => [`${r.variant_id}:${r.location_id}`, r])).values());
  const [selection, setSelection] = useState(unique[0] ? `${unique[0].variant_id}:${unique[0].location_id}` : "");
  const [delta, setDelta] = useState(""); const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => { const [variantId, locationId] = selection.split(":"); return tenantApi(tenant.id, "/inventory/adjust", { method: "POST", body: JSON.stringify({ variantId, locationId, quantityDelta: Number(delta), reason }) }); }, onSuccess: onDone });
  return <Modal title="Adjust stock" subtitle="Adjustments are never silent — every change becomes an immutable movement with your user attached." onClose={onClose}><form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="form-grid one"><Field label="Variant / location"><select required value={selection} onChange={e => setSelection(e.target.value)}>{unique.map(r => <option key={`${r.variant_id}:${r.location_id}`} value={`${r.variant_id}:${r.location_id}`}>{r.product_name} · {r.variant_name} — {r.location_name} ({r.available} available)</option>)}</select></Field><Field label="Quantity change"><input required type="number" step="1" value={delta} onChange={e => setDelta(e.target.value)} placeholder="Use -3 to reduce stock" /></Field><Field label="Reason"><input required value={reason} onChange={e => setReason(e.target.value)} placeholder="Cycle count correction, damaged stock…" /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !selection}>Record adjustment</button></div></form></Modal>;
}

function Suppliers({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "suppliers"], queryFn: () => tenantApi<Supplier[]>(tenant.id, "/suppliers") });
  return <><PageHeader eyebrow="Purchasing" title="Suppliers" description="The commercial relationships behind incoming stock." actions={<button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Add supplier</button>} /><CardList items={query.data || []} loading={query.isLoading} empty="No suppliers yet." render={(supplier: Supplier) => <><div className="list-icon"><Truck size={19} /></div><div><strong>{supplier.name}</strong><small>{supplier.email || supplier.phone || "No contact details"}</small></div></>} />{open && <PersonModal kind="supplier" tenant={tenant} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "suppliers"] }); }} />}</>;
}

function Customers({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "customers"], queryFn: () => tenantApi<Customer[]>(tenant.id, "/customers") });
  return <><PageHeader eyebrow="Orders" title="Customers" description="Simple customer records for order history and contact details." actions={<button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Add customer</button>} /><CardList items={query.data || []} loading={query.isLoading} empty="No customers yet." render={(customer: Customer) => <><div className="list-icon"><CircleUserRound size={19} /></div><div><strong>{customer.name}</strong><small>{customer.email || customer.phone || "No contact details"}</small></div></>} />{open && <PersonModal kind="customer" tenant={tenant} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "customers"] }); }} />}</>;
}

function PersonModal({ kind, tenant, onClose, onCreated }: { kind: "supplier" | "customer"; tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, kind === "supplier" ? "/suppliers" : "/customers", { method: "POST", body: JSON.stringify({ name: form.name, email: form.email || undefined, phone: form.phone || undefined }) }), onSuccess: onCreated });
  return <Modal title={`Add ${kind}`} subtitle={kind === "supplier" ? "Supplier records can later hold learned supplier SKUs and lead times." : "Customer details stay within this business workspace."} onClose={onClose}><form className="form-grid" onSubmit={e => { e.preventDefault(); mutation.mutate(); }}><Field label="Name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Email"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field><Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Add {kind}</button></div></form></Modal>;
}

function Purchasing({ tenant }: { tenant: OrganizationSummary }) {
  const query = useQuery({ queryKey: ["tenant", tenant.id, "purchase-orders"], queryFn: () => tenantApi<PurchaseOrder[]>(tenant.id, "/purchase-orders") });
  const qc = useQueryClient();
  const action = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => tenantApi(tenant.id, `/purchase-orders/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id] }) });
  return <><PageHeader eyebrow="Incoming" title="Purchase orders" description="Draft, order and receive stock with commercial values snapshotted at the time of purchase." /><div className="panel table-panel"><DataState loading={query.isLoading} error={query.error} empty={!query.data?.length} emptyText="Purchase order creation UI is the next workflow slice; the transactional purchasing API is already in place."><table><thead><tr><th>PO</th><th>Supplier</th><th>Destination</th><th>Lines</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{query.data?.map(po => <tr key={po.id}><td><strong>{po.number}</strong><small>{date(po.created_at)}</small></td><td>{po.supplier_name}</td><td>{po.location_name}</td><td>{po.line_count}</td><td>{money(po.total_minor, po.currency)}</td><td><Status value={po.status} /></td><td>{po.status === "draft" && <button className="table-action" onClick={() => action.mutate({ id: po.id, action: "submit" })}>Submit</button>}</td></tr>)}</tbody></table></DataState></div></>;
}

function Orders({ tenant }: { tenant: OrganizationSummary }) {
  const query = useQuery({ queryKey: ["tenant", tenant.id, "orders"], queryFn: () => tenantApi<Order[]>(tenant.id, "/orders") });
  const qc = useQueryClient();
  const action = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => tenantApi(tenant.id, `/orders/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id] }) });
  return <><PageHeader eyebrow="Sales" title="Orders" description="Order history is immutable commercial truth: confirmation reserves stock and fulfilment consumes it." /><div className="panel table-panel"><DataState loading={query.isLoading} error={query.error} empty={!query.data?.length} emptyText="Order creation UI is the next workflow slice; the reservation, fulfilment, cancellation and return engine is already in place."><table><thead><tr><th>Order</th><th>Customer</th><th>Location</th><th>Total</th><th>Order</th><th>Fulfilment</th><th /></tr></thead><tbody>{query.data?.map(order => <tr key={order.id}><td><strong>{order.number}</strong><small>{date(order.created_at)}</small></td><td>{order.customer_name || "Guest"}</td><td>{order.location_name}</td><td>{money(order.total_minor, order.currency)}</td><td><Status value={order.status} /></td><td><Status value={order.fulfilment_status} /></td><td className="row-actions">{order.status === "draft" && <button className="table-action" onClick={() => action.mutate({ id: order.id, action: "confirm" })}>Confirm</button>}{order.status === "confirmed" && <button className="table-action" onClick={() => action.mutate({ id: order.id, action: "fulfil" })}>Fulfil</button>}{["draft","confirmed"].includes(order.status) && <button className="table-action quiet" onClick={() => action.mutate({ id: order.id, action: "cancel" })}>Cancel</button>}</td></tr>)}</tbody></table></DataState></div></>;
}

function Status({ value }: { value: string }) { return <span className={`status status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function ErrorText({ error }: { error: unknown }) { return <p className="form-error">{error instanceof Error ? error.message : "Something went wrong"}</p>; }
function pounds(value: string) { return Math.round((Number(value) || 0) * 100); }
function priceRange(variants: Product["variants"]) { if (!variants.length) return "—"; const p = variants.map(v => v.price_minor); const min = Math.min(...p), max = Math.max(...p); return min === max ? money(min) : `${money(min)} – ${money(max)}`; }

function DataState({ loading, error, empty, emptyText, children }: { loading: boolean; error: unknown; empty: boolean; emptyText: string; children: ReactNode }) {
  if (loading) return <div className="empty-state"><div className="loader" /><span>Loading workspace…</span></div>;
  if (error) return <div className="empty-state danger"><strong>Couldn't load this view</strong><span>{error instanceof Error ? error.message : "Unknown error"}</span></div>;
  if (empty) return <div className="empty-state"><Boxes size={28} /><strong>Nothing here yet</strong><span>{emptyText}</span></div>;
  return <>{children}</>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.currentTarget === e.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</section></div>;
}

function CardList<T>({ items, loading, empty, render }: { items: T[]; loading: boolean; empty: string; render: (item: T) => ReactNode }) {
  if (loading) return <div className="panel empty-state"><div className="loader" /></div>;
  if (!items.length) return <div className="panel empty-state"><Users size={28} /><strong>{empty}</strong></div>;
  return <div className="card-list">{items.map((item, i) => <div className="list-card" key={i}>{render(item)}</div>)}</div>;
}

export default App;
