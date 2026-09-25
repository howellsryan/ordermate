import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { can } from "./permissions";
import type { TenantStore } from "./tenant-store-runtime";

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
};

type Membership = { id: string; role: Role };
type Page = "orders" | "products" | "inventory" | "purchasing" | "suppliers" | "customers" | "activity";
type SearchResult = { id: string; type: string; title: string; subtitle: string; page: Page; badge?: string };
type AttentionItem = { id: string; severity: "critical" | "warning" | "info"; type: string; title: string; detail: string; page: Page };

type Product = {
  id: string;
  name: string;
  category_name?: string | null;
  status: string;
  variants: Array<{
    id: string;
    name: string;
    sku: string;
    barcode?: string | null;
    price_minor: number;
    cost_minor: number;
    tax_rate_bps: number;
    options?: Record<string, string>;
  }>;
};

type InventoryRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode?: string | null;
  location_id: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  tracked?: number;
};

type Order = {
  id: string;
  number: string;
  customer_name?: string | null;
  location_name: string;
  status: string;
  fulfilment_status: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: string;
  line_count: number;
  created_at: string;
};

type PurchaseOrder = {
  id: string;
  number: string;
  supplier_name: string;
  location_name: string;
  status: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: string;
  line_count: number;
  created_at: string;
};

type Person = { id: string; name: string; email?: string | null; phone?: string | null };
type AuditEvent = { id: string; actor_id: string; actor_role: string; action: string; entity_type: string; entity_id?: string | null; metadata_json?: string | null; created_at: string };
type Settings = { low_stock_threshold: number };

export const operationsApp = new Hono<{ Bindings: Env }>();

async function tenantContext(request: Request, env: Env) {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;

  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) return { error: Response.json({ error: "Select a business first" }, { status: 400 }) } as const;

  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;

  const stub = env.TENANT_STORES.jurisdiction("eu").getByName(tenantId);
  return { session, tenantId, membership, stub } as const;
}

async function tenantJson<T>(stub: DurableObjectStub<TenantStore>, path: string, actor: { id: string; role: Role; name: string }) {
  const headers = new Headers({
    "x-ordermate-actor-id": actor.id,
    "x-ordermate-actor-role": actor.role,
    "x-ordermate-actor-name": actor.name,
  });
  const response = await stub.fetch(new Request(`https://tenant.internal${path}`, { headers }));
  if (!response.ok) {
    const payload = await response.json<{ error?: string }>().catch(() => ({}));
    throw new Error(payload.error || `Tenant read failed (${response.status})`);
  }
  return response.json<T>();
}

function includes(value: unknown, query: string) {
  if (value === null || value === undefined) return false;
  return String(value).toLocaleLowerCase().includes(query);
}

function pushLimited(results: SearchResult[], values: SearchResult[], limit = 8) {
  results.push(...values.slice(0, limit));
}

operationsApp.get("/search", async c => {
  const context = await tenantContext(c.req.raw, c.env);
  if ("error" in context) return context.error;
  const query = (c.req.query("q") || "").trim().toLocaleLowerCase();
  if (query.length < 2) return c.json({ results: [] });

  const actor = { id: context.session.user.id, role: context.membership.role, name: context.session.user.name };
  const results: SearchResult[] = [];

  const [products, orders, purchaseOrders, customers, suppliers] = await Promise.all([
    can(context.membership.role, "catalogue", "read") ? tenantJson<Product[]>(context.stub, "/products", actor) : Promise.resolve([]),
    can(context.membership.role, "orders", "read") ? tenantJson<Order[]>(context.stub, "/orders", actor) : Promise.resolve([]),
    can(context.membership.role, "purchasing", "read") ? tenantJson<PurchaseOrder[]>(context.stub, "/purchase-orders", actor) : Promise.resolve([]),
    can(context.membership.role, "customers", "read") ? tenantJson<Person[]>(context.stub, "/customers", actor) : Promise.resolve([]),
    can(context.membership.role, "purchasing", "read") ? tenantJson<Person[]>(context.stub, "/suppliers", actor) : Promise.resolve([]),
  ]);

  const productMatches: SearchResult[] = [];
  for (const product of products) {
    const productMatch = [product.name, product.category_name].some(value => includes(value, query));
    if (productMatch) productMatches.push({ id: product.id, type: "Product", title: product.name, subtitle: product.category_name || `${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}`, page: "products" });
    for (const variant of product.variants) {
      const optionText = Object.values(variant.options || {}).join(" ");
      if ([product.name, variant.name, variant.sku, variant.barcode, optionText].some(value => includes(value, query))) {
        productMatches.push({ id: variant.id, type: "Variant", title: `${product.name} · ${variant.name}`, subtitle: [variant.sku, variant.barcode].filter(Boolean).join(" · "), page: "products", badge: variant.sku });
      }
    }
  }
  pushLimited(results, productMatches);

  pushLimited(results, orders.filter(order => [order.number, order.customer_name, order.location_name, order.status, order.fulfilment_status].some(value => includes(value, query))).map(order => ({
    id: order.id, type: "Order", title: order.number, subtitle: `${order.customer_name || "Guest"} · ${order.fulfilment_status.replaceAll("_", " ")}`, page: "orders", badge: order.status,
  })));

  pushLimited(results, purchaseOrders.filter(po => [po.number, po.supplier_name, po.location_name, po.status].some(value => includes(value, query))).map(po => ({
    id: po.id, type: "Purchase order", title: po.number, subtitle: `${po.supplier_name} · ${po.location_name}`, page: "purchasing", badge: po.status,
  })));

  pushLimited(results, customers.filter(person => [person.name, person.email, person.phone].some(value => includes(value, query))).map(person => ({
    id: person.id, type: "Customer", title: person.name, subtitle: person.email || person.phone || "Saved customer", page: "customers",
  })));

  pushLimited(results, suppliers.filter(person => [person.name, person.email, person.phone].some(value => includes(value, query))).map(person => ({
    id: person.id, type: "Supplier", title: person.name, subtitle: person.email || person.phone || "Saved supplier", page: "suppliers",
  })));

  return c.json({ results: results.slice(0, 30) });
});

operationsApp.get("/attention", async c => {
  const context = await tenantContext(c.req.raw, c.env);
  if ("error" in context) return context.error;
  const actor = { id: context.session.user.id, role: context.membership.role, name: context.session.user.name };
  const items: AttentionItem[] = [];

  if (can(context.membership.role, "inventory", "read")) {
    const [inventory, settings] = await Promise.all([
      tenantJson<InventoryRow[]>(context.stub, "/inventory", actor),
      tenantJson<Settings>(context.stub, "/settings", actor),
    ]);
    for (const row of inventory.filter(row => row.tracked !== 0 && row.available <= settings.low_stock_threshold).slice(0, 12)) {
      items.push({
        id: `stock:${row.variant_id}:${row.location_id}`,
        severity: row.available <= 0 ? "critical" : "warning",
        type: row.available <= 0 ? "Stockout" : "Low stock",
        title: `${row.product_name} · ${row.variant_name}`,
        detail: `${row.available} available at ${row.location_name}${row.incoming ? ` · ${row.incoming} incoming` : ""}`,
        page: "inventory",
      });
    }
  }

  if (can(context.membership.role, "orders", "read")) {
    const orders = await tenantJson<Order[]>(context.stub, "/orders", actor);
    for (const order of orders.filter(order => order.status === "confirmed").slice(0, 8)) {
      items.push({
        id: `order:${order.id}`,
        severity: "warning",
        type: "Awaiting fulfilment",
        title: order.number,
        detail: `${order.customer_name || "Guest"} · ${order.location_name} · ${order.line_count} line${order.line_count === 1 ? "" : "s"}`,
        page: "orders",
      });
    }
  }

  if (can(context.membership.role, "purchasing", "read")) {
    const purchaseOrders = await tenantJson<PurchaseOrder[]>(context.stub, "/purchase-orders", actor);
    for (const po of purchaseOrders.filter(po => po.status === "partially_received" || po.status === "ordered").slice(0, 8)) {
      items.push({
        id: `po:${po.id}`,
        severity: po.status === "partially_received" ? "warning" : "info",
        type: po.status === "partially_received" ? "Partial receipt" : "Incoming stock",
        title: po.number,
        detail: `${po.supplier_name} · ${po.location_name} · ${po.line_count} line${po.line_count === 1 ? "" : "s"}`,
        page: "purchasing",
      });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
  return c.json({ total: items.length, items: items.slice(0, 20) });
});

const exportDefinitions = {
  products: { resource: "catalogue", path: "/products" },
  inventory: { resource: "inventory", path: "/inventory" },
  orders: { resource: "orders", path: "/orders" },
  "purchase-orders": { resource: "purchasing", path: "/purchase-orders" },
  customers: { resource: "customers", path: "/customers" },
  suppliers: { resource: "purchasing", path: "/suppliers" },
  audit: { resource: "reports", path: "/audit" },
} as const;

type ExportKind = keyof typeof exportDefinitions;

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(headers: string[], rows: unknown[][]) {
  return [headers.map(csvCell).join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\r\n");
}

function exportRows(kind: ExportKind, data: unknown): { headers: string[]; rows: unknown[][] } {
  if (kind === "products") {
    const rows = (data as Product[]).flatMap(product => product.variants.map(variant => [product.name, product.category_name, product.status, variant.name, variant.sku, variant.barcode, variant.options || {}, variant.price_minor, variant.cost_minor, variant.tax_rate_bps]));
    return { headers: ["product", "category", "status", "variant", "sku", "barcode", "options", "price_minor", "cost_minor", "tax_rate_bps"], rows };
  }
  if (kind === "inventory") {
    const rows = (data as InventoryRow[]).map(row => [row.product_name, row.variant_name, row.sku, row.barcode, row.location_name, row.on_hand, row.reserved, row.available, row.incoming, row.tracked ?? 1]);
    return { headers: ["product", "variant", "sku", "barcode", "location", "on_hand", "reserved", "available", "incoming", "tracked"], rows };
  }
  if (kind === "orders") {
    const rows = (data as Order[]).map(row => [row.number, row.customer_name, row.location_name, row.status, row.fulfilment_status, row.line_count, row.subtotal_minor, row.tax_minor, row.total_minor, row.currency, row.created_at]);
    return { headers: ["order_number", "customer", "location", "status", "fulfilment_status", "line_count", "subtotal_minor", "tax_minor", "total_minor", "currency", "created_at"], rows };
  }
  if (kind === "purchase-orders") {
    const rows = (data as PurchaseOrder[]).map(row => [row.number, row.supplier_name, row.location_name, row.status, row.line_count, row.subtotal_minor, row.tax_minor, row.total_minor, row.currency, row.created_at]);
    return { headers: ["purchase_order_number", "supplier", "location", "status", "line_count", "subtotal_minor", "tax_minor", "total_minor", "currency", "created_at"], rows };
  }
  if (kind === "audit") {
    const rows = (data as AuditEvent[]).map(row => [row.created_at, row.actor_id, row.actor_role, row.action, row.entity_type, row.entity_id, row.metadata_json]);
    return { headers: ["created_at", "actor_id", "actor_role", "action", "entity_type", "entity_id", "metadata_json"], rows };
  }
  const rows = (data as Person[]).map(row => [row.name, row.email, row.phone]);
  return { headers: ["name", "email", "phone"], rows };
}

operationsApp.get("/export/:kind", async c => {
  const context = await tenantContext(c.req.raw, c.env);
  if ("error" in context) return context.error;
  const kind = c.req.param("kind") as ExportKind;
  const definition = exportDefinitions[kind];
  if (!definition) return c.json({ error: "Unknown export" }, 404);
  if (!can(context.membership.role, definition.resource, "read")) return c.json({ error: "Insufficient permission" }, 403);

  const actor = { id: context.session.user.id, role: context.membership.role, name: context.session.user.name };
  const data = await tenantJson<unknown>(context.stub, definition.path, actor);
  const exported = exportRows(kind, data);
  const filename = `ordermate-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv(exported.headers, exported.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
