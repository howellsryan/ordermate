import type { WorkspaceModuleKey } from "../shared/modules";
import type { DashboardSummary, SessionPayload } from "../shared/types";
import type { AttentionResponse, InventoryRow, Product, SearchResult, WorkspacePage } from "./model";
import { demoControlApi } from "./demo-acceptance";
import { demoBusinessProfileApi } from "./demo-business-profile";
import { demoOpsApi } from "./demo-attention";
import { demoCsv } from "./demo-export";
import { demoModuleEnabled, demoModulesApi } from "./demo-modules";
import { demoOperatingIntelligence } from "./demo-operating-intelligence";
import { getDemoProfile } from "./demo-profiles";
import { demoServiceApi } from "./demo-service";
import { demoSession, isDemoMode, isDemoTenant } from "./demo-store";
import { demoDeleteSupplierVariant, demoSaveSupplierVariant, demoSupplierVariants } from "./demo-supplier-ordering";
import { demoTenantApi } from "./demo-stocktake";

export async function errorFrom(response: Response) {
  const payload: unknown = await response.json().catch(() => ({ error: response.statusText }));
  const message = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : `Request failed (${response.status})`;
  return new Error(message);
}

export async function getSession(): Promise<SessionPayload | null> {
  if (isDemoMode()) {
    const session = demoSession();
    const profile = getDemoProfile();
    return { ...session, organizations: session.organizations.map(organization => ({ ...organization, name: profile.businessName })) };
  }

  const authResponse = await fetch("/api/auth/get-session", { credentials: "include" });
  if (!authResponse.ok) throw await errorFrom(authResponse);
  const authSession: unknown = await authResponse.json();
  if (!authSession) return null;

  const response = await fetch("/api/session", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function createOrganization(name: string) {
  return controlApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function controlApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (isDemoMode()) {
    const method = (init?.method || "GET").toUpperCase();
    const pathname = new URL(path, "https://demo.local").pathname;
    if (method === "GET" && pathname === "/delivery-documents/sources") return { sources: [], truncated: false } as T;
    if (method === "GET" && pathname === "/delivery-documents/proposals") return { proposals: [], truncated: false } as T;
    if (method === "GET" && pathname === "/delivery-documents/proposal") return demoControlApi<T>(path, init);
    if (pathname.startsWith("/delivery-documents")) throw new Error("Delivery-document upload and AI extraction are disabled in the local guest demo because files never leave this browser.");
    return demoControlApi<T>(path, init);
  }

  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

async function activeDemoVariantIds() {
  const products = await demoTenantApi<Product[]>("/products");
  return new Set(products.filter(product => product.status === "active").flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => variant.id)));
}

async function validateDemoInvoiceIssue(pathname: string) {
  const invoiceId = pathname.match(/^\/service\/invoices\/([^/]+)\/issue$/)?.[1];
  if (!invoiceId) return;

  type Invoice = { id: string; case_id: string; job_id: string | null; tax_minor: number; supply_date: string | null };
  const invoices = await demoServiceApi<{ invoices: Invoice[] }>("/service/invoices");
  const invoice = invoices.invoices.find(item => item.id === invoiceId);
  if (!invoice) throw new Error("Service invoice not found");

  const profile = await demoBusinessProfileApi<{ address: Record<string, unknown> | null; vatNumber: string | null }>("/business-profile");
  if (!profile.address) throw new Error("Business name and business address are required before an invoice can be issued");
  if (invoice.tax_minor > 0 && !profile.vatNumber) throw new Error("VAT number is required before an invoice containing VAT can be issued");

  const serviceCase = await demoServiceApi<{ contact_id: string; jobs: Array<{ id: string; completed_at: string | null }> }>(`/service/cases/${invoice.case_id}`);
  const contact = await demoServiceApi<{ address: Record<string, unknown> | null }>(`/crm/contacts/${serviceCase.contact_id}`);
  if (!contact.address) throw new Error("Customer address is required before an invoice can be issued");

  if (!invoice.supply_date) {
    const job = invoice.job_id ? serviceCase.jobs.find(item => item.id === invoice.job_id) : null;
    if (!job?.completed_at) throw new Error("Supply date is required before an invoice can be issued");
  }
}

export async function tenantApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  if (isDemoTenant(tenantId)) {
    const method = (init?.method || "GET").toUpperCase();
    const pathname = new URL(path, "https://demo.local").pathname;
    if (pathname === "/modules" || pathname.startsWith("/modules/")) return await demoModulesApi(path, init) as T;
    if (pathname === "/business-profile") return await demoBusinessProfileApi<T>(path, init);
    if (pathname.startsWith("/crm/") && !demoModuleEnabled("crm")) throw new Error("CRM is disabled for this workspace.");
    if (pathname.startsWith("/service/") && !demoModuleEnabled("service")) throw new Error("Service is disabled for this workspace.");
    if (method === "POST" && /^\/service\/invoices\/[^/]+\/issue$/.test(pathname)) await validateDemoInvoiceIssue(pathname);
    if (pathname.startsWith("/crm/") || pathname.startsWith("/service/")) return await demoServiceApi<T>(path, init);
    if (method === "GET" && pathname === "/supplier-variants") return await demoSupplierVariants() as T;
    if (method === "POST" && pathname === "/supplier-variants") return await demoSaveSupplierVariant(init) as T;
    if (method === "DELETE" && /^\/supplier-variants\/[^/]+\/[^/]+$/.test(pathname)) return await demoDeleteSupplierVariant(path, init) as T;
    if (method === "GET" && pathname === "/replenishment") return await demoOperatingIntelligence() as T;

    const result = await demoTenantApi<unknown>(path, init);
    if (method === "GET" && pathname === "/dashboard") {
      const activeVariants = await activeDemoVariantIds();
      const inventory = await demoTenantApi<InventoryRow[]>("/inventory");
      const settings = await demoTenantApi<{ low_stock_threshold: number }>("/settings");
      const data = result as DashboardSummary;
      return {
        ...data,
        lowStockVariants: inventory.filter(row => activeVariants.has(row.variant_id) && row.tracked !== 0 && row.available <= settings.low_stock_threshold).length,
      } as T;
    }
    return result as T;
  }

  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/tenant${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

type ModulesResponse = { modules: Array<{ key: WorkspaceModuleKey; enabled: boolean }> };
type SearchOrder = { id: string; number: string; customer_name?: string | null; location_name: string; status: string; fulfilment_status: string; priority?: string; required_by_date?: string | null; created_at: string };
type SearchPurchaseOrder = { id: string; number: string; supplier_name: string; location_name: string; status: string; expected_delivery_date?: string | null };
type SearchPerson = { id: string; name: string; email?: string | null; phone?: string | null };
type SearchContact = { id: string; name: string; email?: string | null; mobile?: string | null; source?: string | null; lifecycle_stage: string };
type SearchServiceCase = { id: string; number: string; contact_name: string; title: string; summary?: string | null; source?: string | null; status: string };

const PAGE_MODULE: Partial<Record<WorkspacePage, WorkspaceModuleKey>> = {
  crm: "crm",
  customers: "crm",
  service: "service",
  orders: "orders",
  warehouse: "warehouse",
  "wave-pick": "warehouse",
  stocktake: "inventory",
  products: "inventory",
  inventory: "inventory",
  purchasing: "purchasing",
  suppliers: "purchasing",
  reports: "reports",
};

function normalizedPage(page: WorkspacePage): WorkspacePage {
  return page === "customers" ? "crm" : page;
}

function includesQuery(value: unknown, query: string) {
  return value !== null && value !== undefined && String(value).toLocaleLowerCase().includes(query);
}

async function safeTenantRead<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

function moduleSet(response: ModulesResponse) {
  return new Set(response.modules.filter(module => module.enabled).map(module => module.key));
}

async function directSearch(tenantId: string, query: string, enabled: Set<WorkspaceModuleKey>): Promise<{ results: SearchResult[] }> {
  const [products, orders, purchaseOrders, suppliers, contacts, cases] = await Promise.all([
    enabled.has("inventory") ? safeTenantRead(tenantApi<Product[]>(tenantId, "/products"), []) : Promise.resolve([] as Product[]),
    enabled.has("orders") ? safeTenantRead(tenantApi<SearchOrder[]>(tenantId, "/orders"), []) : Promise.resolve([] as SearchOrder[]),
    enabled.has("purchasing") ? safeTenantRead(tenantApi<SearchPurchaseOrder[]>(tenantId, "/purchase-orders"), []) : Promise.resolve([] as SearchPurchaseOrder[]),
    enabled.has("purchasing") ? safeTenantRead(tenantApi<SearchPerson[]>(tenantId, "/suppliers"), []) : Promise.resolve([] as SearchPerson[]),
    enabled.has("crm") ? safeTenantRead(tenantApi<{ contacts: SearchContact[] }>(tenantId, "/crm/contacts"), { contacts: [] }) : Promise.resolve({ contacts: [] as SearchContact[] }),
    enabled.has("service") ? safeTenantRead(tenantApi<{ cases: SearchServiceCase[] }>(tenantId, "/service/cases"), { cases: [] }) : Promise.resolve({ cases: [] as SearchServiceCase[] }),
  ]);

  const results: SearchResult[] = [];
  for (const product of products) {
    const archived = product.status === "archived" ? "Archived · " : "";
    if ([product.name, product.category_name].some(value => includesQuery(value, query))) {
      results.push({ id: product.id, type: "Product", title: product.name, subtitle: `${archived}${product.category_name || `${product.variants.length} variants`}`, page: "products" });
    }
    for (const variant of product.variants) {
      const optionText = Object.values(variant.options || {}).join(" ");
      if (![product.name, variant.name, variant.sku, variant.barcode, optionText].some(value => includesQuery(value, query))) continue;
      results.push({ id: variant.id, type: "Variant", title: `${product.name} · ${variant.name}`, subtitle: `${archived}${[variant.sku, variant.barcode].filter(Boolean).join(" · ")}`, page: "products", badge: variant.sku });
    }
  }
  for (const order of orders) {
    if (![order.number, order.customer_name, order.location_name, order.status, order.fulfilment_status, order.priority, order.required_by_date].some(value => includesQuery(value, query))) continue;
    results.push({ id: order.id, type: "Order", title: order.number, subtitle: `${order.customer_name || "Guest"} · ${order.fulfilment_status.replaceAll("_", " ")}`, page: "orders", badge: order.status });
  }
  for (const po of purchaseOrders) {
    if (![po.number, po.supplier_name, po.location_name, po.status, po.expected_delivery_date].some(value => includesQuery(value, query))) continue;
    results.push({ id: po.id, type: "Purchase order", title: po.number, subtitle: `${po.supplier_name} · ${po.location_name}${po.expected_delivery_date ? ` · expected ${po.expected_delivery_date}` : ""}`, page: "purchasing", badge: po.status });
  }
  for (const supplier of suppliers) {
    if (![supplier.name, supplier.email, supplier.phone].some(value => includesQuery(value, query))) continue;
    results.push({ id: supplier.id, type: "Supplier", title: supplier.name, subtitle: supplier.email || supplier.phone || "Saved supplier", page: "suppliers" });
  }
  for (const contact of contacts.contacts) {
    if (![contact.name, contact.email, contact.mobile, contact.source].some(value => includesQuery(value, query))) continue;
    results.push({ id: contact.id, type: contact.lifecycle_stage === "prospect" ? "Prospect" : "Customer", title: contact.name, subtitle: contact.email || contact.mobile || contact.source || "CRM contact", page: "crm", badge: contact.lifecycle_stage });
  }
  for (const serviceCase of cases.cases) {
    if (![serviceCase.number, serviceCase.contact_name, serviceCase.title, serviceCase.summary, serviceCase.source, serviceCase.status].some(value => includesQuery(value, query))) continue;
    results.push({ id: serviceCase.id, type: "Service", title: `${serviceCase.number} · ${serviceCase.title}`, subtitle: `${serviceCase.contact_name} · ${serviceCase.status}`, page: "service", badge: serviceCase.status });
  }

  const unique = new Map<string, SearchResult>();
  for (const result of results) unique.set(`${result.page}:${result.id}`, result);
  return { results: [...unique.values()].slice(0, 30) };
}

async function directAttention(tenantId: string, enabled: Set<WorkspaceModuleKey>): Promise<AttentionResponse> {
  const items: AttentionResponse["items"] = [];
  if (enabled.has("inventory")) {
    const [inventory, settings, products] = await Promise.all([
      safeTenantRead(tenantApi<InventoryRow[]>(tenantId, "/inventory"), []),
      safeTenantRead(tenantApi<{ low_stock_threshold: number }>(tenantId, "/settings"), { low_stock_threshold: 0 }),
      safeTenantRead(tenantApi<Product[]>(tenantId, "/products"), []),
    ]);
    const active = new Set(products.filter(product => product.status === "active").flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => variant.id)));
    for (const row of inventory.filter(row => active.has(row.variant_id) && row.tracked !== 0 && row.available <= settings.low_stock_threshold).slice(0, 12)) {
      items.push({ id: `stock:${row.variant_id}:${row.location_id}`, severity: row.available <= 0 ? "critical" : "warning", type: row.available <= 0 ? "Stockout" : "Low stock", title: `${row.product_name} · ${row.variant_name}`, detail: `${row.available} available at ${row.location_name}${row.incoming ? ` · ${row.incoming} incoming` : ""}`, page: "inventory" });
    }
  }
  if (enabled.has("orders")) {
    const orders = await safeTenantRead(tenantApi<SearchOrder[]>(tenantId, "/orders"), []);
    const today = new Date().toISOString().slice(0, 10);
    const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;
    const confirmed = orders.filter(order => order.status === "confirmed").sort((a, b) => {
      const overdueA = !!a.required_by_date && a.required_by_date < today;
      const overdueB = !!b.required_by_date && b.required_by_date < today;
      if (overdueA !== overdueB) return overdueA ? -1 : 1;
      return (rank[a.priority || "normal"] ?? 2) - (rank[b.priority || "normal"] ?? 2) || (a.required_by_date || "9999-12-31").localeCompare(b.required_by_date || "9999-12-31");
    });
    for (const order of confirmed.slice(0, 10)) {
      const overdue = !!order.required_by_date && order.required_by_date < today;
      items.push({ id: `order:${order.id}`, severity: overdue ? "critical" : "warning", type: overdue ? "Required-by overdue" : order.priority === "urgent" ? "Urgent fulfilment" : "Awaiting fulfilment", title: order.number, detail: `${order.customer_name || "Guest"} · ${order.location_name}${order.required_by_date ? ` · required ${order.required_by_date}` : ""}`, page: "orders" });
    }
  }
  if (enabled.has("purchasing")) {
    const purchaseOrders = await safeTenantRead(tenantApi<SearchPurchaseOrder[]>(tenantId, "/purchase-orders"), []);
    const today = new Date().toISOString().slice(0, 10);
    for (const po of purchaseOrders.filter(po => po.status === "ordered" || po.status === "partially_received").slice(0, 12)) {
      const overdue = !!po.expected_delivery_date && po.expected_delivery_date < today;
      items.push({ id: `po:${po.id}`, severity: overdue ? "critical" : po.status === "partially_received" ? "warning" : "info", type: overdue ? "Overdue purchase order" : po.status === "partially_received" ? "Partial receipt" : "Incoming stock", title: po.number, detail: `${po.supplier_name} · ${po.location_name}${po.expected_delivery_date ? ` · expected ${po.expected_delivery_date}` : ""}`, page: "purchasing" });
    }
  }
  return { total: items.length, items };
}

async function moduleAwareOpsResult<T>(tenantId: string, path: string, raw: unknown, moduleResponse?: ModulesResponse): Promise<T> {
  const url = new URL(path, "https://ops.local");
  if (url.pathname !== "/search" && url.pathname !== "/attention") return raw as T;

  const modules = moduleResponse || await tenantApi<ModulesResponse>(tenantId, "/modules");
  const enabled = moduleSet(modules);
  const pageEnabled = (page: WorkspacePage) => {
    const module = PAGE_MODULE[normalizedPage(page)];
    return !module || enabled.has(module);
  };

  if (url.pathname === "/attention") {
    const data = raw as AttentionResponse;
    const items = data.items.map(item => ({ ...item, page: normalizedPage(item.page) })).filter(item => pageEnabled(item.page));
    return { ...data, total: items.length, items } as T;
  }

  const data = raw as { results: SearchResult[] };
  const results = data.results.map(result => ({ ...result, page: normalizedPage(result.page) })).filter(result => pageEnabled(result.page));
  return { results: results.slice(0, 30) } as T;
}

export async function tenantOpsApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, "https://ops.local");
  const aggregatePath = url.pathname === "/search" || url.pathname === "/attention";
  const modules = aggregatePath ? await tenantApi<ModulesResponse>(tenantId, "/modules") : null;
  const enabled = modules ? moduleSet(modules) : new Set<WorkspaceModuleKey>();

  if (isDemoTenant(tenantId)) {
    if (aggregatePath && url.pathname === "/search") return directSearch(tenantId, (url.searchParams.get("q") || "").trim().toLocaleLowerCase(), enabled) as T;
    if (aggregatePath && url.pathname === "/attention") return directAttention(tenantId, enabled) as T;
    const result = await demoOpsApi<unknown>(path, init);
    return result as T;
  }

  // The legacy operations aggregate assumes commerce modules are readable. For modular workspaces,
  // use direct reads whenever any classic source is disabled so a correct module 404 cannot break search/inbox.
  const allClassicEnabled = enabled.has("crm") && enabled.has("orders") && enabled.has("inventory") && enabled.has("purchasing");
  if (aggregatePath && !allClassicEnabled) {
    if (url.pathname === "/search") return directSearch(tenantId, (url.searchParams.get("q") || "").trim().toLocaleLowerCase(), enabled) as T;
    return directAttention(tenantId, enabled) as T;
  }

  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/ops${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  const data = await response.json<unknown>();
  return moduleAwareOpsResult<T>(tenantId, path, data, modules || undefined);
}

export async function downloadTenantCsv(tenantId: string, kind: string) {
  if (isDemoTenant(tenantId)) {
    const demo = demoCsv(kind);
    const url = URL.createObjectURL(new Blob([demo.content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = demo.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const response = await fetch(`/api/ops/export/${encodeURIComponent(kind)}`, {
    credentials: "include",
    headers: { "x-ordermate-tenant": tenantId },
  });
  if (!response.ok) throw await errorFrom(response);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `operating-layer-${kind}.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function money(minor: number | null | undefined, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format((minor ?? 0) / 100);
}

export function date(value: string | number | null | undefined) {
  if (!value) return "—";
  const parsed = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function calendarDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function todayUtcIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdueDate(value: string | null | undefined) {
  return !!value && value < todayUtcIsoDate();
}
