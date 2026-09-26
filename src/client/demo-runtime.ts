import type {
  CatalogueImportCommitResponse,
  CatalogueImportExisting,
  CatalogueImportPlan,
  CatalogueImportRow,
} from "../shared/catalogue-import";
import type { OperationsReport } from "../shared/operations-report";
import { buildCatalogueImportPlan } from "../worker/catalogue-import-plan";
import type {
  AuditEvent,
  Customer,
  InventoryPolicy,
  InventoryRow,
  Location,
  OrderDetail,
  Product,
  PurchaseOrderDetail,
  Supplier,
  SupplierVariant,
} from "./model";
import {
  demoControlApi as storeControlApi,
  demoCsv as storeCsv,
  demoOpsApi as storeOpsApi,
  demoTenantApi as storeTenantApi,
} from "./demo-store";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";

type DemoMovement = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  movement_type: string;
  quantity: number;
  reference_type?: string | null;
  reference_id?: string | null;
  reason?: string | null;
  actor_id: string;
  actor_role: string;
  created_at: string;
};

type DemoMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "manager" | "inventory" | "fulfilment" | "viewer";
  createdAt: number;
};

type DemoState = {
  version: number;
  settings: {
    id: number;
    business_name?: string;
    currency: string;
    prices_include_tax: number;
    default_tax_rate_bps: number;
    low_stock_threshold: number;
  };
  products: Product[];
  locations: Location[];
  inventory: InventoryRow[];
  suppliers: Supplier[];
  customers: Customer[];
  supplierVariants: SupplierVariant[];
  inventoryPolicies: InventoryPolicy[];
  purchaseOrders: PurchaseOrderDetail[];
  orders: OrderDetail[];
  audit: AuditEvent[];
  movements: DemoMovement[];
  members: DemoMember[];
  pendingInvites: Array<{ id: string; email: string; role: DemoMember["role"]; expiresAt: number; createdAt: number }>;
};

type JsonRecord = Record<string, unknown>;

function parseBody(init?: RequestInit): JsonRecord {
  if (typeof init?.body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    return parsed && typeof parsed === "object" ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function readState(): DemoState {
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!raw) throw new Error("Local demo state is not initialised");
  return JSON.parse(raw) as DemoState;
}

function writeState(state: DemoState) {
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}

function inventoryKey(variantId: string, locationId: string) {
  return `${variantId}\u0000${locationId}`;
}

function variantIndex(state: DemoState) {
  const index = new Map<string, { product: Product; variant: Product["variants"][number] }>();
  for (const product of state.products) {
    for (const variant of product.variants) index.set(variant.id, { product, variant });
  }
  return index;
}

function orderLineAmounts(unitMinor: number, quantity: number, taxRateBps: number, pricesIncludeTax: boolean) {
  if (pricesIncludeTax) {
    const gross = unitMinor * quantity;
    const net = Math.round(gross * 10000 / (10000 + taxRateBps));
    return { net, tax: gross - net, gross };
  }
  const net = unitMinor * quantity;
  const tax = Math.round(net * taxRateBps / 10000);
  return { net, tax, gross: net + tax };
}

function reconcileState(state: DemoState) {
  state.settings.business_name = "Northstar Supply Co. — Demo";

  for (const order of state.orders) {
    let subtotal = 0;
    let tax = 0;
    let total = 0;
    for (const line of order.lines) {
      const modifierDelta = line.modifiers.reduce((sum, modifier) => sum + modifier.unit_price_delta_minor * modifier.quantity, 0);
      const amounts = orderLineAmounts(line.unit_price_minor + modifierDelta, line.quantity, line.tax_rate_bps, state.settings.prices_include_tax === 1);
      subtotal += amounts.net;
      tax += amounts.tax;
      total += amounts.gross;
    }
    order.subtotal_minor = subtotal;
    order.tax_minor = tax;
    order.total_minor = total;
    order.line_count = order.lines.length;
  }

  for (const po of state.purchaseOrders) {
    let subtotal = 0;
    let tax = 0;
    for (const line of po.lines) {
      const lineSubtotal = line.unit_cost_minor * line.quantity_ordered;
      subtotal += lineSubtotal;
      tax += Math.round(lineSubtotal * line.tax_rate_bps / 10000);
    }
    po.subtotal_minor = subtotal;
    po.tax_minor = tax;
    po.total_minor = subtotal + tax;
    po.line_count = po.lines.length;
  }

  const reserved = new Map<string, number>();
  for (const order of state.orders) {
    if (order.status !== "confirmed") continue;
    for (const line of order.lines) {
      const outstanding = Math.max(0, line.quantity - line.quantity_fulfilled);
      const key = inventoryKey(line.variant_id, order.location_id);
      reserved.set(key, (reserved.get(key) || 0) + outstanding);
    }
  }

  const incoming = new Map<string, number>();
  for (const po of state.purchaseOrders) {
    if (!["ordered", "partially_received"].includes(po.status)) continue;
    for (const line of po.lines) {
      const outstanding = Math.max(0, line.quantity_ordered - line.quantity_received);
      const key = inventoryKey(line.variant_id, po.location_id);
      incoming.set(key, (incoming.get(key) || 0) + outstanding);
    }
  }

  const variants = variantIndex(state);
  for (const row of state.inventory) {
    const indexed = variants.get(row.variant_id);
    if (indexed) {
      row.product_name = indexed.product.name;
      row.variant_name = indexed.variant.name;
      row.sku = indexed.variant.sku;
      row.barcode = indexed.variant.barcode;
      row.product_status = indexed.product.status;
      row.variant_active = indexed.variant.active ?? 1;
    }
    const key = inventoryKey(row.variant_id, row.location_id);
    row.reserved = reserved.get(key) || 0;
    row.incoming = incoming.get(key) || 0;
    row.available = row.on_hand - row.reserved;
  }

  for (const mapping of state.supplierVariants) {
    const indexed = variants.get(mapping.variant_id);
    const supplier = state.suppliers.find(item => item.id === mapping.supplier_id);
    if (indexed) {
      mapping.product_name = indexed.product.name;
      mapping.variant_name = indexed.variant.name;
      mapping.sku = indexed.variant.sku;
      mapping.barcode = indexed.variant.barcode;
    }
    if (supplier) mapping.supplier_name = supplier.name;
  }

  for (const policy of state.inventoryPolicies) {
    const indexed = variants.get(policy.variant_id);
    const location = state.locations.find(item => item.id === policy.location_id);
    const supplier = state.suppliers.find(item => item.id === policy.preferred_supplier_id);
    if (indexed) {
      policy.product_name = indexed.product.name;
      policy.variant_name = indexed.variant.name;
      policy.sku = indexed.variant.sku;
    }
    if (location) policy.location_name = location.name;
    policy.preferred_supplier_name = supplier?.name || null;
  }

  // Old demo builds created pseudo invite URLs that could never work outside the
  // browser that created them. The hardened demo adds teammates immediately instead.
  state.pendingInvites = [];
}

export async function repairDemoState() {
  await storeTenantApi<unknown>("/settings");
  const state = readState();
  reconcileState(state);
  writeState(state);
  return state;
}

function catalogueExisting(state: DemoState): CatalogueImportExisting {
  const categories = [...new Set(state.products.map(product => product.category_name).filter((value): value is string => !!value))]
    .map((name, index) => ({ id: `demo-category-${index}`, name }));
  return {
    products: state.products.map(product => ({
      id: product.id,
      name: product.name,
      variants: product.variants.map(variant => ({ id: variant.id, sku: variant.sku, barcode: variant.barcode })),
    })),
    categories,
    suppliers: state.suppliers.map(supplier => ({ id: supplier.id, name: supplier.name })),
    locations: state.locations.map(location => ({ id: location.id, name: location.name, code: location.code })),
    supplierMappings: state.supplierVariants.map(mapping => ({
      supplierId: mapping.supplier_id,
      supplierName: mapping.supplier_name,
      variantId: mapping.variant_id,
      sku: mapping.sku,
      supplierSku: mapping.supplier_sku,
    })),
    defaultTaxRateBps: state.settings.default_tax_rate_bps,
  };
}

async function cataloguePreview(rows: CatalogueImportRow[]) {
  const state = await repairDemoState();
  return buildCatalogueImportPlan(rows, catalogueExisting(state));
}

async function catalogueCommit(rows: CatalogueImportRow[], expectedFingerprint: string): Promise<CatalogueImportCommitResponse> {
  const backup = window.localStorage.getItem(DEMO_DATA_KEY);
  const plan = await cataloguePreview(rows);
  if (!plan.canCommit) throw new Error("The catalogue import has blocking validation errors. Run the dry-run again and review them before committing.");
  if (plan.fingerprint !== expectedFingerprint) throw new Error("The reviewed catalogue import is stale. Run a fresh dry-run before committing.");

  try {
    const suppliers = await storeTenantApi<Supplier[]>("/suppliers");
    const supplierIds = new Map(suppliers.map(supplier => [supplier.name.trim().toLocaleLowerCase(), supplier.id]));

    for (const productPlan of plan.products) {
      for (const variantPlan of productPlan.variants) {
        const supplierPlan = variantPlan.supplier;
        if (!supplierPlan || supplierIds.has(supplierPlan.supplierName.trim().toLocaleLowerCase())) continue;
        const created = await storeTenantApi<Supplier>("/suppliers", {
          method: "POST",
          body: JSON.stringify({ name: supplierPlan.supplierName }),
        });
        supplierIds.set(created.name.trim().toLocaleLowerCase(), created.id);
      }
    }

    for (const productPlan of plan.products) {
      const created = await storeTenantApi<{ id: string }>("/products", {
        method: "POST",
        body: JSON.stringify({
          name: productPlan.name,
          description: productPlan.description || undefined,
          category: productPlan.category?.name || undefined,
          modifierIds: [],
          variants: productPlan.variants.map(variant => ({
            name: variant.name,
            sku: variant.sku,
            barcode: variant.barcode || undefined,
            priceMinor: variant.priceMinor,
            costMinor: variant.costMinor,
            taxRateBps: variant.taxRateBps,
            options: variant.options,
          })),
        }),
      });

      const products = await storeTenantApi<Product[]>("/products");
      const product = products.find(item => item.id === created.id);
      if (!product) throw new Error(`Imported product ${productPlan.name} could not be reloaded from the local demo.`);

      for (const variantPlan of productPlan.variants) {
        const variant = product.variants.find(item => item.sku === variantPlan.sku);
        if (!variant) throw new Error(`Imported SKU ${variantPlan.sku} could not be reloaded from the local demo.`);

        if (variantPlan.openingStock) {
          await storeTenantApi("/inventory/adjust", {
            method: "POST",
            body: JSON.stringify({
              variantId: variant.id,
              locationId: variantPlan.openingStock.locationId,
              quantityDelta: variantPlan.openingStock.quantity,
              reason: "Catalogue import opening stock",
            }),
          });
        }

        if (variantPlan.supplier) {
          const supplierId = supplierIds.get(variantPlan.supplier.supplierName.trim().toLocaleLowerCase());
          if (!supplierId) throw new Error(`Supplier ${variantPlan.supplier.supplierName} could not be created in the local demo.`);
          await storeTenantApi("/supplier-variants", {
            method: "POST",
            body: JSON.stringify({
              supplierId,
              variantId: variant.id,
              supplierSku: variantPlan.supplier.supplierSku || undefined,
              lastCostMinor: variantPlan.supplier.lastCostMinor,
              leadTimeDays: variantPlan.supplier.leadTimeDays,
            }),
          });
        }
      }
    }

    await repairDemoState();
    return { ok: true, importId: `demo-import-${crypto.randomUUID()}`, summary: plan.summary };
  } catch (error) {
    if (backup === null) window.localStorage.removeItem(DEMO_DATA_KEY);
    else window.localStorage.setItem(DEMO_DATA_KEY, backup);
    throw error;
  }
}

function parseImportRows(body: JsonRecord) {
  return Array.isArray(body.rows) ? body.rows as CatalogueImportRow[] : [];
}

function movementType(value: string) {
  if (value === "fulfilment") return "order_fulfilment";
  if (value === "return") return "return_restock";
  return value;
}

function dateKey(offsetDays: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function reportForWindow(state: DemoState, base: OperationsReport, days: number): OperationsReport {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffMs = cutoff.getTime();
  const movements = state.movements.filter(item => new Date(item.created_at).getTime() >= cutoffMs);
  const fulfilled = movements.filter(item => movementType(item.movement_type) === "order_fulfilment");
  const returned = movements.filter(item => movementType(item.movement_type) === "return_restock");
  const received = movements.filter(item => item.movement_type === "purchase_receipt");

  const fulfilledByVariant = new Map<string, number>();
  for (const item of fulfilled) fulfilledByVariant.set(item.variant_id, (fulfilledByVariant.get(item.variant_id) || 0) + Math.abs(item.quantity));
  const variants = variantIndex(state);

  const orderTrend: OperationsReport["orderTrend"] = [];
  const movementTrend: OperationsReport["movementTrend"] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = dateKey(-offset);
    const orders = state.orders.filter(order => order.created_at.slice(0, 10) === day);
    const dayMovements = movements.filter(item => item.created_at.slice(0, 10) === day);
    orderTrend.push({ day, orders: orders.length, grossMinor: orders.reduce((sum, order) => sum + order.total_minor, 0) });
    movementTrend.push({
      day,
      fulfilledUnits: dayMovements.filter(item => movementType(item.movement_type) === "order_fulfilment").reduce((sum, item) => sum + Math.abs(item.quantity), 0),
      receivedUnits: dayMovements.filter(item => item.movement_type === "purchase_receipt").reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
      returnedUnits: dayMovements.filter(item => movementType(item.movement_type) === "return_restock").reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    });
  }

  return {
    ...base,
    windowDays: days,
    orders: {
      ...base.orders,
      fulfilledUnits: fulfilled.reduce((sum, item) => sum + Math.abs(item.quantity), 0),
      returnedUnits: returned.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    },
    purchasing: {
      ...base.purchasing,
      receivedUnits: received.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    },
    topFulfilled: [...fulfilledByVariant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .flatMap(([variantId, fulfilledUnits]) => {
        const indexed = variants.get(variantId);
        return indexed ? [{ variantId, productName: indexed.product.name, variantName: indexed.variant.name, sku: indexed.variant.sku, fulfilledUnits }] : [];
      }),
    orderTrend,
    movementTrend,
  };
}

export async function demoTenantApi<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  const body = parseBody(init);

  if (method === "POST" && url.pathname === "/imports/catalogue/preview") {
    return await cataloguePreview(parseImportRows(body)) as T;
  }
  if (method === "POST" && url.pathname === "/imports/catalogue/commit") {
    return await catalogueCommit(parseImportRows(body), String(body.expectedFingerprint || "")) as T;
  }

  await repairDemoState();
  const result = await storeTenantApi<T>(path, init);
  const state = await repairDemoState();

  if (method === "GET" && url.pathname === "/reports/operations") {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
    return reportForWindow(state, result as OperationsReport, days) as T;
  }
  return result;
}

export async function demoOpsApi<T>(path: string): Promise<T> {
  const state = await repairDemoState();
  const url = new URL(path, "https://demo.local");
  const result = await storeOpsApi<unknown>(path);
  if (url.pathname !== "/movements" || !Array.isArray(result)) return result as T;

  const variants = variantIndex(state);
  const members = new Map(state.members.map(member => [member.userId, member.name]));
  return result.map(raw => {
    const item = raw as DemoMovement;
    return {
      id: item.id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      variant_name: item.variant_name,
      sku: item.sku,
      barcode: variants.get(item.variant_id)?.variant.barcode || null,
      location_id: item.location_id,
      location_name: item.location_name,
      quantity_delta: item.quantity,
      movement_type: movementType(item.movement_type),
      reference_type: item.reference_type || null,
      reference_id: item.reference_id || null,
      reason: item.reason || null,
      actor_id: item.actor_id,
      actor_name: members.get(item.actor_id) || "Guest operator",
      created_at: item.created_at,
    };
  }) as T;
}

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] || "Demo teammate";
  return local.split(/[._-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Demo teammate";
}

export async function demoControlApi<T>(path: string, init?: RequestInit): Promise<T> {
  await repairDemoState();
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  const body = parseBody(init);

  if (method === "POST" && /^\/organizations\/[^/]+\/invites$/.test(url.pathname)) {
    const state = readState();
    const email = String(body.email || "demo-teammate@example.com").trim().toLocaleLowerCase();
    if (state.members.some(member => member.email.toLocaleLowerCase() === email)) throw new Error("That demo teammate already exists.");
    const role = (["admin", "manager", "inventory", "fulfilment", "viewer"].includes(String(body.role)) ? body.role : "viewer") as DemoMember["role"];
    const member: DemoMember = { id: crypto.randomUUID(), userId: crypto.randomUUID(), name: displayNameFromEmail(email), email, role, createdAt: Date.now() };
    state.members.push(member);
    state.pendingInvites = [];
    writeState(state);
    return { id: member.id, inviteUrl: "", expiresAt: Date.now() } as T;
  }

  const result = await storeControlApi<T>(path, init);
  await repairDemoState();
  return result;
}

function csv(rows: string[][]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return rows.map(row => row.map(escape).join(",")).join("\n");
}

export function demoCsv(kind: string) {
  const state = readState();
  reconcileState(state);
  writeState(state);

  if (kind === "purchase-orders") {
    const rows = [["number", "supplier", "location", "status", "expected_delivery", "total_minor", "currency"]];
    for (const po of state.purchaseOrders) rows.push([po.number, po.supplier_name, po.location_name, po.status, po.expected_delivery_date || "", String(po.total_minor), po.currency]);
    return { filename: "operating-layer-demo-purchase-orders.csv", content: csv(rows) };
  }
  if (kind === "delivery-discrepancies") {
    return {
      filename: "operating-layer-demo-delivery-discrepancies.csv",
      content: csv([["purchase_order", "supplier", "status", "issue_count", "created_at", "resolution"]]),
    };
  }
  return storeCsv(kind);
}

export type { CatalogueImportPlan };
