import type { SessionPayload } from "../shared/types";
import type {
  AuditEvent,
  Customer,
  InventoryPolicy,
  InventoryRow,
  Location,
  OrderDetail,
  Product,
  ProductModifier,
  PurchaseOrderDetail,
  Supplier,
  SupplierVariant,
} from "./model";

export const DEMO_TENANT_ID = "demo-local-workspace";
export const DEMO_MODE_KEY = "operating-layer:demo-mode";
const DEMO_DATA_KEY = "operating-layer:demo-data:v1";
const DEMO_VERSION = 1;

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

type DemoSavedView = {
  id: string;
  page: "inventory" | "purchasing";
  name: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type DemoMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "manager" | "inventory" | "fulfilment" | "viewer";
  createdAt: number;
};

type DemoInvite = {
  id: string;
  email: string;
  role: Exclude<DemoMember["role"], "owner">;
  expiresAt: number;
  createdAt: number;
};

type DemoState = {
  version: number;
  settings: {
    id: number;
    currency: string;
    prices_include_tax: number;
    default_tax_rate_bps: number;
    low_stock_threshold: number;
  };
  products: Product[];
  modifiers: ProductModifier[];
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
  savedViews: DemoSavedView[];
  members: DemoMember[];
  pendingInvites: DemoInvite[];
};

type JsonRecord = Record<string, unknown>;

export function isDemoTenant(tenantId: string | null | undefined) {
  return tenantId === DEMO_TENANT_ID;
}

export function isDemoMode() {
  return typeof window !== "undefined" && window.localStorage.getItem(DEMO_MODE_KEY) === "1";
}

export function enterDemoMode() {
  window.localStorage.setItem(DEMO_MODE_KEY, "1");
  ensureState();
}

export function exitDemoMode() {
  window.localStorage.removeItem(DEMO_MODE_KEY);
}

export function resetDemoData() {
  window.localStorage.removeItem(DEMO_DATA_KEY);
  ensureState();
}

export function demoSession(): SessionPayload {
  return {
    user: { id: "demo-user", name: "Guest operator", email: "guest@demo.local" },
    organizations: [{ id: DEMO_TENANT_ID, name: "Northstar Supply Co. — Demo", slug: "northstar-demo", role: "owner" }],
  };
}

function isoDay(offset: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function isoStamp(offsetDays: number, hour = 9) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function seedState(): DemoState {
  const modifiers: ProductModifier[] = [
    { id: "mod-rush", name: "Priority handling", price_delta_minor: 250 },
    { id: "mod-label", name: "Custom carton label", price_delta_minor: 75 },
  ];

  const products: Product[] = [
    {
      id: "prod-mailer",
      name: "Recycled Mailer Box",
      description: "Kraft ecommerce mailer cartons.",
      category_name: "Packaging",
      status: "active",
      modifiers: [modifiers[1]],
      variants: [
        { id: "var-mailer-s", product_id: "prod-mailer", name: "Small", sku: "BOX-MAIL-S", barcode: "5056400100011", price_minor: 145, cost_minor: 72, tax_rate_bps: 2000, active: 1, options: { Size: "Small" } },
        { id: "var-mailer-m", product_id: "prod-mailer", name: "Medium", sku: "BOX-MAIL-M", barcode: "5056400100028", price_minor: 210, cost_minor: 106, tax_rate_bps: 2000, active: 1, options: { Size: "Medium" } },
      ],
    },
    {
      id: "prod-tape",
      name: "Paper Packing Tape",
      description: "Reinforced recyclable paper tape, 50 m roll.",
      category_name: "Packaging",
      status: "active",
      modifiers: [],
      variants: [
        { id: "var-tape", product_id: "prod-tape", name: "50 mm × 50 m", sku: "TAPE-PAPER-50", barcode: "5056400100035", price_minor: 495, cost_minor: 238, tax_rate_bps: 2000, active: 1, options: {} },
      ],
    },
    {
      id: "prod-gloves",
      name: "Warehouse Grip Gloves",
      description: "Reusable nitrile-coated handling gloves.",
      category_name: "Warehouse",
      status: "active",
      modifiers: [modifiers[0]],
      variants: [
        { id: "var-gloves-m", product_id: "prod-gloves", name: "Medium", sku: "PPE-GLOVE-M", barcode: "5056400100042", price_minor: 695, cost_minor: 315, tax_rate_bps: 2000, active: 1, options: { Size: "M" } },
        { id: "var-gloves-l", product_id: "prod-gloves", name: "Large", sku: "PPE-GLOVE-L", barcode: "5056400100059", price_minor: 695, cost_minor: 315, tax_rate_bps: 2000, active: 1, options: { Size: "L" } },
      ],
    },
    {
      id: "prod-labels",
      name: "Thermal Shipping Labels",
      description: "100 × 150 mm fanfold direct thermal labels.",
      category_name: "Dispatch",
      status: "active",
      modifiers: [],
      variants: [
        { id: "var-labels", product_id: "prod-labels", name: "500 labels", sku: "LAB-100X150-500", barcode: "5056400100066", price_minor: 1895, cost_minor: 910, tax_rate_bps: 2000, active: 1, options: {} },
      ],
    },
  ];

  const locations: Location[] = [
    { id: "loc-nottingham", name: "Nottingham Warehouse", code: "NOT" },
    { id: "loc-birmingham", name: "Birmingham Overflow", code: "BHM" },
  ];

  const inventory: InventoryRow[] = [
    inventorySeed(products, locations, "var-mailer-s", "loc-nottingham", 168, 34, 120),
    inventorySeed(products, locations, "var-mailer-m", "loc-nottingham", 52, 16, 80),
    inventorySeed(products, locations, "var-tape", "loc-nottingham", 19, 8, 72),
    inventorySeed(products, locations, "var-gloves-m", "loc-nottingham", 44, 4, 0),
    inventorySeed(products, locations, "var-gloves-l", "loc-nottingham", 9, 3, 48),
    inventorySeed(products, locations, "var-labels", "loc-nottingham", 7, 2, 30),
    inventorySeed(products, locations, "var-mailer-s", "loc-birmingham", 60, 0, 0),
    inventorySeed(products, locations, "var-mailer-m", "loc-birmingham", 34, 0, 0),
    inventorySeed(products, locations, "var-tape", "loc-birmingham", 21, 0, 0),
    inventorySeed(products, locations, "var-gloves-m", "loc-birmingham", 16, 0, 0),
    inventorySeed(products, locations, "var-gloves-l", "loc-birmingham", 14, 0, 0),
    inventorySeed(products, locations, "var-labels", "loc-birmingham", 12, 0, 0),
  ];

  const suppliers: Supplier[] = [
    { id: "sup-pack", name: "Midlands Packaging Ltd", email: "orders@midlandspackaging.example", phone: "0115 555 0134", notes: "Primary packaging supplier." },
    { id: "sup-work", name: "Apex Workwear", email: "trade@apexworkwear.example", phone: "0121 555 0188", notes: "PPE and warehouse consumables." },
  ];

  const customers: Customer[] = [
    { id: "cus-field", name: "Field & Form", email: "ops@fieldandform.example", phone: "020 7946 0121", notes: "Weekly replenishment customer." },
    { id: "cus-trent", name: "Trent Retail Group", email: "warehouse@trentretail.example", phone: "0115 555 0192", notes: "Priority customer." },
    { id: "cus-wren", name: "Wren Commerce", email: "buying@wrencommerce.example", phone: "0161 555 0140" },
  ];

  const supplierVariants: SupplierVariant[] = [
    supplierVariant(products, suppliers, "sup-pack", "var-mailer-s", "MP-MAIL-S", 69, 4),
    supplierVariant(products, suppliers, "sup-pack", "var-mailer-m", "MP-MAIL-M", 102, 4),
    supplierVariant(products, suppliers, "sup-pack", "var-tape", "MP-TAPE-50", 231, 3),
    supplierVariant(products, suppliers, "sup-pack", "var-labels", "MP-LAB-500", 895, 5),
    supplierVariant(products, suppliers, "sup-work", "var-gloves-m", "AW-GRIP-M", 309, 6),
    supplierVariant(products, suppliers, "sup-work", "var-gloves-l", "AW-GRIP-L", 309, 6),
  ];

  const purchaseOrders: PurchaseOrderDetail[] = [
    {
      id: "po-1",
      number: "PO-2026-000142",
      supplier_id: "sup-pack",
      supplier_name: "Midlands Packaging Ltd",
      location_id: "loc-nottingham",
      location_name: "Nottingham Warehouse",
      status: "ordered",
      subtotal_minor: 18720,
      tax_minor: 3744,
      total_minor: 22464,
      currency: "GBP",
      line_count: 2,
      expected_delivery_date: isoDay(2),
      ordered_at: isoStamp(-2, 11),
      created_at: isoStamp(-3, 15),
      lines: [
        { id: "pol-1a", variant_id: "var-mailer-s", sku_snapshot: "BOX-MAIL-S", description_snapshot: "Recycled Mailer Box · Small", quantity_ordered: 120, quantity_received: 0, unit_cost_minor: 69, tax_rate_bps: 2000 },
        { id: "pol-1b", variant_id: "var-tape", sku_snapshot: "TAPE-PAPER-50", description_snapshot: "Paper Packing Tape · 50 mm × 50 m", quantity_ordered: 45, quantity_received: 0, unit_cost_minor: 232, tax_rate_bps: 2000 },
      ],
    },
    {
      id: "po-2",
      number: "PO-2026-000141",
      supplier_id: "sup-work",
      supplier_name: "Apex Workwear",
      location_id: "loc-nottingham",
      location_name: "Nottingham Warehouse",
      status: "partially_received",
      subtotal_minor: 22248,
      tax_minor: 4450,
      total_minor: 26698,
      currency: "GBP",
      line_count: 2,
      expected_delivery_date: isoDay(-1),
      ordered_at: isoStamp(-8, 10),
      created_at: isoStamp(-9, 14),
      lines: [
        { id: "pol-2a", variant_id: "var-gloves-l", sku_snapshot: "PPE-GLOVE-L", description_snapshot: "Warehouse Grip Gloves · Large", quantity_ordered: 72, quantity_received: 24, unit_cost_minor: 309, tax_rate_bps: 2000 },
        { id: "pol-2b", variant_id: "var-gloves-m", sku_snapshot: "PPE-GLOVE-M", description_snapshot: "Warehouse Grip Gloves · Medium", quantity_ordered: 24, quantity_received: 24, unit_cost_minor: 309, tax_rate_bps: 2000 },
      ],
    },
  ];

  const orders: OrderDetail[] = [
    {
      id: "ord-1",
      number: "ORD-2026-001842",
      customer_id: "cus-trent",
      customer_name: "Trent Retail Group",
      location_id: "loc-nottingham",
      location_name: "Nottingham Warehouse",
      status: "confirmed",
      fulfilment_status: "unfulfilled",
      priority: "urgent",
      required_by_date: isoDay(0),
      subtotal_minor: 13600,
      tax_minor: 2720,
      total_minor: 16320,
      currency: "GBP",
      line_count: 2,
      created_at: isoStamp(-1, 13),
      lines: [
        { id: "ol-1a", variant_id: "var-mailer-s", product_name_snapshot: "Recycled Mailer Box", variant_name_snapshot: "Small", sku_snapshot: "BOX-MAIL-S", quantity: 30, quantity_fulfilled: 0, quantity_returned: 0, unit_price_minor: 145, tax_rate_bps: 2000, modifiers: [] },
        { id: "ol-1b", variant_id: "var-tape", product_name_snapshot: "Paper Packing Tape", variant_name_snapshot: "50 mm × 50 m", sku_snapshot: "TAPE-PAPER-50", quantity: 8, quantity_fulfilled: 0, quantity_returned: 0, unit_price_minor: 495, tax_rate_bps: 2000, modifiers: [] },
      ],
    },
    {
      id: "ord-2",
      number: "ORD-2026-001843",
      customer_id: "cus-field",
      customer_name: "Field & Form",
      location_id: "loc-nottingham",
      location_name: "Nottingham Warehouse",
      status: "confirmed",
      fulfilment_status: "partially_fulfilled",
      priority: "high",
      required_by_date: isoDay(1),
      subtotal_minor: 15160,
      tax_minor: 3032,
      total_minor: 18192,
      currency: "GBP",
      line_count: 2,
      created_at: isoStamp(-2, 16),
      lines: [
        { id: "ol-2a", variant_id: "var-mailer-m", product_name_snapshot: "Recycled Mailer Box", variant_name_snapshot: "Medium", sku_snapshot: "BOX-MAIL-M", quantity: 12, quantity_fulfilled: 6, quantity_returned: 0, unit_price_minor: 210, tax_rate_bps: 2000, modifiers: [] },
        { id: "ol-2b", variant_id: "var-labels", product_name_snapshot: "Thermal Shipping Labels", variant_name_snapshot: "500 labels", sku_snapshot: "LAB-100X150-500", quantity: 6, quantity_fulfilled: 2, quantity_returned: 0, unit_price_minor: 1895, tax_rate_bps: 2000, modifiers: [] },
      ],
    },
    {
      id: "ord-3",
      number: "ORD-2026-001844",
      customer_id: "cus-wren",
      customer_name: "Wren Commerce",
      location_id: "loc-birmingham",
      location_name: "Birmingham Overflow",
      status: "draft",
      fulfilment_status: "unfulfilled",
      priority: "normal",
      required_by_date: isoDay(5),
      subtotal_minor: 4170,
      tax_minor: 834,
      total_minor: 5004,
      currency: "GBP",
      line_count: 1,
      created_at: isoStamp(0, 8),
      lines: [
        { id: "ol-3a", variant_id: "var-mailer-m", product_name_snapshot: "Recycled Mailer Box", variant_name_snapshot: "Medium", sku_snapshot: "BOX-MAIL-M", quantity: 15, quantity_fulfilled: 0, quantity_returned: 0, unit_price_minor: 210, tax_rate_bps: 2000, modifiers: [{ id: "olm-3a", name_snapshot: "Custom carton label", quantity: 1, unit_price_delta_minor: 75 }] },
      ],
    },
  ];

  const audit: AuditEvent[] = [
    auditSeed("order.confirmed", "order", "ord-1", -1, { number: "ORD-2026-001842" }),
    auditSeed("purchase_order.submitted", "purchase_order", "po-1", -2, { number: "PO-2026-000142" }),
    auditSeed("inventory.adjusted", "inventory", "var-labels", -3, { quantityDelta: -2, reason: "Damaged outer carton" }),
    auditSeed("order.fulfilled", "order", "ord-2", -4, { lines: 2 }),
  ];

  const movements: DemoMovement[] = [
    movementSeed(products, locations, "var-mailer-m", "loc-nottingham", "fulfilment", -6, -2, "order", "ord-2"),
    movementSeed(products, locations, "var-labels", "loc-nottingham", "fulfilment", -2, -2, "order", "ord-2"),
    movementSeed(products, locations, "var-gloves-m", "loc-nottingham", "purchase_receipt", 24, -5, "purchase_order", "po-2"),
    movementSeed(products, locations, "var-gloves-l", "loc-nottingham", "purchase_receipt", 24, -5, "purchase_order", "po-2"),
    movementSeed(products, locations, "var-labels", "loc-nottingham", "adjustment", -2, -3, "inventory", "var-labels", "Damaged outer carton"),
  ];

  return {
    version: DEMO_VERSION,
    settings: { id: 1, currency: "GBP", prices_include_tax: 0, default_tax_rate_bps: 2000, low_stock_threshold: 10 },
    products,
    modifiers,
    locations,
    inventory,
    suppliers,
    customers,
    supplierVariants,
    inventoryPolicies: [
      policySeed(products, locations, suppliers, "var-labels", "loc-nottingham", 12, 40, "sup-pack"),
      policySeed(products, locations, suppliers, "var-gloves-l", "loc-nottingham", 10, 36, "sup-work"),
    ],
    purchaseOrders,
    orders,
    audit,
    movements,
    savedViews: [],
    members: [
      { id: "member-demo-owner", userId: "demo-user", name: "Guest operator", email: "guest@demo.local", role: "owner", createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000 },
      { id: "member-demo-manager", userId: "demo-manager", name: "Alex Morgan", email: "alex@northstar.example", role: "manager", createdAt: Date.now() - 12 * 24 * 60 * 60 * 1000 },
      { id: "member-demo-warehouse", userId: "demo-warehouse", name: "Sam Patel", email: "sam@northstar.example", role: "fulfilment", createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000 },
    ],
    pendingInvites: [],
  };
}

function inventorySeed(products: Product[], locations: Location[], variantId: string, locationId: string, onHand: number, reserved: number, incoming: number): InventoryRow {
  const { product, variant } = variantFor(products, variantId);
  const location = locations.find(item => item.id === locationId)!;
  return {
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    product_status: product.status,
    variant_active: variant.active ?? 1,
    location_id: location.id,
    location_name: location.name,
    on_hand: onHand,
    reserved,
    available: onHand - reserved,
    incoming,
    tracked: 1,
  };
}

function supplierVariant(products: Product[], suppliers: Supplier[], supplierId: string, variantId: string, supplierSku: string, cost: number, leadTime: number): SupplierVariant {
  const supplier = suppliers.find(item => item.id === supplierId)!;
  const { product, variant } = variantFor(products, variantId);
  return {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    supplier_sku: supplierSku,
    last_cost_minor: cost,
    lead_time_days: leadTime,
  };
}

function policySeed(products: Product[], locations: Location[], suppliers: Supplier[], variantId: string, locationId: string, reorder: number, target: number, supplierId: string): InventoryPolicy {
  const { product, variant } = variantFor(products, variantId);
  const location = locations.find(item => item.id === locationId)!;
  const supplier = suppliers.find(item => item.id === supplierId)!;
  return {
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    location_id: location.id,
    location_name: location.name,
    reorder_point: reorder,
    target_stock: target,
    preferred_supplier_id: supplier.id,
    preferred_supplier_name: supplier.name,
    updated_at: isoStamp(-2),
    updated_by: "demo-user",
  };
}

function auditSeed(action: string, entityType: string, entityId: string, offsetDays: number, metadata?: unknown): AuditEvent {
  return {
    id: crypto.randomUUID(),
    actor_id: "demo-user",
    actor_role: "owner",
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata_json: metadata === undefined ? null : JSON.stringify(metadata),
    created_at: isoStamp(offsetDays),
  };
}

function movementSeed(products: Product[], locations: Location[], variantId: string, locationId: string, type: string, quantity: number, offsetDays: number, referenceType?: string, referenceId?: string, reason?: string): DemoMovement {
  const { product, variant } = variantFor(products, variantId);
  const location = locations.find(item => item.id === locationId)!;
  return {
    id: crypto.randomUUID(),
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    location_id: location.id,
    location_name: location.name,
    movement_type: type,
    quantity,
    reference_type: referenceType || null,
    reference_id: referenceId || null,
    reason: reason || null,
    actor_id: "demo-user",
    actor_role: "owner",
    created_at: isoStamp(offsetDays),
  };
}

function ensureState(): DemoState {
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.version === DEMO_VERSION) return parsed;
    } catch {
      // Replace malformed demo data with a fresh deterministic seed.
    }
  }
  const state = seedState();
  persist(state);
  return state;
}

function persist(state: DemoState) {
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}

function parseBody(init?: RequestInit): JsonRecord {
  if (typeof init?.body !== "string") return {};
  try {
    const value: unknown = JSON.parse(init.body);
    return value && typeof value === "object" ? value as JsonRecord : {};
  } catch {
    return {};
  }
}

function variantFor(products: Product[], variantId: string) {
  for (const product of products) {
    const variant = product.variants.find(item => item.id === variantId);
    if (variant) return { product, variant };
  }
  throw new Error("Product variant not found");
}

function inventoryRow(state: DemoState, variantId: string, locationId: string) {
  let row = state.inventory.find(item => item.variant_id === variantId && item.location_id === locationId);
  if (row) return row;
  const { product, variant } = variantFor(state.products, variantId);
  const location = state.locations.find(item => item.id === locationId);
  if (!location) throw new Error("Stock location not found");
  row = {
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    product_status: product.status,
    variant_active: variant.active ?? 1,
    location_id: location.id,
    location_name: location.name,
    on_hand: 0,
    reserved: 0,
    available: 0,
    incoming: 0,
    tracked: 0,
  };
  state.inventory.push(row);
  return row;
}

function refreshAvailable(row: InventoryRow) {
  row.available = row.on_hand - row.reserved;
  row.tracked = 1;
}

function addAudit(state: DemoState, action: string, entityType: string, entityId?: string, metadata?: unknown) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    actor_id: "demo-user",
    actor_role: "owner",
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata_json: metadata === undefined ? null : JSON.stringify(metadata),
    created_at: new Date().toISOString(),
  });
  state.audit = state.audit.slice(0, 100);
}

function addMovement(state: DemoState, variantId: string, locationId: string, type: string, quantity: number, referenceType?: string, referenceId?: string, reason?: string) {
  const { product, variant } = variantFor(state.products, variantId);
  const location = state.locations.find(item => item.id === locationId);
  if (!location) return;
  state.movements.unshift({
    id: crypto.randomUUID(),
    variant_id: variant.id,
    product_name: product.name,
    variant_name: variant.name,
    sku: variant.sku,
    location_id: location.id,
    location_name: location.name,
    movement_type: type,
    quantity,
    reference_type: referenceType || null,
    reference_id: referenceId || null,
    reason: reason || null,
    actor_id: "demo-user",
    actor_role: "owner",
    created_at: new Date().toISOString(),
  });
  state.movements = state.movements.slice(0, 250);
}

function nextNumber(items: Array<{ number: string }>, prefix: string) {
  const year = new Date().getUTCFullYear();
  const max = items.reduce((current, item) => {
    const match = item.number.match(/(\d+)$/);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(6, "0")}`;
}

function lineAmounts(unitMinor: number, quantity: number, taxRateBps: number, inclusive: boolean) {
  if (inclusive) {
    const gross = unitMinor * quantity;
    const net = Math.round(gross * 10000 / (10000 + taxRateBps));
    return { net, tax: gross - net, gross };
  }
  const net = unitMinor * quantity;
  const tax = Math.round(net * taxRateBps / 10000);
  return { net, tax, gross: net + tax };
}

function dashboard(state: DemoState) {
  const tracked = state.inventory.filter(row => row.tracked !== 0);
  return {
    ordersOpen: state.orders.filter(order => ["draft", "confirmed"].includes(order.status)).length,
    ordersAwaitingFulfilment: state.orders.filter(order => order.status === "confirmed" && order.fulfilment_status !== "fulfilled").length,
    purchaseOrdersOpen: state.purchaseOrders.filter(po => ["draft", "ordered", "partially_received"].includes(po.status)).length,
    lowStockVariants: tracked.filter(row => row.available <= state.settings.low_stock_threshold).length,
    inventoryValueMinor: tracked.reduce((sum, row) => {
      const { variant } = variantFor(state.products, row.variant_id);
      return sum + row.on_hand * variant.cost_minor;
    }, 0),
    currency: state.settings.currency,
  };
}

function replenishment(state: DemoState) {
  const suggestions = state.inventory
    .filter(row => row.tracked !== 0)
    .map(row => {
      const policy = state.inventoryPolicies.find(item => item.variant_id === row.variant_id && item.location_id === row.location_id);
      const threshold = policy?.reorder_point ?? state.settings.low_stock_threshold;
      const target = policy?.target_stock ?? Math.max(threshold * 2, threshold + 5);
      const mappings = state.supplierVariants.filter(item => item.variant_id === row.variant_id);
      const lead = Math.max(1, Math.min(...(mappings.length ? mappings.map(item => item.lead_time_days ?? 7) : [7])));
      const dailyDemand = Math.max(0.2, state.orders.reduce((sum, order) => sum + order.lines.filter(line => line.variant_id === row.variant_id).reduce((lineSum, line) => lineSum + line.quantity_fulfilled, 0), 0) / 30);
      const projected = row.available + row.incoming - Math.ceil(dailyDemand * lead);
      const recommended = Math.max(0, Math.ceil(target - projected));
      if (projected > threshold || recommended <= 0) return null;
      return {
        id: `${row.variant_id}:${row.location_id}`,
        variant_id: row.variant_id,
        product_name: row.product_name,
        variant_name: row.variant_name,
        sku: row.sku,
        location_id: row.location_id,
        location_name: row.location_name,
        on_hand: row.on_hand,
        reserved: row.reserved,
        available: row.available,
        incoming: row.incoming,
        fulfilled_30d: Math.round(dailyDemand * 30),
        threshold,
        target_stock: target,
        policy_custom: !!policy,
        preferred_supplier_id: policy?.preferred_supplier_id || null,
        average_daily_demand: Number(dailyDemand.toFixed(2)),
        effective_lead_time_days: lead,
        projected_at_lead_time: projected,
        recommended_quantity: recommended,
        suppliers: mappings.map(mapping => ({
          supplierId: mapping.supplier_id,
          supplierName: mapping.supplier_name,
          supplierSku: mapping.supplier_sku,
          lastCostMinor: mapping.last_cost_minor,
          leadTimeDays: mapping.lead_time_days,
          preferred: mapping.supplier_id === policy?.preferred_supplier_id,
        })),
      };
    })
    .filter(Boolean);
  return { generated_at: new Date().toISOString(), window_days: 30, default_threshold: state.settings.low_stock_threshold, suggestions };
}

function operationsReport(state: DemoState, windowDays: number) {
  const tracked = state.inventory.filter(row => row.tracked !== 0);
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const recentOrders = state.orders.filter(order => new Date(order.created_at).getTime() >= cutoff);
  const openPos = state.purchaseOrders.filter(po => ["draft", "ordered", "partially_received"].includes(po.status));
  const orderTrend: Array<{ day: string; orders: number; grossMinor: number }> = [];
  const movementTrend: Array<{ day: string; fulfilledUnits: number; receivedUnits: number; returnedUnits: number }> = [];
  for (let offset = Math.min(windowDays - 1, 13); offset >= 0; offset--) {
    const day = isoDay(-offset);
    const dayOrders = recentOrders.filter(order => order.created_at.slice(0, 10) === day);
    const dayMovements = state.movements.filter(item => item.created_at.slice(0, 10) === day);
    orderTrend.push({ day, orders: dayOrders.length, grossMinor: dayOrders.reduce((sum, order) => sum + order.total_minor, 0) });
    movementTrend.push({
      day,
      fulfilledUnits: Math.abs(dayMovements.filter(item => item.movement_type === "fulfilment").reduce((sum, item) => sum + item.quantity, 0)),
      receivedUnits: dayMovements.filter(item => item.movement_type === "purchase_receipt").reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
      returnedUnits: dayMovements.filter(item => item.movement_type === "return").reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    });
  }
  const fulfilledByVariant = new Map<string, number>();
  for (const order of state.orders) for (const line of order.lines) fulfilledByVariant.set(line.variant_id, (fulfilledByVariant.get(line.variant_id) || 0) + line.quantity_fulfilled);
  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    currency: state.settings.currency,
    inventory: {
      onHandUnits: tracked.reduce((sum, row) => sum + row.on_hand, 0),
      reservedUnits: tracked.reduce((sum, row) => sum + row.reserved, 0),
      availableUnits: tracked.reduce((sum, row) => sum + row.available, 0),
      incomingUnits: tracked.reduce((sum, row) => sum + row.incoming, 0),
      inventoryValueMinor: dashboard(state).inventoryValueMinor,
      trackedPositions: tracked.length,
      lowStockPositions: tracked.filter(row => row.available <= state.settings.low_stock_threshold).length,
      stockoutPositions: tracked.filter(row => row.available <= 0).length,
    },
    orders: {
      createdOrders: recentOrders.length,
      openOrders: state.orders.filter(order => ["draft", "confirmed"].includes(order.status)).length,
      grossOrderValueMinor: recentOrders.reduce((sum, order) => sum + order.total_minor, 0),
      fulfilledUnits: state.orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity_fulfilled, 0), 0),
      returnedUnits: state.orders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity_returned, 0), 0),
    },
    purchasing: {
      openPurchaseOrders: openPos.length,
      overduePurchaseOrders: openPos.filter(po => !!po.expected_delivery_date && po.expected_delivery_date < isoDay(0)).length,
      outstandingCommitmentMinor: openPos.reduce((sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + (line.quantity_ordered - line.quantity_received) * line.unit_cost_minor, 0), 0),
      receivedUnits: state.purchaseOrders.reduce((sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.quantity_received, 0), 0),
    },
    locations: state.locations.map(location => {
      const rows = tracked.filter(row => row.location_id === location.id);
      return {
        locationId: location.id,
        locationName: location.name,
        onHandUnits: rows.reduce((sum, row) => sum + row.on_hand, 0),
        availableUnits: rows.reduce((sum, row) => sum + row.available, 0),
        inventoryValueMinor: rows.reduce((sum, row) => sum + row.on_hand * variantFor(state.products, row.variant_id).variant.cost_minor, 0),
      };
    }),
    topFulfilled: [...fulfilledByVariant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([variantId, fulfilledUnits]) => {
      const { product, variant } = variantFor(state.products, variantId);
      return { variantId, productName: product.name, variantName: variant.name, sku: variant.sku, fulfilledUnits };
    }),
    orderTrend,
    movementTrend,
  };
}

export async function demoTenantApi<T>(path: string, init?: RequestInit): Promise<T> {
  const state = ensureState();
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  const pathname = url.pathname;
  const body = parseBody(init);
  let result: unknown;
  let mutated = false;

  if (method === "GET" && pathname === "/dashboard") result = dashboard(state);
  else if (method === "GET" && pathname === "/products") result = state.products;
  else if (method === "GET" && pathname === "/modifiers") result = state.modifiers;
  else if (method === "GET" && pathname === "/locations") result = state.locations;
  else if (method === "GET" && pathname === "/inventory") result = state.inventory;
  else if (method === "GET" && pathname === "/suppliers") result = state.suppliers;
  else if (method === "GET" && pathname === "/customers") result = state.customers;
  else if (method === "GET" && pathname === "/supplier-variants") result = state.supplierVariants;
  else if (method === "GET" && pathname === "/inventory-policies") result = state.inventoryPolicies;
  else if (method === "GET" && pathname === "/purchase-orders") result = state.purchaseOrders;
  else if (method === "GET" && pathname === "/orders") result = state.orders;
  else if (method === "GET" && pathname === "/audit") result = state.audit;
  else if (method === "GET" && pathname === "/settings") result = state.settings;
  else if (method === "GET" && pathname === "/replenishment") result = replenishment(state);
  else if (method === "GET" && pathname === "/delivery-discrepancies") result = [];
  else if (method === "GET" && pathname === "/saved-views") result = state.savedViews.filter(view => !url.searchParams.get("page") || view.page === url.searchParams.get("page"));
  else if (method === "GET" && pathname === "/reports/operations") result = operationsReport(state, Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30)));
  else if (method === "GET" && pathname.startsWith("/inventory/barcode/")) {
    const barcode = decodeURIComponent(pathname.split("/")[3] || "");
    const match = state.products.flatMap(product => product.variants.map(variant => ({ product, variant }))).find(item => item.variant.barcode === barcode || item.variant.sku === barcode);
    if (!match) throw new Error("No active product variant matches that barcode");
    result = {
      product_name: match.product.name,
      variant_name: match.variant.name,
      sku: match.variant.sku,
      barcode: match.variant.barcode || barcode,
      levels: state.inventory.filter(row => row.variant_id === match.variant.id && row.tracked !== 0).map(row => ({ location_name: row.location_name, on_hand: row.on_hand, reserved: row.reserved, available: row.available })),
    };
  } else if (method === "GET" && /^\/purchase-orders\/[^/]+$/.test(pathname)) {
    const item = state.purchaseOrders.find(po => po.id === decodeURIComponent(pathname.split("/")[2]));
    if (!item) throw new Error("Purchase order not found");
    result = item;
  } else if (method === "GET" && /^\/orders\/[^/]+$/.test(pathname)) {
    const item = state.orders.find(order => order.id === decodeURIComponent(pathname.split("/")[2]));
    if (!item) throw new Error("Order not found");
    result = item;
  } else if (method === "POST" && pathname === "/products") {
    const id = crypto.randomUUID();
    const variantsInput = Array.isArray(body.variants) ? body.variants as JsonRecord[] : [];
    const product: Product = {
      id,
      name: String(body.name || "Untitled product"),
      description: body.description ? String(body.description) : null,
      category_name: body.category ? String(body.category) : null,
      status: "active",
      modifiers: state.modifiers.filter(modifier => Array.isArray(body.modifierIds) && (body.modifierIds as unknown[]).includes(modifier.id)),
      variants: variantsInput.map(input => ({
        id: crypto.randomUUID(),
        product_id: id,
        name: String(input.name || "Default"),
        sku: String(input.sku || `SKU-${crypto.randomUUID().slice(0, 6).toUpperCase()}`),
        barcode: input.barcode ? String(input.barcode) : null,
        price_minor: Number(input.priceMinor) || 0,
        cost_minor: Number(input.costMinor) || 0,
        tax_rate_bps: Number(input.taxRateBps) || state.settings.default_tax_rate_bps,
        active: 1,
        options: input.options && typeof input.options === "object" ? input.options as Record<string, string> : {},
      })),
    };
    state.products.unshift(product);
    for (const variant of product.variants) for (const location of state.locations) inventoryRow(state, variant.id, location.id);
    addAudit(state, "product.created", "product", product.id, { name: product.name });
    result = { id: product.id };
    mutated = true;
  } else if (method === "PATCH" && /^\/products\/[^/]+$/.test(pathname)) {
    const product = state.products.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!product) throw new Error("Product not found");
    product.name = String(body.name || product.name);
    product.category_name = body.category == null ? product.category_name : String(body.category || "") || null;
    product.description = body.description == null ? product.description : String(body.description || "") || null;
    if (Array.isArray(body.variants)) {
      for (const input of body.variants as JsonRecord[]) {
        const variant = product.variants.find(item => item.id === String(input.id || ""));
        if (!variant) continue;
        variant.name = String(input.name || variant.name);
        variant.sku = String(input.sku || variant.sku);
        variant.barcode = input.barcode ? String(input.barcode) : null;
        variant.price_minor = Number(input.priceMinor) || 0;
        variant.cost_minor = Number(input.costMinor) || 0;
        variant.tax_rate_bps = Number(input.taxRateBps) || 0;
      }
    }
    for (const row of state.inventory.filter(item => product.variants.some(variant => variant.id === item.variant_id))) {
      const variant = product.variants.find(item => item.id === row.variant_id)!;
      row.product_name = product.name;
      row.variant_name = variant.name;
      row.sku = variant.sku;
      row.barcode = variant.barcode;
    }
    addAudit(state, "product.updated", "product", product.id);
    result = { ok: true };
    mutated = true;
  } else if (method === "PATCH" && pathname === "/products/bulk-status") {
    const ids = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
    const status = body.status === "archived" ? "archived" : "active";
    let changed = 0;
    for (const product of state.products) if (ids.includes(product.id) && product.status !== status) { product.status = status; changed++; }
    addAudit(state, "product.bulk_status", "product", undefined, { productIds: ids, status });
    result = { changed, unchanged: ids.length - changed };
    mutated = true;
  } else if (method === "PATCH" && /^\/products\/[^/]+\/status$/.test(pathname)) {
    const product = state.products.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!product) throw new Error("Product not found");
    product.status = body.status === "archived" ? "archived" : "active";
    addAudit(state, "product.status_changed", "product", product.id, { status: product.status });
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && pathname === "/modifiers") {
    const modifier = { id: crypto.randomUUID(), name: String(body.name || "Modifier"), price_delta_minor: Number(body.priceDeltaMinor) || 0 };
    state.modifiers.push(modifier);
    addAudit(state, "modifier.created", "modifier", modifier.id);
    result = modifier;
    mutated = true;
  } else if (method === "POST" && pathname === "/locations") {
    const location = { id: crypto.randomUUID(), name: String(body.name || "New location"), code: String(body.code || "LOC") };
    state.locations.push(location);
    for (const product of state.products) for (const variant of product.variants) inventoryRow(state, variant.id, location.id);
    addAudit(state, "location.created", "location", location.id, { name: location.name });
    result = location;
    mutated = true;
  } else if (method === "POST" && pathname === "/inventory/adjust") {
    const row = inventoryRow(state, String(body.variantId || ""), String(body.locationId || ""));
    const delta = Number(body.quantityDelta) || 0;
    if (row.on_hand + delta < row.reserved) throw new Error("Adjustment would reduce on-hand stock below reserved stock");
    row.on_hand += delta;
    refreshAvailable(row);
    addMovement(state, row.variant_id, row.location_id, "adjustment", delta, "inventory", row.variant_id, body.reason ? String(body.reason) : undefined);
    addAudit(state, "inventory.adjusted", "inventory", row.variant_id, { quantityDelta: delta, reason: body.reason });
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && pathname === "/inventory/transfer") {
    const variantId = String(body.variantId || "");
    const from = inventoryRow(state, variantId, String(body.fromLocationId || ""));
    const to = inventoryRow(state, variantId, String(body.toLocationId || ""));
    const quantity = Math.max(0, Number(body.quantity) || 0);
    if (quantity <= 0 || from.available < quantity) throw new Error("Not enough available stock for that transfer");
    from.on_hand -= quantity;
    to.on_hand += quantity;
    refreshAvailable(from);
    refreshAvailable(to);
    addMovement(state, variantId, from.location_id, "transfer_out", -quantity, "transfer", "demo-transfer");
    addMovement(state, variantId, to.location_id, "transfer_in", quantity, "transfer", "demo-transfer");
    addAudit(state, "inventory.transferred", "inventory", variantId, { quantity, from: from.location_id, to: to.location_id });
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && pathname === "/inventory/stocktake") {
    const lines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    const locationId = String(body.locationId || "");
    let adjusted = 0;
    for (const input of lines) {
      const row = inventoryRow(state, String(input.variantId || ""), locationId);
      const counted = Math.max(0, Number(input.countedOnHand) || 0);
      const delta = counted - row.on_hand;
      if (!delta) continue;
      if (counted < row.reserved) throw new Error(`${row.product_name} has reserved stock that prevents this count`);
      row.on_hand = counted;
      refreshAvailable(row);
      addMovement(state, row.variant_id, row.location_id, "stocktake", delta, "stocktake", "demo-stocktake", body.reason ? String(body.reason) : undefined);
      adjusted++;
    }
    addAudit(state, "inventory.stocktake", "inventory", locationId, { adjusted });
    result = { ok: true, adjusted, unchanged: lines.length - adjusted };
    mutated = true;
  } else if ((method === "POST" || method === "PATCH") && /^\/(suppliers|customers)(\/[^/]+)?$/.test(pathname)) {
    const isSupplier = pathname.startsWith("/suppliers");
    const collection = isSupplier ? state.suppliers : state.customers;
    const existingId = pathname.split("/")[2];
    if (method === "PATCH") {
      const existing = collection.find(item => item.id === decodeURIComponent(existingId || ""));
      if (!existing) throw new Error(`${isSupplier ? "Supplier" : "Customer"} not found`);
      existing.name = String(body.name || existing.name);
      existing.email = body.email ? String(body.email) : null;
      existing.phone = body.phone ? String(body.phone) : null;
      existing.notes = body.notes ? String(body.notes) : null;
      result = { ok: true };
      addAudit(state, `${isSupplier ? "supplier" : "customer"}.updated`, isSupplier ? "supplier" : "customer", existing.id);
    } else {
      const created = { id: crypto.randomUUID(), name: String(body.name || (isSupplier ? "Supplier" : "Customer")), email: body.email ? String(body.email) : null, phone: body.phone ? String(body.phone) : null, notes: body.notes ? String(body.notes) : null };
      collection.push(created);
      result = created;
      addAudit(state, `${isSupplier ? "supplier" : "customer"}.created`, isSupplier ? "supplier" : "customer", created.id);
    }
    mutated = true;
  } else if (method === "POST" && pathname === "/supplier-variants") {
    const supplier = state.suppliers.find(item => item.id === String(body.supplierId || ""));
    const variantId = String(body.variantId || "");
    if (!supplier) throw new Error("Supplier not found");
    const { product, variant } = variantFor(state.products, variantId);
    const existing = state.supplierVariants.find(item => item.supplier_id === supplier.id && item.variant_id === variant.id);
    const mapping: SupplierVariant = {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      variant_id: variant.id,
      product_name: product.name,
      variant_name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      supplier_sku: body.supplierSku ? String(body.supplierSku) : null,
      last_cost_minor: body.lastCostMinor == null ? null : Number(body.lastCostMinor),
      lead_time_days: body.leadTimeDays == null ? null : Number(body.leadTimeDays),
    };
    if (existing) Object.assign(existing, mapping); else state.supplierVariants.push(mapping);
    addAudit(state, "supplier_variant.saved", "supplier_variant", variant.id, { supplierId: supplier.id });
    result = mapping;
    mutated = true;
  } else if (method === "DELETE" && /^\/supplier-variants\/[^/]+\/[^/]+$/.test(pathname)) {
    const [, , supplierId, variantId] = pathname.split("/");
    state.supplierVariants = state.supplierVariants.filter(item => item.supplier_id !== decodeURIComponent(supplierId) || item.variant_id !== decodeURIComponent(variantId));
    result = { ok: true };
    mutated = true;
  } else if (method === "PUT" && pathname === "/inventory-policies") {
    const variantId = String(body.variantId || "");
    const locationId = String(body.locationId || "");
    const { product, variant } = variantFor(state.products, variantId);
    const location = state.locations.find(item => item.id === locationId);
    if (!location) throw new Error("Location not found");
    const supplierId = body.preferredSupplierId ? String(body.preferredSupplierId) : null;
    const supplier = state.suppliers.find(item => item.id === supplierId);
    const value: InventoryPolicy = {
      variant_id: variant.id,
      product_name: product.name,
      variant_name: variant.name,
      sku: variant.sku,
      location_id: location.id,
      location_name: location.name,
      reorder_point: Math.max(0, Number(body.reorderPoint) || 0),
      target_stock: Math.max(0, Number(body.targetStock) || 0),
      preferred_supplier_id: supplier?.id || null,
      preferred_supplier_name: supplier?.name || null,
      updated_at: new Date().toISOString(),
      updated_by: "demo-user",
    };
    const existingIndex = state.inventoryPolicies.findIndex(item => item.variant_id === variant.id && item.location_id === location.id);
    if (existingIndex >= 0) state.inventoryPolicies[existingIndex] = value; else state.inventoryPolicies.push(value);
    addAudit(state, "inventory_policy.saved", "inventory_policy", `${variant.id}:${location.id}`);
    result = value;
    mutated = true;
  } else if (method === "DELETE" && /^\/inventory-policies\/[^/]+\/[^/]+$/.test(pathname)) {
    const [, , variantId, locationId] = pathname.split("/");
    state.inventoryPolicies = state.inventoryPolicies.filter(item => item.variant_id !== decodeURIComponent(variantId) || item.location_id !== decodeURIComponent(locationId));
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && pathname === "/purchase-orders") {
    const supplier = state.suppliers.find(item => item.id === String(body.supplierId || ""));
    const location = state.locations.find(item => item.id === String(body.locationId || ""));
    if (!supplier || !location) throw new Error("Choose a supplier and stock location");
    const inputs = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    let subtotal = 0;
    let tax = 0;
    const poId = crypto.randomUUID();
    const lines = inputs.map(input => {
      const { product, variant } = variantFor(state.products, String(input.variantId || ""));
      const quantity = Math.max(1, Number(input.quantity) || 1);
      const cost = Math.max(0, Number(input.unitCostMinor) || 0);
      const rate = Math.max(0, Number(input.taxRateBps) || 0);
      const amount = lineAmounts(cost, quantity, rate, false);
      subtotal += amount.net;
      tax += amount.tax;
      return { id: crypto.randomUUID(), variant_id: variant.id, sku_snapshot: variant.sku, description_snapshot: `${product.name} · ${variant.name}`, quantity_ordered: quantity, quantity_received: 0, unit_cost_minor: cost, tax_rate_bps: rate };
    });
    const po: PurchaseOrderDetail = {
      id: poId,
      number: nextNumber(state.purchaseOrders, "PO"),
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      location_id: location.id,
      location_name: location.name,
      status: "draft",
      subtotal_minor: subtotal,
      tax_minor: tax,
      total_minor: subtotal + tax,
      currency: state.settings.currency,
      line_count: lines.length,
      expected_delivery_date: null,
      ordered_at: null,
      created_at: new Date().toISOString(),
      lines,
    };
    state.purchaseOrders.unshift(po);
    addAudit(state, "purchase_order.created", "purchase_order", po.id, { number: po.number });
    result = { id: po.id, number: po.number };
    mutated = true;
  } else if (method === "POST" && /^\/purchase-orders\/[^/]+\/submit$/.test(pathname)) {
    const po = state.purchaseOrders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!po) throw new Error("Purchase order not found");
    if (po.status !== "draft") throw new Error("Only draft purchase orders can be submitted");
    po.status = "ordered";
    po.ordered_at = new Date().toISOString();
    if (!po.expected_delivery_date) {
      const leadTimes = po.lines.map(line => state.supplierVariants.find(mapping => mapping.supplier_id === po.supplier_id && mapping.variant_id === line.variant_id)?.lead_time_days).filter((value): value is number => value != null);
      if (leadTimes.length === po.lines.length) po.expected_delivery_date = isoDay(Math.max(...leadTimes));
    }
    for (const line of po.lines) {
      const row = inventoryRow(state, line.variant_id, po.location_id);
      row.incoming += line.quantity_ordered - line.quantity_received;
      refreshAvailable(row);
    }
    addAudit(state, "purchase_order.submitted", "purchase_order", po.id, { expectedDeliveryDate: po.expected_delivery_date });
    result = { ok: true, expectedDeliveryDate: po.expected_delivery_date };
    mutated = true;
  } else if (method === "PATCH" && /^\/purchase-orders\/[^/]+\/expected-delivery$/.test(pathname)) {
    const po = state.purchaseOrders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!po) throw new Error("Purchase order not found");
    po.expected_delivery_date = body.expectedDeliveryDate ? String(body.expectedDeliveryDate) : null;
    addAudit(state, "purchase_order.expected_delivery_updated", "purchase_order", po.id, { expectedDeliveryDate: po.expected_delivery_date });
    result = { ok: true, expectedDeliveryDate: po.expected_delivery_date };
    mutated = true;
  } else if (method === "POST" && /^\/purchase-orders\/[^/]+\/receive$/.test(pathname)) {
    const po = state.purchaseOrders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!po) throw new Error("Purchase order not found");
    const inputs = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    for (const input of inputs) {
      const line = po.lines.find(item => item.id === String(input.lineId || ""));
      if (!line) continue;
      const remaining = line.quantity_ordered - line.quantity_received;
      const quantity = Math.max(0, Math.min(remaining, Number(input.quantity) || 0));
      if (!quantity) continue;
      line.quantity_received += quantity;
      const row = inventoryRow(state, line.variant_id, po.location_id);
      row.on_hand += quantity;
      row.incoming = Math.max(0, row.incoming - quantity);
      refreshAvailable(row);
      addMovement(state, line.variant_id, po.location_id, "purchase_receipt", quantity, "purchase_order", po.id);
    }
    const outstanding = po.lines.reduce((sum, line) => sum + line.quantity_ordered - line.quantity_received, 0);
    po.status = outstanding === 0 ? "received" : "partially_received";
    addAudit(state, "purchase_order.received", "purchase_order", po.id, { outstanding });
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && /^\/purchase-orders\/[^/]+\/cancel$/.test(pathname)) {
    const po = state.purchaseOrders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!po) throw new Error("Purchase order not found");
    if (["ordered", "partially_received"].includes(po.status)) {
      for (const line of po.lines) {
        const outstanding = line.quantity_ordered - line.quantity_received;
        const row = inventoryRow(state, line.variant_id, po.location_id);
        row.incoming = Math.max(0, row.incoming - outstanding);
        refreshAvailable(row);
      }
    }
    po.status = "cancelled";
    addAudit(state, "purchase_order.cancelled", "purchase_order", po.id);
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && pathname === "/orders") {
    const location = state.locations.find(item => item.id === String(body.locationId || ""));
    if (!location) throw new Error("Choose a fulfilment location");
    const customer = state.customers.find(item => item.id === String(body.customerId || ""));
    const inputs = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    let subtotal = 0;
    let tax = 0;
    const orderId = crypto.randomUUID();
    const lines = inputs.map(input => {
      const { product, variant } = variantFor(state.products, String(input.variantId || ""));
      const quantity = Math.max(1, Number(input.quantity) || 1);
      const selectedModifiers = Array.isArray(input.modifiers) ? input.modifiers as JsonRecord[] : [];
      const modifiers = selectedModifiers.map(selected => {
        const modifier = state.modifiers.find(item => item.id === String(selected.modifierId || ""));
        return modifier ? { id: crypto.randomUUID(), name_snapshot: modifier.name, quantity: Math.max(1, Number(selected.quantity) || 1), unit_price_delta_minor: modifier.price_delta_minor } : null;
      }).filter((value): value is NonNullable<typeof value> => !!value);
      const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.unit_price_delta_minor * modifier.quantity, 0);
      const amount = lineAmounts(variant.price_minor + modifierTotal, quantity, variant.tax_rate_bps, state.settings.prices_include_tax === 1);
      subtotal += amount.net;
      tax += amount.tax;
      return { id: crypto.randomUUID(), variant_id: variant.id, product_name_snapshot: product.name, variant_name_snapshot: variant.name, sku_snapshot: variant.sku, quantity, quantity_fulfilled: 0, quantity_returned: 0, unit_price_minor: variant.price_minor, tax_rate_bps: variant.tax_rate_bps, modifiers };
    });
    const order: OrderDetail = {
      id: orderId,
      number: nextNumber(state.orders, "ORD"),
      customer_id: customer?.id || null,
      customer_name: customer?.name || null,
      location_id: location.id,
      location_name: location.name,
      status: "draft",
      fulfilment_status: "unfulfilled",
      priority: "normal",
      required_by_date: null,
      subtotal_minor: subtotal,
      tax_minor: tax,
      total_minor: subtotal + tax,
      currency: state.settings.currency,
      line_count: lines.length,
      created_at: new Date().toISOString(),
      lines,
    };
    state.orders.unshift(order);
    addAudit(state, "order.created", "order", order.id, { number: order.number });
    result = { id: order.id, number: order.number };
    mutated = true;
  } else if (method === "POST" && /^\/orders\/[^/]+\/confirm$/.test(pathname)) {
    const order = state.orders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!order) throw new Error("Order not found");
    if (order.status !== "draft") throw new Error("Only draft orders can be confirmed");
    for (const line of order.lines) {
      const row = inventoryRow(state, line.variant_id, order.location_id);
      if (row.available < line.quantity) throw new Error(`${line.product_name_snapshot} · ${line.variant_name_snapshot} does not have enough available stock`);
    }
    for (const line of order.lines) {
      const row = inventoryRow(state, line.variant_id, order.location_id);
      row.reserved += line.quantity;
      refreshAvailable(row);
    }
    order.status = "confirmed";
    addAudit(state, "order.confirmed", "order", order.id);
    result = { ok: true };
    mutated = true;
  } else if (method === "PATCH" && /^\/orders\/[^/]+\/planning$/.test(pathname)) {
    const order = state.orders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!order) throw new Error("Order not found");
    order.required_by_date = body.requiredByDate ? String(body.requiredByDate) : null;
    if (["low", "normal", "high", "urgent"].includes(String(body.priority))) order.priority = body.priority as OrderDetail["priority"];
    addAudit(state, "order.planning_updated", "order", order.id, { requiredByDate: order.required_by_date, priority: order.priority });
    result = { ok: true, requiredByDate: order.required_by_date, priority: order.priority };
    mutated = true;
  } else if (method === "POST" && /^\/orders\/[^/]+\/fulfil$/.test(pathname)) {
    const order = state.orders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!order) throw new Error("Order not found");
    const inputs = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    for (const input of inputs) {
      const line = order.lines.find(item => item.id === String(input.lineId || ""));
      if (!line) continue;
      const remaining = line.quantity - line.quantity_fulfilled;
      const quantity = Math.max(0, Math.min(remaining, Number(input.quantity) || 0));
      if (!quantity) continue;
      const row = inventoryRow(state, line.variant_id, order.location_id);
      if (row.on_hand < quantity) throw new Error("Not enough stock on hand to fulfil that quantity");
      line.quantity_fulfilled += quantity;
      row.on_hand -= quantity;
      row.reserved = Math.max(0, row.reserved - quantity);
      refreshAvailable(row);
      addMovement(state, line.variant_id, order.location_id, "fulfilment", -quantity, "order", order.id);
    }
    const remaining = order.lines.reduce((sum, line) => sum + line.quantity - line.quantity_fulfilled, 0);
    order.fulfilment_status = remaining === 0 ? "fulfilled" : "partially_fulfilled";
    if (remaining === 0) order.status = "completed";
    addAudit(state, "order.fulfilled", "order", order.id, { remaining });
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && /^\/orders\/[^/]+\/cancel$/.test(pathname)) {
    const order = state.orders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!order) throw new Error("Order not found");
    if (order.status === "confirmed") {
      for (const line of order.lines) {
        const outstanding = line.quantity - line.quantity_fulfilled;
        const row = inventoryRow(state, line.variant_id, order.location_id);
        row.reserved = Math.max(0, row.reserved - outstanding);
        refreshAvailable(row);
      }
    }
    order.status = "cancelled";
    addAudit(state, "order.cancelled", "order", order.id);
    result = { ok: true };
    mutated = true;
  } else if (method === "POST" && /^\/orders\/[^/]+\/return$/.test(pathname)) {
    const order = state.orders.find(item => item.id === decodeURIComponent(pathname.split("/")[2]));
    if (!order) throw new Error("Order not found");
    const inputs = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
    for (const input of inputs) {
      const line = order.lines.find(item => item.id === String(input.lineId || ""));
      if (!line) continue;
      const returnable = line.quantity_fulfilled - line.quantity_returned;
      const quantity = Math.max(0, Math.min(returnable, Number(input.quantity) || 0));
      if (!quantity) continue;
      line.quantity_returned += quantity;
      if (input.restock !== false) {
        const row = inventoryRow(state, line.variant_id, order.location_id);
        row.on_hand += quantity;
        refreshAvailable(row);
        addMovement(state, line.variant_id, order.location_id, "return", quantity, "order", order.id, body.notes ? String(body.notes) : undefined);
      }
    }
    const totalFulfilled = order.lines.reduce((sum, line) => sum + line.quantity_fulfilled, 0);
    const totalReturned = order.lines.reduce((sum, line) => sum + line.quantity_returned, 0);
    order.fulfilment_status = totalReturned >= totalFulfilled && totalFulfilled > 0 ? "returned" : "partially_returned";
    addAudit(state, "order.returned", "order", order.id, { returned: totalReturned });
    result = { ok: true };
    mutated = true;
  } else if (method === "PATCH" && pathname === "/settings") {
    if (typeof body.currency === "string") state.settings.currency = body.currency;
    if (typeof body.pricesIncludeTax === "boolean") state.settings.prices_include_tax = body.pricesIncludeTax ? 1 : 0;
    if (body.defaultTaxRateBps != null) state.settings.default_tax_rate_bps = Math.max(0, Number(body.defaultTaxRateBps) || 0);
    if (body.lowStockThreshold != null) state.settings.low_stock_threshold = Math.max(0, Number(body.lowStockThreshold) || 0);
    addAudit(state, "settings.updated", "settings", "1");
    result = state.settings;
    mutated = true;
  } else if (method === "POST" && pathname === "/saved-views") {
    const page = body.page === "purchasing" ? "purchasing" : "inventory";
    const view: DemoSavedView = { id: crypto.randomUUID(), page, name: String(body.name || "Saved view"), config: body.config && typeof body.config === "object" ? body.config as Record<string, unknown> : {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    state.savedViews.push(view);
    result = view;
    mutated = true;
  } else if (method === "DELETE" && /^\/saved-views\/[^/]+$/.test(pathname)) {
    const id = decodeURIComponent(pathname.split("/")[2]);
    state.savedViews = state.savedViews.filter(view => view.id !== id);
    result = { ok: true };
    mutated = true;
  } else if (pathname.startsWith("/imports/catalogue/")) {
    throw new Error("CSV import is intentionally disabled in the local guest demo. Add and edit products directly to exercise the catalogue workflow without uploading files.");
  } else {
    throw new Error(`This local demo action is not available yet (${method} ${pathname}).`);
  }

  if (mutated) persist(state);
  return structuredClone(result) as T;
}

export async function demoOpsApi<T>(path: string): Promise<T> {
  const state = ensureState();
  const url = new URL(path, "https://demo.local");
  let result: unknown;
  if (url.pathname === "/movements") result = state.movements;
  else if (url.pathname === "/search") {
    const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
    const results: Array<{ id: string; type: string; title: string; subtitle: string; page: string; badge?: string }> = [];
    for (const product of state.products) {
      if ([product.name, product.category_name, ...product.variants.flatMap(variant => [variant.name, variant.sku, variant.barcode])].some(value => String(value || "").toLocaleLowerCase().includes(query))) results.push({ id: product.id, type: "Product", title: product.name, subtitle: product.variants.map(variant => variant.sku).join(" · "), page: "products", badge: product.status });
    }
    for (const order of state.orders) if ([order.number, order.customer_name, order.location_name].some(value => String(value || "").toLocaleLowerCase().includes(query))) results.push({ id: order.id, type: "Order", title: order.number, subtitle: `${order.customer_name || "Guest"} · ${order.location_name}`, page: "orders", badge: order.status });
    for (const po of state.purchaseOrders) if ([po.number, po.supplier_name, po.location_name].some(value => String(value || "").toLocaleLowerCase().includes(query))) results.push({ id: po.id, type: "Purchase order", title: po.number, subtitle: `${po.supplier_name} · ${po.location_name}`, page: "purchasing", badge: po.status });
    for (const supplier of state.suppliers) if ([supplier.name, supplier.email].some(value => String(value || "").toLocaleLowerCase().includes(query))) results.push({ id: supplier.id, type: "Supplier", title: supplier.name, subtitle: supplier.email || "Supplier", page: "suppliers" });
    for (const customer of state.customers) if ([customer.name, customer.email].some(value => String(value || "").toLocaleLowerCase().includes(query))) results.push({ id: customer.id, type: "Customer", title: customer.name, subtitle: customer.email || "Customer", page: "customers" });
    result = { results: results.slice(0, 20) };
  } else if (url.pathname === "/attention") {
    const items: Array<{ id: string; severity: "critical" | "warning" | "info"; type: string; title: string; detail: string; page: string }> = [];
    for (const order of state.orders.filter(item => item.status === "confirmed" && item.fulfilment_status !== "fulfilled")) items.push({ id: `order:${order.id}`, severity: order.priority === "urgent" ? "critical" : "warning", type: "Awaiting fulfilment", title: `${order.number} · ${order.customer_name || "Guest"}`, detail: `${order.location_name}${order.required_by_date ? ` · required ${order.required_by_date}` : ""}`, page: "orders" });
    for (const row of state.inventory.filter(item => item.tracked !== 0 && item.available <= state.settings.low_stock_threshold)) items.push({ id: `stock:${row.variant_id}:${row.location_id}`, severity: row.available <= 0 ? "critical" : "warning", type: "Low stock", title: `${row.product_name} · ${row.variant_name}`, detail: `${row.available} available at ${row.location_name} · ${row.incoming} incoming`, page: "inventory" });
    for (const po of state.purchaseOrders.filter(item => ["ordered", "partially_received"].includes(item.status) && !!item.expected_delivery_date && item.expected_delivery_date < isoDay(0))) items.push({ id: `po:${po.id}`, severity: "warning", type: "Overdue purchase order", title: `${po.number} · ${po.supplier_name}`, detail: `Expected ${po.expected_delivery_date}`, page: "purchasing" });
    result = { total: items.length, items: items.slice(0, 20) };
  } else throw new Error(`This local demo operation is not available (${url.pathname}).`);
  return structuredClone(result) as T;
}

export async function demoControlApi<T>(path: string, init?: RequestInit): Promise<T> {
  const state = ensureState();
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  const body = parseBody(init);
  let result: unknown;
  let mutated = false;

  if (method === "GET" && /^\/organizations\/[^/]+\/members$/.test(url.pathname)) result = { members: state.members, pendingInvites: state.pendingInvites, canManage: true };
  else if (method === "POST" && /^\/organizations\/[^/]+\/invites$/.test(url.pathname)) {
    const createdAt = Date.now();
    const invite: DemoInvite = { id: crypto.randomUUID(), email: String(body.email || "guest@example.com"), role: (["admin", "manager", "inventory", "fulfilment", "viewer"].includes(String(body.role)) ? body.role : "viewer") as DemoInvite["role"], createdAt, expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000 };
    state.pendingInvites.unshift(invite);
    result = { id: invite.id, inviteUrl: `${window.location.origin}/?demo-invite=${invite.id}`, expiresAt: invite.expiresAt };
    mutated = true;
  } else if (method === "PATCH" && /^\/organizations\/[^/]+\/members\/[^/]+$/.test(url.pathname)) {
    const memberId = decodeURIComponent(url.pathname.split("/")[4]);
    const member = state.members.find(item => item.id === memberId);
    if (!member) throw new Error("Member not found");
    if (member.role === "owner") throw new Error("Demo ownership cannot be changed");
    if (["admin", "manager", "inventory", "fulfilment", "viewer"].includes(String(body.role))) member.role = body.role as DemoMember["role"];
    result = { ok: true };
    mutated = true;
  } else if (method === "GET" && url.pathname === "/documents/capabilities") result = { aiDocumentExtractionEnabled: false, aiProcessingResidency: "not used in local demo", storedSourceResidency: "browser localStorage only" };
  else if (method === "GET" && url.pathname === "/documents") result = { documents: [], truncated: false };
  else if (method === "GET" && url.pathname === "/documents/proposals") result = { proposals: [], truncated: false };
  else if (url.pathname.startsWith("/documents")) throw new Error("Document upload and AI extraction are disabled in the local guest demo because demo data never leaves this browser.");
  else throw new Error(`This local demo control action is not available (${method} ${url.pathname}).`);

  if (mutated) persist(state);
  return structuredClone(result) as T;
}

export function demoCsv(kind: string) {
  const state = ensureState();
  const rows: string[][] = [];
  if (kind === "products") {
    rows.push(["product", "variant", "sku", "barcode", "status"]);
    for (const product of state.products) for (const variant of product.variants) rows.push([product.name, variant.name, variant.sku, variant.barcode || "", product.status]);
  } else if (kind === "inventory") {
    rows.push(["product", "variant", "sku", "location", "on_hand", "reserved", "available", "incoming"]);
    for (const row of state.inventory) rows.push([row.product_name, row.variant_name, row.sku, row.location_name, String(row.on_hand), String(row.reserved), String(row.available), String(row.incoming)]);
  } else if (kind === "orders") {
    rows.push(["number", "customer", "location", "status", "fulfilment", "total_minor", "currency"]);
    for (const order of state.orders) rows.push([order.number, order.customer_name || "", order.location_name, order.status, order.fulfilment_status, String(order.total_minor), order.currency]);
  } else if (kind === "customers") {
    rows.push(["name", "email", "phone"]);
    for (const customer of state.customers) rows.push([customer.name, customer.email || "", customer.phone || ""]);
  } else if (kind === "suppliers") {
    rows.push(["name", "email", "phone"]);
    for (const supplier of state.suppliers) rows.push([supplier.name, supplier.email || "", supplier.phone || ""]);
  } else if (kind === "audit") {
    rows.push(["created_at", "actor", "role", "action", "entity_type", "entity_id"]);
    for (const event of state.audit) rows.push([event.created_at, event.actor_id, event.actor_role, event.action, event.entity_type, event.entity_id || ""]);
  } else {
    rows.push(["message"], [`${kind} export is empty in the local demo`]);
  }
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return { filename: `operating-layer-demo-${kind}.csv`, content: rows.map(row => row.map(escape).join(",")).join("\n") };
}
