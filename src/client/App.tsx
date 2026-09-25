import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Plus,
  ScanBarcode,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Truck,
  UserCog,
  Users,
  Warehouse,
} from "lucide-react";
import type { Role, SessionPayload } from "../shared/types";
import { authClient } from "./auth-client";
import { controlApi, createOrganization, getSession } from "./api";
import GlobalSearch from "./GlobalSearch";
import Overview from "./pages/Overview";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Purchasing from "./pages/Purchasing";
import Orders from "./pages/Orders";
import WarehouseOps from "./pages/Warehouse";
import Stocktake from "./pages/Stocktake";
import Reports from "./pages/Reports";
import { Customers, Suppliers } from "./pages/People";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import Team from "./pages/Team";
import { ErrorText, Field, Modal } from "./ui";

type Page = "overview" | "orders" | "warehouse" | "stocktake" | "products" | "inventory" | "purchasing" | "suppliers" | "customers" | "reports" | "activity" | "team" | "settings";
type NavItem = { id: Page; label: string; icon: typeof LayoutDashboard };

const nav: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: ShoppingCart },
  { id: "warehouse", label: "Warehouse", icon: ScanBarcode },
  { id: "stocktake", label: "Cycle count", icon: ClipboardCheck },
  { id: "products", label: "Products", icon: Boxes },
  { id: "inventory", label: "Inventory", icon: Warehouse },
  { id: "purchasing", label: "Purchase orders", icon: ClipboardList },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "customers", label: "Customers", icon: Users },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "activity", label: "Activity & data", icon: History },
  { id: "team", label: "Team & roles", icon: UserCog },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function pageVisible(role: Role, page: Page) {
  if (role === "owner" || role === "admin") return true;
  if (page === "warehouse") return role !== "viewer";
  if (page === "stocktake") return role === "manager" || role === "inventory";
  if (page === "team" || page === "settings") return role === "manager" || role === "viewer";
  if (page === "purchasing" || page === "suppliers") return role !== "fulfilment";
  return true;
}

export default function App() {
  const qc = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: getSession, retry: false });
  const [activeTenantId, setActiveTenantId] = useState(() => localStorage.getItem("ordermate:tenant") || "");
  const [page, setPage] = useState<Page>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [newBusinessOpen, setNewBusinessOpen] = useState(false);
  const [inviteAttempted, setInviteAttempted] = useState(false);
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get("invite"), []);
  const session = sessionQuery.data;
  const activeTenant = useMemo(() => session?.organizations.find(org => org.id === activeTenantId) ?? session?.organizations[0], [session, activeTenantId]);

  const acceptInvite = useMutation({
    mutationFn: (token: string) => controlApi<{ ok: true; organizationId: string }>("/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
    onSuccess: async data => {
      setActiveTenantId(data.organizationId);
      localStorage.setItem("ordermate:tenant", data.organizationId);
      window.history.replaceState({}, "", window.location.pathname);
      await qc.invalidateQueries({ queryKey: ["session"] });
    },
  });

  useEffect(() => {
    if (session && inviteToken && !inviteAttempted) {
      setInviteAttempted(true);
      acceptInvite.mutate(inviteToken);
    }
  }, [session?.user.id, inviteToken, inviteAttempted]);

  useEffect(() => {
    if (activeTenant && activeTenant.id !== activeTenantId) setActiveTenantId(activeTenant.id);
  }, [activeTenant?.id]);

  useEffect(() => {
    if (activeTenantId) localStorage.setItem("ordermate:tenant", activeTenantId);
  }, [activeTenantId]);

  useEffect(() => {
    if (activeTenant && !pageVisible(activeTenant.role, page)) setPage("overview");
  }, [activeTenant?.role, page]);

  if (sessionQuery.isLoading) return <LoadingScreen />;
  if (!session) return <SignIn inviteToken={inviteToken} />;
  if (inviteToken && !acceptInvite.isSuccess) return <InviteGate pending={acceptInvite.isPending || !inviteAttempted} error={acceptInvite.error} />;
  if (acceptInvite.isSuccess && !session.organizations.some(org => org.id === activeTenantId)) return <LoadingScreen />;
  if (!session.organizations.length) return <CreateBusiness session={session} onCreated={() => qc.invalidateQueries({ queryKey: ["session"] })} />;
  if (!activeTenant) return <LoadingScreen />;

  const visibleNav = nav.filter(item => pageVisible(activeTenant.role, item.id));
  const navigate = (target: Page) => {
    if (!pageVisible(activeTenant.role, target)) return;
    setPage(target);
    setMobileNav(false);
  };

  const switchTenant = (tenantId: string) => {
    setActiveTenantId(tenantId);
    setPage("overview");
    qc.removeQueries({ queryKey: ["tenant"] });
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark">OM</div><div><strong>OrderMate</strong><span>Operations, in order.</span></div></div>
      <div className="tenant-stack">
        <button className="tenant-switcher" aria-label="Current business">
          <span className="tenant-avatar"><Building2 size={18} /></span>
          <span><small>Business</small><strong>{activeTenant.name}</strong></span>
          <ChevronDown size={16} />
          <select aria-label="Switch business" value={activeTenant.id} onChange={event => switchTenant(event.target.value)}>{session.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>
        </button>
        <button className="new-business" onClick={() => setNewBusinessOpen(true)}><Plus size={14} /> New business</button>
      </div>
      <nav className="main-nav" aria-label="Main navigation">{visibleNav.map(item => { const Icon = item.icon; return <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
      <div className="sidebar-foot"><div className="user-chip"><CircleUserRound size={20} /><span><strong>{session.user.name}</strong><small>{activeTenant.role}</small></span></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => authClient.signOut().then(() => location.reload())}><LogOut size={18} /></button></div>
    </aside>
    {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><GlobalSearch tenant={activeTenant} onNavigate={target => navigate(target as Page)} /><div className="topbar-context"><span className="runtime-dot" /><span>Cloudflare EU</span><small>·</small><span className="role-pill">{activeTenant.role}</span></div></header>
      <div className="workspace">
        {page === "overview" && <Overview tenant={activeTenant} onNavigate={target => navigate(target as Page)} />}
        {page === "orders" && <Orders tenant={activeTenant} />}
        {page === "warehouse" && <WarehouseOps tenant={activeTenant} />}
        {page === "stocktake" && <Stocktake tenant={activeTenant} />}
        {page === "products" && <Products tenant={activeTenant} />}
        {page === "inventory" && <Inventory tenant={activeTenant} />}
        {page === "purchasing" && <Purchasing tenant={activeTenant} />}
        {page === "suppliers" && <Suppliers tenant={activeTenant} />}
        {page === "customers" && <Customers tenant={activeTenant} />}
        {page === "reports" && <Reports tenant={activeTenant} />}
        {page === "activity" && <Activity tenant={activeTenant} />}
        {page === "team" && <Team tenant={activeTenant} />}
        {page === "settings" && <Settings tenant={activeTenant} />}
      </div>
    </main>
    {newBusinessOpen && <NewBusinessModal onClose={() => setNewBusinessOpen(false)} onCreated={() => { setNewBusinessOpen(false); qc.invalidateQueries({ queryKey: ["session"] }); }} />}
  </div>;
}

function LoadingScreen() {
  return <div className="splash"><div className="brand-mark large">OM</div><div className="loader" /></div>;
}

function InviteGate({ pending, error }: { pending: boolean; error: unknown }) {
  if (pending) return <div className="splash"><div className="brand-mark large">OM</div><div className="loader" /><small>Joining your OrderMate workspace…</small></div>;
  return <div className="invite-gate"><div className="brand"><div className="brand-mark">OM</div><strong>OrderMate</strong></div><div className="invite-gate-card"><p className="eyebrow">Invite couldn't be accepted</p><h1>Check the Google account you used.</h1><ErrorText error={error} /><p>Invite links are email-bound and expire after seven days. Sign out if you need to use a different Google account.</p><div><button className="secondary" onClick={() => authClient.signOut().then(() => location.reload())}>Sign out</button><button className="primary" onClick={() => { window.history.replaceState({}, "", window.location.pathname); location.reload(); }}>Open OrderMate</button></div></div></div>;
}

function SignIn({ inviteToken }: { inviteToken: string | null }) {
  const [busy, setBusy] = useState(false);
  const callbackURL = inviteToken ? `${window.location.origin}/?invite=${encodeURIComponent(inviteToken)}` : window.location.origin;
  return <div className="auth-page">
    <div className="auth-copy"><div className="brand"><div className="brand-mark">OM</div><strong>OrderMate</strong></div><p className="eyebrow">Inventory without the noise</p><h1>Know what you have.<br />Know what happens next.</h1><p className="lede">Orders, purchasing and multi-location inventory in one calm workspace — designed for the people actually running the operation.</p><div className="auth-points"><span><Warehouse size={18} /> Complete stock history</span><span><ClipboardList size={18} /> Purchase-to-receipt workflow</span><span><Sparkles size={18} /> Automation-ready operations</span></div></div>
    <div className="auth-card"><div><p className="eyebrow">{inviteToken ? "You've been invited" : "Welcome to OrderMate"}</p><h2>{inviteToken ? "Join your business workspace" : "Start with your business"}</h2><p>Sign in securely with Google. {inviteToken ? "Use the Google account the invitation was sent to." : "No separate OrderMate password to store or reset."}</p></div><button className="google-button" disabled={busy} onClick={async () => { setBusy(true); await authClient.signIn.social({ provider: "google", callbackURL }); }}><GoogleGlyph />{busy ? "Opening Google…" : "Continue with Google"}</button><small>Workspace mutations are attributable to the signed-in member for audit and security.</small></div>
  </div>;
}

function GoogleGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.24-.2-1.8H12v3.45h5.52a4.72 4.72 0 0 1-2.05 3.01l-.02.12 2.98 2.31.2.02c1.85-1.7 2.97-4.22 2.97-7.11Z"/><path fill="#34A853" d="M12 22c2.68 0 4.93-.88 6.57-2.4l-3.13-2.43c-.84.57-1.98.97-3.44.97a5.98 5.98 0 0 1-5.66-4.13l-.11.01-3.1 2.4-.04.11A9.92 9.92 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.34 14.01A6.1 6.1 0 0 1 6 12c0-.7.12-1.38.33-2.01v-.12L3.2 7.43l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.09 4.52l3.25-2.51Z"/><path fill="#EA4335" d="M12 5.86c1.86 0 3.12.8 3.84 1.47l2.8-2.73C16.92 3 14.68 2 12 2a9.92 9.92 0 0 0-8.91 5.48l3.24 2.51A5.99 5.99 0 0 1 12 5.86Z"/></svg>;
}

function CreateBusiness({ session, onCreated }: { session: SessionPayload; onCreated: () => void }) {
  return <div className="onboarding"><div className="brand"><div className="brand-mark">OM</div><strong>OrderMate</strong></div><BusinessForm greeting={`Good to meet you, ${session.user.name.split(" ")[0]}`} onCreated={onCreated} /></div>;
}

function BusinessForm({ greeting, onCreated }: { greeting?: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({ mutationFn: () => createOrganization(name), onSuccess: onCreated });
  return <div className="onboarding-card"><div className="step-dot">1</div><p className="eyebrow">{greeting || "New workspace"}</p><h1>What should we call the business?</h1><p>Each business gets its own physically isolated operational datastore. Membership determines who can route into it.</p><form onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><label>Business name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Acme Supply Co." /></label>{mutation.error && <ErrorText error={mutation.error} />}<button className="primary" disabled={!name.trim() || mutation.isPending}>Create workspace <PackagePlus size={18} /></button></form></div>;
}

function NewBusinessModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({ mutationFn: () => createOrganization(name), onSuccess: onCreated });
  return <Modal title="Create another business" subtitle="Your user can belong to multiple businesses; operational data remains isolated per business." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="Business name"><input autoFocus required value={name} onChange={event => setName(event.target.value)} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Create business</button></div></form></Modal>;
}
