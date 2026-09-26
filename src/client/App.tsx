import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  CircleUserRound,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  History,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  PlayCircle,
  Plus,
  RotateCcw,
  ScanBarcode,
  Settings as SettingsIcon,
  ShoppingCart,
  Truck,
  UserCog,
  Warehouse,
  Wrench,
} from "lucide-react";
import type { WorkspaceModuleKey } from "../shared/modules";
import type { Role, SessionPayload } from "../shared/types";
import { controlApi, createOrganization, getSession, tenantApi } from "./api";
import { BrandLockup, BrandMark } from "./Brand";
import { chooseDemoProfile, DEMO_PROFILES, getDemoProfile, type DemoProfileKey } from "./demo-profiles";
import { resetDemoService } from "./demo-service";
import { enterDemoMode, exitDemoMode, isDemoTenant, resetDemoData } from "./demo-store";
import GlobalSearch from "./GlobalSearch";
import LandingPage from "./LandingPage";
import { ErrorText, Field, Modal } from "./ui";

const WorkspaceStyles = lazy(() => import("./WorkspaceStyles"));
const Overview = lazy(() => import("./pages/Overview"));
const CRM = lazy(() => import("./pages/CRM"));
const Service = lazy(() => import("./pages/Service"));
const Products = lazy(() => import("./pages/Products"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Purchasing = lazy(() => import("./pages/Purchasing"));
const Orders = lazy(() => import("./pages/Orders"));
const WarehouseOps = lazy(() => import("./pages/Warehouse"));
const WavePickingPage = lazy(() => import("./pages/WavePickingPage"));
const Stocktake = lazy(() => import("./pages/Stocktake"));
const Reports = lazy(() => import("./pages/Reports"));
const Activity = lazy(() => import("./pages/Activity"));
const Settings = lazy(() => import("./pages/Settings"));
const Team = lazy(() => import("./pages/Team"));
const Suppliers = lazy(() => import("./pages/People").then(module => ({ default: module.Suppliers })));

type Page = "overview" | "crm" | "service" | "orders" | "warehouse" | "wave-pick" | "stocktake" | "products" | "inventory" | "purchasing" | "suppliers" | "reports" | "activity" | "team" | "settings";
type NavItem = { id: Page; label: string; icon: typeof LayoutDashboard; module?: WorkspaceModuleKey };
type ModulesResponse = { modules: Array<{ key: WorkspaceModuleKey; enabled: boolean }> };

const TENANT_STORAGE_KEY = "operating-layer:tenant";
const LEGACY_TENANT_STORAGE_KEY = "ordermate:tenant";

const nav: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "crm", label: "CRM", icon: ContactRound, module: "crm" },
  { id: "service", label: "Service", icon: Wrench, module: "service" },
  { id: "orders", label: "Orders", icon: ShoppingCart, module: "orders" },
  { id: "warehouse", label: "Warehouse", icon: ScanBarcode, module: "warehouse" },
  { id: "wave-pick", label: "Wave picking", icon: Layers3, module: "warehouse" },
  { id: "stocktake", label: "Cycle count", icon: ClipboardCheck, module: "inventory" },
  { id: "products", label: "Products", icon: Boxes, module: "inventory" },
  { id: "inventory", label: "Inventory", icon: Warehouse, module: "inventory" },
  { id: "purchasing", label: "Purchase orders", icon: ClipboardList, module: "purchasing" },
  { id: "suppliers", label: "Suppliers", icon: Truck, module: "purchasing" },
  { id: "reports", label: "Reports", icon: BarChart3, module: "reports" },
  { id: "activity", label: "Activity & data", icon: History },
  { id: "team", label: "Team & roles", icon: UserCog },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function pageVisible(role: Role, page: Page) {
  if (role === "owner" || role === "admin") return true;
  if (page === "wave-pick") return role === "manager" || role === "fulfilment";
  if (page === "warehouse") return role !== "viewer";
  if (page === "stocktake") return role === "manager" || role === "inventory";
  if (page === "reports") return role !== "fulfilment";
  if (page === "team" || page === "settings") return role === "manager" || role === "viewer";
  if (page === "purchasing" || page === "suppliers") return role !== "fulfilment";
  return true;
}

async function signOut() {
  const { authClient } = await import("./auth-client");
  await authClient.signOut();
  location.reload();
}

function leaveDemo() {
  exitDemoMode();
  localStorage.removeItem(TENANT_STORAGE_KEY);
  location.reload();
}

export default function App() {
  const qc = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: getSession, retry: false });
  const [activeTenantId, setActiveTenantId] = useState(() => localStorage.getItem(TENANT_STORAGE_KEY) || localStorage.getItem(LEGACY_TENANT_STORAGE_KEY) || "");
  const [page, setPage] = useState<Page>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [newBusinessOpen, setNewBusinessOpen] = useState(false);
  const [inviteAttempted, setInviteAttempted] = useState(false);
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get("invite"), []);
  const session = sessionQuery.data;
  const activeTenant = useMemo(() => session?.organizations.find(org => org.id === activeTenantId) ?? session?.organizations[0], [session, activeTenantId]);
  const demo = isDemoTenant(activeTenant?.id);
  const demoProfile = demo ? getDemoProfile() : null;

  const modules = useQuery({
    queryKey: ["tenant", activeTenant?.id, "modules"],
    queryFn: () => tenantApi<ModulesResponse>(activeTenant!.id, "/modules"),
    enabled: !!activeTenant,
  });
  const enabledModules = useMemo(() => new Set(modules.data?.modules.filter(module => module.enabled).map(module => module.key) || []), [modules.data]);

  const acceptInvite = useMutation({
    mutationFn: (token: string) => controlApi<{ ok: true; organizationId: string }>("/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
    onSuccess: async data => {
      setActiveTenantId(data.organizationId);
      localStorage.setItem(TENANT_STORAGE_KEY, data.organizationId);
      localStorage.removeItem(LEGACY_TENANT_STORAGE_KEY);
      window.history.replaceState({}, "", window.location.pathname);
      await qc.invalidateQueries({ queryKey: ["session"] });
    },
  });

  useEffect(() => {
    if (session && inviteToken && !inviteAttempted && !session.organizations.some(org => isDemoTenant(org.id))) {
      setInviteAttempted(true);
      acceptInvite.mutate(inviteToken);
    }
  }, [session?.user.id, inviteToken, inviteAttempted]);

  useEffect(() => {
    if (activeTenant && activeTenant.id !== activeTenantId) setActiveTenantId(activeTenant.id);
  }, [activeTenant?.id]);

  useEffect(() => {
    if (activeTenantId) {
      localStorage.setItem(TENANT_STORAGE_KEY, activeTenantId);
      localStorage.removeItem(LEGACY_TENANT_STORAGE_KEY);
    }
  }, [activeTenantId]);

  const moduleForPage = nav.find(item => item.id === page)?.module;
  useEffect(() => {
    if (!activeTenant) return;
    if (!pageVisible(activeTenant.role, page) || moduleForPage && modules.data && !enabledModules.has(moduleForPage)) setPage("overview");
  }, [activeTenant?.role, page, moduleForPage, modules.data, enabledModules]);

  if (sessionQuery.isLoading) {
    return activeTenantId ? <LoadingScreen /> : <LandingWithDemo inviteToken={inviteToken} />;
  }
  if (!session) return <LandingWithDemo inviteToken={inviteToken} />;
  if (inviteToken && !demo && !acceptInvite.isSuccess) return <InviteGate pending={acceptInvite.isPending || !inviteAttempted} error={acceptInvite.error} />;
  if (acceptInvite.isSuccess && !session.organizations.some(org => org.id === activeTenantId)) return <LoadingScreen />;
  if (!session.organizations.length) return <CreateBusiness session={session} onCreated={() => qc.invalidateQueries({ queryKey: ["session"] })} />;
  if (!activeTenant) return <LoadingScreen />;

  const visibleNav = nav.filter(item => pageVisible(activeTenant.role, item.id) && (!item.module || !modules.data || enabledModules.has(item.module)));
  const navigate = (target: Page) => {
    const targetNav = nav.find(item => item.id === target);
    if (!pageVisible(activeTenant.role, target)) return;
    if (targetNav?.module && modules.data && !enabledModules.has(targetNav.module)) return;
    setPage(target);
    setMobileNav(false);
  };

  const switchTenant = (tenantId: string) => {
    setActiveTenantId(tenantId);
    setPage("overview");
    qc.removeQueries({ queryKey: ["tenant"] });
  };

  const resetDemo = () => {
    resetDemoData();
    resetDemoService();
    if (demoProfile) chooseDemoProfile(demoProfile.key);
    qc.clear();
    location.reload();
  };

  return <Suspense fallback={<LoadingScreen />}>
    <WorkspaceStyles />
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <BrandLockup inverse />
        <div className="tenant-stack">
          <button type="button" className="tenant-switcher" aria-label="Current business">
            <span className="tenant-avatar"><Building2 size={18} /></span>
            <span><small>{demo ? demoProfile?.name || "Guest demo" : "Business"}</small><strong>{activeTenant.name}</strong></span>
            {!demo && <ChevronDown size={16} />}
            {!demo && <select aria-label="Switch business" value={activeTenant.id} onChange={event => switchTenant(event.target.value)}>{session.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>}
          </button>
          {!demo && <button type="button" className="new-business" onClick={() => setNewBusinessOpen(true)}><Plus size={14} /> New business</button>}
        </div>
        <nav className="main-nav" aria-label="Main navigation">{visibleNav.map(item => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>; })}</nav>
        <div className="sidebar-foot"><div className="user-chip"><CircleUserRound size={20} /><span><strong>{session.user.name}</strong><small>{demo ? "Local demo" : activeTenant.role}</small></span></div><button type="button" className="icon-button" title={demo ? "Exit demo" : "Sign out"} aria-label={demo ? "Exit demo" : "Sign out"} onClick={() => demo ? leaveDemo() : void signOut()}><LogOut size={18} /></button></div>
      </aside>
      {mobileNav && <button type="button" className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main">
        <header className="topbar"><button type="button" className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><GlobalSearch tenant={activeTenant} onNavigate={target => navigate(target as Page)} /><div className="topbar-context"><span className="runtime-dot" /><span>{demo ? "Browser only" : "Cloudflare EU"}</span><small>·</small><span className="role-pill">{demo ? "demo" : activeTenant.role}</span></div></header>
        <div className="workspace">
          {demo && <div className="demo-workspace-banner" role="status"><div><strong>{demoProfile?.businessName} · local guest demo</strong><span>{demoProfile?.workstream}. Changes are saved only in this browser and reset independently from production.</span></div><div><button type="button" className="secondary" onClick={resetDemo}><RotateCcw size={14} /> Reset demo</button><button type="button" className="secondary" onClick={leaveDemo}>Choose another demo</button></div></div>}
          {modules.error && !demo && <div className="form-error" role="alert">Module configuration could not be loaded. Navigation is showing the safe default set; refresh before changing workspace configuration.</div>}
          <Suspense fallback={<WorkspaceLoading />}>
            {page === "overview" && <Overview tenant={activeTenant} onNavigate={target => navigate(target as Page)} />}
            {page === "crm" && <CRM tenant={activeTenant} />}
            {page === "service" && <Service tenant={activeTenant} />}
            {page === "orders" && <Orders tenant={activeTenant} />}
            {page === "warehouse" && <WarehouseOps tenant={activeTenant} />}
            {page === "wave-pick" && <WavePickingPage tenant={activeTenant} />}
            {page === "stocktake" && <Stocktake tenant={activeTenant} />}
            {page === "products" && <Products tenant={activeTenant} />}
            {page === "inventory" && <Inventory tenant={activeTenant} />}
            {page === "purchasing" && <Purchasing tenant={activeTenant} />}
            {page === "suppliers" && <Suppliers tenant={activeTenant} />}
            {page === "reports" && <Reports tenant={activeTenant} />}
            {page === "activity" && <Activity tenant={activeTenant} />}
            {page === "team" && <Team tenant={activeTenant} />}
            {page === "settings" && <Settings tenant={activeTenant} />}
          </Suspense>
        </div>
      </main>
      {newBusinessOpen && !demo && <NewBusinessModal onClose={() => setNewBusinessOpen(false)} onCreated={() => { setNewBusinessOpen(false); qc.invalidateQueries({ queryKey: ["session"] }); }} />}
    </div>
  </Suspense>;
}

function LandingWithDemo({ inviteToken }: { inviteToken: string | null }) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const startDemo = (profileKey: DemoProfileKey) => {
    chooseDemoProfile(profileKey);
    resetDemoData();
    resetDemoService();
    enterDemoMode();
    localStorage.setItem(TENANT_STORAGE_KEY, "demo-local-workspace");
    location.reload();
  };

  return <>
    <LandingPage inviteToken={inviteToken} />
    {!inviteToken && <aside className="demo-launcher" aria-label="Guest demos">
      <div><span>NO ACCOUNT NEEDED</span><strong>Explore real business workstreams</strong><small>Six local demo profiles · browser storage only · reset anytime</small></div>
      <button type="button" onClick={() => setChooserOpen(true)}><PlayCircle size={17} /> Choose demo</button>
    </aside>}
    {chooserOpen && <Modal title="Choose a business demo" subtitle="Each profile enables only the modules that business needs. Electrician and salon include a playable CRM + request-to-invoice service lifecycle." onClose={() => setChooserOpen(false)} wide>
      <div className="demo-profile-grid">{DEMO_PROFILES.map(profile => <button type="button" className="demo-profile-card" key={profile.key} onClick={() => startDemo(profile.key)}>
        <span className="demo-profile-kicker">{profile.name}</span><strong>{profile.businessName.replace(" — Demo", "")}</strong><p>{profile.description}</p><small>{profile.workstream}</small><span className="demo-profile-open">Open demo →</span>
      </button>)}</div>
    </Modal>}
  </>;
}

function LoadingScreen() {
  return <div className="splash"><BrandMark title="Operating Layer" /><div className="loader" /></div>;
}

function WorkspaceLoading() {
  return <div className="empty-state" role="status" aria-live="polite"><div className="loader" /><span>Loading workspace…</span></div>;
}

function InviteGate({ pending, error }: { pending: boolean; error: unknown }) {
  if (pending) return <div className="splash"><BrandMark title="Operating Layer" /><div className="loader" /><small>Joining your Operating Layer workspace…</small></div>;
  return <div className="invite-gate"><BrandLockup /><div className="invite-gate-card"><p className="eyebrow">Invite couldn’t be accepted</p><h1>Check the Google account you used.</h1><ErrorText error={error} /><p>Invite links are email-bound and expire after seven days. Sign out if you need to use a different Google account.</p><div><button type="button" className="secondary" onClick={() => void signOut()}>Sign out</button><button type="button" className="primary" onClick={() => { window.history.replaceState({}, "", window.location.pathname); location.reload(); }}>Open Operating Layer</button></div></div></div>;
}

function CreateBusiness({ session, onCreated }: { session: SessionPayload; onCreated: () => void }) {
  return <div className="onboarding"><BrandLockup /><BusinessForm greeting={`Good to meet you, ${session.user.name.split(" ")[0]}`} onCreated={onCreated} /></div>;
}

function BusinessForm({ greeting, onCreated }: { greeting?: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({ mutationFn: () => createOrganization(name), onSuccess: onCreated });
  return <div className="onboarding-card"><div className="step-dot">1</div><p className="eyebrow">{greeting || "New workspace"}</p><h1>What should we call the business?</h1><p>Each business gets its own physically isolated operational datastore. Membership determines who can route into it.</p><form onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><label>Business name<input autoFocus name="business-name" autoComplete="organization" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Acme Supply Co.…" /></label>{mutation.error && <ErrorText error={mutation.error} />}<button type="submit" className="primary" disabled={!name.trim() || mutation.isPending}>Create workspace <PackagePlus size={18} /></button></form></div>;
}

function NewBusinessModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({ mutationFn: () => createOrganization(name), onSuccess: onCreated });
  return <Modal title="Create another business" subtitle="Your user can belong to multiple businesses; operational data remains isolated per business." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="Business name"><input autoFocus required name="business-name" autoComplete="organization" value={name} onChange={event => setName(event.target.value)} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={mutation.isPending}>Create business</button></div></form></Modal>;
}
