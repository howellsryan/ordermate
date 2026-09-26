import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { TENANT_SCHEMA } from "./tenant-schema";

export type TenantEnv = Record<string, never>;

type Actor = { id: string; role: string };
type SqlRow = Record<string, string | number | null>;

class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status = 400) => json({ error: message }, status);
function fail(message: string, status = 400): never { throw new DomainError(message, status); }

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  modifierIds: z.array(z.string()).default([]),
  variants: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    sku: z.string().trim().min(1).max(100),
    barcode: z.string().trim().max(100).optional(),
    priceMinor: z.number().int().nonnegative(),
    costMinor: z.number().int().nonnegative().default(0),
    taxRateBps: z.number().int().min(0).max(10000).optional(),
    options: z.record(z.string(), z.string()).default({}),
  })).min(1),
});

const locationInput = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(30),
  address: z.record(z.string(), z.unknown()).optional(),
});

const supplierInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(80).optional(),
  notes: z.string().max(4000).optional(),
});

const customerInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(80).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(4000).optional(),
});

export class TenantStore extends DurableObject<TenantEnv> {
  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(TENANT_SCHEMA);
      const count = this.one<{ count: number }>("SELECT COUNT(*) AS count FROM tenant_settings");
      if (!count?.count) {
        const timestamp = now();
        this.ctx.storage.sql.exec(
          "INSERT INTO tenant_settings (id, created_at, updated_at) VALUES (1, ?, ?)",
          timestamp,
          timestamp,
        );
      }
    });
  }

  private rows<T extends SqlRow>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }

  private one<T extends SqlRow>(query: string, ...bindings: unknown[]): T | undefined {
    return this.rows<T>(query, ...bindings)[0];
  }

  private actor(request: Request): Actor {
    return {
      id: request.headers.get("x-ordermate-actor-id") || "system",
      role: request.headers.get("x-ordermate-actor-role") || "unknown",
    };
  }

  private audit(actor: Actor, action: string, entityType: string, entityId?: string, metadata?: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id(),
      actor.id,
      actor.role,
      action,
      entityType,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      now(),
    );
  }

  private settings() {
    return this.one<{
      currency: string;
      prices_include_tax: number;
      default_tax_rate_bps: number;
      low_stock_threshold: number;
    }>("SELECT currency, prices_include_tax, default_tax_rate_bps, low_stock_threshold FROM tenant_settings WHERE id = 1")!;
  }

  private nextNumber(sequence: "order" | "purchase_order", prefix: "ORD" | "PO") {
    this.ctx.storage.sql.exec(
      "INSERT INTO sequences (name, next_value) VALUES (?, 1) ON CONFLICT(name) DO NOTHING",
      sequence,
    );
    const row = this.one<{ next_value: number }>("SELECT next_value FROM sequences WHERE name = ?", sequence)!;
    this.ctx.storage.sql.exec("UPDATE sequences SET next_value = next_value + 1 WHERE name = ?", sequence);
    const year = new Date().getUTCFullYear();
    return `${prefix}-${year}-${String(row.next_value).padStart(6, "0")}`;
  }

  private lineAmounts(unitMinor: number, quantity: number, taxRateBps: number, inclusive: boolean) {
    if (inclusive) {
      const gross = unitMinor * quantity;
      const net = Math.round(gross * 10000 / (10000 + taxRateBps));
      return { net, tax: gross - net, gross };
    }
    const net = unitMinor * quantity;
    const tax = Math.round(net * taxRateBps / 10000);
    return { net, tax, gross: net + tax };
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const method = request.method;

      if (method === "GET" && path === "/dashboard") return await this.dashboard();
      if (method === "GET" && path === "/products") return await this.listProducts();
      if (method === "POST" && path === "/products") return await this.createProduct(request);
      if (method === "GET" && path === "/modifiers") return json(this.rows("SELECT * FROM modifiers WHERE active = 1 ORDER BY name"));
      if (method === "POST" && path === "/modifiers") return await this.createModifier(request);
      if (method === "GET" && path === "/locations") return json(this.rows("SELECT * FROM locations WHERE active = 1 ORDER BY name"));
      if (method === "POST" && path === "/locations") return await this.createLocation(request);
      if (method === "GET" && path === "/inventory") return await this.listInventory();
      if (method === "GET" && /^\/inventory\/barcode\/[^/]+$/.test(path)) return await this.lookupBarcode(decodeURIComponent(path.split("/")[3]));
      if (method === "POST" && path === "/inventory/adjust") return await this.adjustInventory(request);
      if (method === "POST" && path === "/inventory/transfer") return await this.transferInventory(request);
      if (method === "GET" && path === "/suppliers") return json(this.rows("SELECT * FROM suppliers WHERE active = 1 ORDER BY name"));
      if (method === "POST" && path === "/suppliers") return await this.createSupplier(request);
      if (method === "GET" && path === "/customers") return json(this.rows("SELECT * FROM customers ORDER BY name"));
      if (method === "POST" && path === "/customers") return await this.createCustomer(request);
      if (method === "GET" && path === "/purchase-orders") return await this.listPurchaseOrders();
      if (method === "GET" && /^\/purchase-orders\/[^/]+$/.test(path)) return await this.getPurchaseOrder(path.split("/")[2]);
      if (method === "POST" && path === "/purchase-orders") return await this.createPurchaseOrder(request);
      if (method === "POST" && /^\/purchase-orders\/[^/]+\/submit$/.test(path)) return await this.submitPurchaseOrder(path.split("/")[2], request);
      if (method === "POST" && /^\/purchase-orders\/[^/]+\/receive$/.test(path)) return await this.receivePurchaseOrder(path.split("/")[2], request);
      if (method === "GET" && path === "/orders") return await this.listOrders();
      if (method === "GET" && /^\/orders\/[^/]+$/.test(path)) return await this.getOrder(path.split("/")[2]);
      if (method === "POST" && path === "/orders") return await this.createOrder(request);
      if (method === "POST" && /^\/orders\/[^/]+\/confirm$/.test(path)) return await this.confirmOrder(path.split("/")[2], request);
      if (method === "POST" && /^\/orders\/[^/]+\/fulfil$/.test(path)) return await this.fulfilOrder(path.split("/")[2], request);
      if (method === "POST" && /^\/orders\/[^/]+\/cancel$/.test(path)) return await this.cancelOrder(path.split("/")[2], request);
      if (method === "POST" && /^\/orders\/[^/]+\/return$/.test(path)) return await this.returnOrder(path.split("/")[2], request);
      if (method === "GET" && path === "/audit") return json(this.rows("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100"));
      if (method === "GET" && path === "/settings") return json(this.one("SELECT * FROM tenant_settings WHERE id = 1"));
      if (method === "PATCH" && path === "/settings") return await this.updateSettings(request);

      return error("Not found", 404);
    } catch (cause) {
      if (cause instanceof z.ZodError) return error(cause.issues[0]?.message || "Invalid request", 400);
      if (cause instanceof DomainError) return error(cause.message, cause.status);
      console.error("TenantStore request failed", cause);
      return error(cause instanceof Error ? cause.message : "Unexpected error", 500);
    }
  }

  private dashboard() {
    const settings = this.settings();
    return json({
      ordersOpen: this.one<{ count: number }>("SELECT COUNT(*) AS count FROM orders WHERE status IN ('draft','confirmed')")?.count ?? 0,
      ordersAwaitingFulfilment: this.one<{ count: number }>("SELECT COUNT(*) AS count FROM orders WHERE status = 'confirmed' AND fulfilment_status != 'fulfilled'")?.count ?? 0,
      purchaseOrdersOpen: this.one<{ count: number }>("SELECT COUNT(*) AS count FROM purchase_orders WHERE status IN ('draft','ordered','partially_received')")?.count ?? 0,
      lowStockVariants: this.one<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_levels WHERE (on_hand - reserved) <= ?", settings.low_stock_threshold)?.count ?? 0,
      inventoryValueMinor: this.one<{ total: number | null }>("SELECT SUM(il.on_hand * v.cost_minor) AS total FROM inventory_levels il JOIN product_variants v ON v.id = il.variant_id")?.total ?? 0,
      currency: settings.currency,
    });
  }

  private listProducts() {
    const products = this.rows<{ id: string; name: string; description: string | null; category_name: string | null; status: string; created_at: string }>(
      "SELECT p.id, p.name, p.description, c.name AS category_name, p.status, p.created_at FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.created_at DESC",
    );
    const variants = this.rows<{ id: string; product_id: string; name: string; sku: string; barcode: string | null; price_minor: number; cost_minor: number; tax_rate_bps: number; active: number }>(
      "SELECT id, product_id, name, sku, barcode, price_minor, cost_minor, tax_rate_bps, active FROM product_variants ORDER BY name",
    );
    const options = this.rows<{ variant_id: string; option_name: string; option_value: string }>("SELECT * FROM variant_option_values ORDER BY option_name");
    const links = this.rows<{ product_id: string; modifier_id: string }>("SELECT * FROM product_modifiers");
    const modifiers = this.rows<{ id: string; name: string; price_delta_minor: number }>("SELECT id, name, price_delta_minor FROM modifiers WHERE active = 1");

    return json(products.map(product => ({
      ...product,
      variants: variants.filter(v => v.product_id === product.id).map(variant => ({
        ...variant,
        options: Object.fromEntries(options.filter(o => o.variant_id === variant.id).map(o => [o.option_name, o.option_value])),
      })),
      modifiers: modifiers.filter(modifier => links.some(link => link.product_id === product.id && link.modifier_id === modifier.id)),
    })));
  }

  private async createProduct(request: Request) {
    const input = productInput.parse(await request.json());
    const actor = this.actor(request);
    const settings = this.settings();
    const productId = id();
    const timestamp = now();

    this.ctx.storage.transactionSync(() => {
      let categoryId: string | null = null;
      if (input.category) {
        const existing = this.one<{ id: string }>("SELECT id FROM categories WHERE name = ? COLLATE NOCASE", input.category);
        categoryId = existing?.id ?? id();
        if (!existing) this.ctx.storage.sql.exec("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", categoryId, input.category, timestamp);
      }

      this.ctx.storage.sql.exec(
        "INSERT INTO products (id, name, description, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        productId,
        input.name,
        input.description ?? null,
        categoryId,
        timestamp,
        timestamp,
      );

      for (const variant of input.variants) {
        const variantId = id();
        this.ctx.storage.sql.exec(
          "INSERT INTO product_variants (id, product_id, name, sku, barcode, price_minor, cost_minor, tax_rate_bps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          variantId,
          productId,
          variant.name,
          variant.sku,
          variant.barcode || null,
          variant.priceMinor,
          variant.costMinor,
          variant.taxRateBps ?? settings.default_tax_rate_bps,
          timestamp,
          timestamp,
        );
        for (const [optionName, optionValue] of Object.entries(variant.options)) {
          this.ctx.storage.sql.exec(
            "INSERT INTO variant_option_values (variant_id, option_name, option_value) VALUES (?, ?, ?)",
            variantId,
            optionName,
            optionValue,
          );
        }
      }

      for (const modifierId of input.modifierIds) {
        if (!this.one<{ id: string }>("SELECT id FROM modifiers WHERE id = ? AND active = 1", modifierId)) fail("Unknown modifier");
        this.ctx.storage.sql.exec("INSERT INTO product_modifiers (product_id, modifier_id) VALUES (?, ?)", productId, modifierId);
      }
      this.audit(actor, "product.created", "product", productId, { name: input.name, variants: input.variants.length });
    });
    return json({ id: productId }, 201);
  }

  private async createModifier(request: Request) {
    const input = z.object({ name: z.string().trim().min(1).max(160), priceDeltaMinor: z.number().int() }).parse(await request.json());
    const actor = this.actor(request);
    const modifierId = id();
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "INSERT INTO modifiers (id, name, price_delta_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      modifierId,
      input.name,
      input.priceDeltaMinor,
      timestamp,
      timestamp,
    );
    this.audit(actor, "modifier.created", "modifier", modifierId, input);
    return json({ id: modifierId }, 201);
  }

  private async createLocation(request: Request) {
    const input = locationInput.parse(await request.json());
    const actor = this.actor(request);
    const locationId = id();
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "INSERT INTO locations (id, name, code, address_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      locationId,
      input.name,
      input.code.toUpperCase(),
      input.address ? JSON.stringify(input.address) : null,
      timestamp,
      timestamp,
    );
    this.audit(actor, "location.created", "location", locationId, { name: input.name });
    return json({ id: locationId }, 201);
  }

  private listInventory() {
    return json(this.rows(
      `SELECT v.id AS variant_id, p.name AS product_name, v.name AS variant_name, v.sku, v.barcode,
              l.id AS location_id, l.name AS location_name,
              COALESCE(il.on_hand, 0) AS on_hand, COALESCE(il.reserved, 0) AS reserved,
              COALESCE(il.on_hand, 0) - COALESCE(il.reserved, 0) AS available,
              COALESCE((SELECT SUM(pol.quantity_ordered - pol.quantity_received)
                FROM purchase_order_lines pol JOIN purchase_orders po ON po.id = pol.purchase_order_id
                WHERE pol.variant_id = v.id AND po.location_id = l.id AND po.status IN ('ordered','partially_received')), 0) AS incoming
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       CROSS JOIN locations l
       LEFT JOIN inventory_levels il ON il.variant_id = v.id AND il.location_id = l.id
       WHERE v.active = 1 AND l.active = 1
       ORDER BY p.name, v.name, l.name`,
    ));
  }

  private lookupBarcode(barcode: string) {
    const item = this.one<{
      variant_id: string;
      product_name: string;
      variant_name: string;
      sku: string;
      barcode: string;
      price_minor: number;
    }>(
      "SELECT v.id AS variant_id, p.name AS product_name, v.name AS variant_name, v.sku, v.barcode, v.price_minor FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ? AND v.active = 1",
      barcode,
    );
    if (!item) return error("Barcode not found", 404);
    const levels = this.rows<{ location_id: string; location_name: string; on_hand: number; reserved: number; available: number }>(
      `SELECT l.id AS location_id, l.name AS location_name, COALESCE(il.on_hand,0) AS on_hand,
       COALESCE(il.reserved,0) AS reserved, COALESCE(il.on_hand,0)-COALESCE(il.reserved,0) AS available
       FROM locations l LEFT JOIN inventory_levels il ON il.location_id = l.id AND il.variant_id = ? WHERE l.active = 1 ORDER BY l.name`,
      item.variant_id,
    );
    return json({ ...item, levels });
  }

  private async adjustInventory(request: Request) {
    const input = z.object({
      variantId: z.string(),
      locationId: z.string(),
      quantityDelta: z.number().int(),
      reason: z.string().trim().min(1).max(500),
    }).parse(await request.json());
    const actor = this.actor(request);

    this.ctx.storage.transactionSync(() => {
      const current = this.one<{ on_hand: number; reserved: number }>(
        "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?",
        input.variantId,
        input.locationId,
      ) ?? { on_hand: 0, reserved: 0 };
      const next = current.on_hand + input.quantityDelta;
      if (next < current.reserved || next < 0) fail("Adjustment would reduce on-hand stock below reserved stock", 409);

      this.ctx.storage.sql.exec(
        `INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(variant_id, location_id) DO UPDATE SET on_hand = excluded.on_hand, updated_at = excluded.updated_at`,
        input.variantId,
        input.locationId,
        next,
        current.reserved,
        now(),
      );
      const movementId = id();
      this.ctx.storage.sql.exec(
        "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reason, actor_id, created_at) VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?)",
        movementId,
        input.variantId,
        input.locationId,
        input.quantityDelta,
        input.reason,
        actor.id,
        now(),
      );
      this.audit(actor, "inventory.adjusted", "inventory_movement", movementId, input);
    });
    return json({ ok: true });
  }

  private async transferInventory(request: Request) {
    const input = z.object({
      variantId: z.string(),
      fromLocationId: z.string(),
      toLocationId: z.string(),
      quantity: z.number().int().positive(),
    }).parse(await request.json());
    if (input.fromLocationId === input.toLocationId) return error("Source and destination must differ");
    const actor = this.actor(request);

    this.ctx.storage.transactionSync(() => {
      const source = this.one<{ on_hand: number; reserved: number }>(
        "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?",
        input.variantId,
        input.fromLocationId,
      ) ?? { on_hand: 0, reserved: 0 };
      if (source.on_hand - source.reserved < input.quantity) fail("Insufficient available stock for transfer", 409);

      const timestamp = now();
      this.ctx.storage.sql.exec(
        "UPDATE inventory_levels SET on_hand = on_hand - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
        input.quantity,
        timestamp,
        input.variantId,
        input.fromLocationId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(variant_id, location_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand, updated_at = excluded.updated_at`,
        input.variantId,
        input.toLocationId,
        input.quantity,
        timestamp,
      );
      const transferId = id();
      this.ctx.storage.sql.exec(
        "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, actor_id, created_at) VALUES (?, ?, ?, ?, 'transfer_out', 'transfer', ?, ?, ?)",
        id(), input.variantId, input.fromLocationId, -input.quantity, transferId, actor.id, timestamp,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, actor_id, created_at) VALUES (?, ?, ?, ?, 'transfer_in', 'transfer', ?, ?, ?)",
        id(), input.variantId, input.toLocationId, input.quantity, transferId, actor.id, timestamp,
      );
      this.audit(actor, "inventory.transferred", "transfer", transferId, input);
    });
    return json({ ok: true });
  }

  private async createSupplier(request: Request) {
    const input = supplierInput.parse(await request.json());
    const actor = this.actor(request);
    const supplierId = id();
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "INSERT INTO suppliers (id, name, email, phone, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      supplierId, input.name, input.email ?? null, input.phone ?? null, input.notes ?? null, timestamp, timestamp,
    );
    this.audit(actor, "supplier.created", "supplier", supplierId, { name: input.name });
    return json({ id: supplierId }, 201);
  }

  private async createCustomer(request: Request) {
    const input = customerInput.parse(await request.json());
    const actor = this.actor(request);
    const customerId = id();
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "INSERT INTO customers (id, name, email, phone, address_json, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      customerId, input.name, input.email ?? null, input.phone ?? null, input.address ? JSON.stringify(input.address) : null, input.notes ?? null, timestamp, timestamp,
    );
    this.audit(actor, "customer.created", "customer", customerId, { name: input.name });
    return json({ id: customerId }, 201);
  }

  private listPurchaseOrders() {
    return json(this.rows(
      `SELECT po.*, s.name AS supplier_name, l.name AS location_name,
        (SELECT COUNT(*) FROM purchase_order_lines pol WHERE pol.purchase_order_id = po.id) AS line_count
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN locations l ON l.id = po.location_id
       ORDER BY po.created_at DESC`,
    ));
  }

  private getPurchaseOrder(poId: string) {
    const po = this.one(
      `SELECT po.*, s.name AS supplier_name, l.name AS location_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN locations l ON l.id = po.location_id
       WHERE po.id = ?`,
      poId,
    );
    if (!po) return error("Purchase order not found", 404);
    const lines = this.rows(
      "SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY rowid",
      poId,
    );
    return json({ ...po, lines });
  }

  private async createPurchaseOrder(request: Request) {
    const input = z.object({
      supplierId: z.string(),
      locationId: z.string(),
      notes: z.string().max(4000).optional(),
      lines: z.array(z.object({
        variantId: z.string(),
        quantity: z.number().int().positive(),
        unitCostMinor: z.number().int().nonnegative(),
        taxRateBps: z.number().int().min(0).max(10000).default(0),
      })).min(1),
    }).parse(await request.json());
    const actor = this.actor(request);
    const settings = this.settings();
    const poId = id();
    const timestamp = now();
    let number = "";
    let subtotal = 0;
    let tax = 0;
    let total = 0;

    this.ctx.storage.transactionSync(() => {
      number = this.nextNumber("purchase_order", "PO");
      this.ctx.storage.sql.exec(
        "INSERT INTO purchase_orders (id, number, supplier_id, location_id, currency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        poId, number, input.supplierId, input.locationId, settings.currency, input.notes ?? null, timestamp, timestamp,
      );
      for (const line of input.lines) {
        const variant = this.one<{ sku: string; variant_name: string; product_name: string }>(
          "SELECT v.sku, v.name AS variant_name, p.name AS product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.active = 1",
          line.variantId,
        );
        if (!variant) fail("Purchase order contains an unknown variant");
        const amounts = this.lineAmounts(line.unitCostMinor, line.quantity, line.taxRateBps, false);
        subtotal += amounts.net;
        tax += amounts.tax;
        total += amounts.gross;
        this.ctx.storage.sql.exec(
          "INSERT INTO purchase_order_lines (id, purchase_order_id, variant_id, sku_snapshot, description_snapshot, quantity_ordered, unit_cost_minor, tax_rate_bps, net_minor, tax_minor, gross_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id(), poId, line.variantId, variant.sku, `${variant.product_name} · ${variant.variant_name}`, line.quantity, line.unitCostMinor, line.taxRateBps, amounts.net, amounts.tax, amounts.gross,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE purchase_orders SET subtotal_minor = ?, tax_minor = ?, total_minor = ? WHERE id = ?",
        subtotal, tax, total, poId,
      );
      this.audit(actor, "purchase_order.created", "purchase_order", poId, { number, lines: input.lines.length });
    });
    return json({ id: poId, number }, 201);
  }

  private submitPurchaseOrder(poId: string, request: Request) {
    const actor = this.actor(request);
    const po = this.one<{ status: string }>("SELECT status FROM purchase_orders WHERE id = ?", poId);
    if (!po) return error("Purchase order not found", 404);
    if (po.status !== "draft") return error("Only draft purchase orders can be submitted", 409);
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "UPDATE purchase_orders SET status = 'ordered', ordered_at = ?, updated_at = ? WHERE id = ?",
      timestamp, timestamp, poId,
    );
    this.audit(actor, "purchase_order.submitted", "purchase_order", poId);
    return json({ ok: true });
  }

  private async receivePurchaseOrder(poId: string, request: Request) {
    const input = z.object({
      lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().positive() })).min(1),
    }).parse(await request.json());
    const actor = this.actor(request);

    this.ctx.storage.transactionSync(() => {
      const po = this.one<{ status: string; location_id: string }>(
        "SELECT status, location_id FROM purchase_orders WHERE id = ?",
        poId,
      );
      if (!po) fail("Purchase order not found", 404);
      if (!["ordered", "partially_received"].includes(po.status)) fail("Purchase order is not open for receiving", 409);
      const timestamp = now();

      for (const received of input.lines) {
        const line = this.one<{ variant_id: string; quantity_ordered: number; quantity_received: number }>(
          "SELECT variant_id, quantity_ordered, quantity_received FROM purchase_order_lines WHERE id = ? AND purchase_order_id = ?",
          received.lineId,
          poId,
        );
        if (!line) fail("Purchase order line not found", 404);
        if (line.quantity_received + received.quantity > line.quantity_ordered) fail("Received quantity exceeds quantity ordered", 409);

        this.ctx.storage.sql.exec(
          "UPDATE purchase_order_lines SET quantity_received = quantity_received + ? WHERE id = ?",
          received.quantity,
          received.lineId,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(variant_id, location_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand, updated_at = excluded.updated_at`,
          line.variant_id,
          po.location_id,
          received.quantity,
          timestamp,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, actor_id, created_at) VALUES (?, ?, ?, ?, 'purchase_receipt', 'purchase_order', ?, ?, ?)",
          id(), line.variant_id, po.location_id, received.quantity, poId, actor.id, timestamp,
        );
      }

      const remaining = this.one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM purchase_order_lines WHERE purchase_order_id = ? AND quantity_received < quantity_ordered",
        poId,
      )?.count ?? 0;
      this.ctx.storage.sql.exec(
        "UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?",
        remaining === 0 ? "received" : "partially_received",
        timestamp,
        poId,
      );
      this.audit(actor, "purchase_order.received", "purchase_order", poId, input);
    });
    return json({ ok: true });
  }

  private listOrders() {
    return json(this.rows(
      `SELECT o.*, c.name AS customer_name, l.name AS location_name,
        (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id) AS line_count
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id JOIN locations l ON l.id = o.location_id
       ORDER BY o.created_at DESC`,
    ));
  }

  private getOrder(orderId: string) {
    const order = this.one(
      `SELECT o.*, c.name AS customer_name, l.name AS location_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id JOIN locations l ON l.id = o.location_id WHERE o.id = ?`,
      orderId,
    );
    if (!order) return error("Order not found", 404);
    const lines = this.rows<{ id: string }>("SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid", orderId);
    const modifiers = this.rows("SELECT olm.* FROM order_line_modifiers olm JOIN order_lines ol ON ol.id = olm.order_line_id WHERE ol.order_id = ? ORDER BY olm.rowid", orderId);
    return json({
      ...order,
      lines: lines.map(line => ({ ...line, modifiers: modifiers.filter((modifier: Record<string, unknown>) => modifier.order_line_id === line.id) })),
    });
  }

  private async createOrder(request: Request) {
    const input = z.object({
      customerId: z.string().optional(),
      locationId: z.string(),
      notes: z.string().max(4000).optional(),
      lines: z.array(z.object({
        variantId: z.string(),
        quantity: z.number().int().positive(),
        modifiers: z.array(z.object({ modifierId: z.string(), quantity: z.number().int().positive().default(1) })).default([]),
      })).min(1),
    }).parse(await request.json());
    const actor = this.actor(request);
    const settings = this.settings();
    const orderId = id();
    const timestamp = now();
    let number = "";
    let subtotal = 0;
    let tax = 0;
    let total = 0;

    this.ctx.storage.transactionSync(() => {
      number = this.nextNumber("order", "ORD");
      this.ctx.storage.sql.exec(
        "INSERT INTO orders (id, number, customer_id, location_id, currency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        orderId, number, input.customerId ?? null, input.locationId, settings.currency, input.notes ?? null, timestamp, timestamp,
      );

      for (const line of input.lines) {
        const variant = this.one<{
          product_id: string;
          sku: string;
          variant_name: string;
          product_name: string;
          price_minor: number;
          tax_rate_bps: number;
        }>(
          "SELECT v.product_id, v.sku, v.name AS variant_name, p.name AS product_name, v.price_minor, v.tax_rate_bps FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.active = 1",
          line.variantId,
        );
        if (!variant) fail("Order contains an unknown variant");

        const lineId = id();
        const base = this.lineAmounts(variant.price_minor, line.quantity, variant.tax_rate_bps, !!settings.prices_include_tax);
        subtotal += base.net;
        tax += base.tax;
        total += base.gross;
        this.ctx.storage.sql.exec(
          "INSERT INTO order_lines (id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, quantity, unit_price_minor, tax_rate_bps, net_minor, tax_minor, gross_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          lineId, orderId, line.variantId, variant.product_name, variant.variant_name, variant.sku, line.quantity, variant.price_minor, variant.tax_rate_bps, base.net, base.tax, base.gross,
        );

        for (const selected of line.modifiers) {
          const modifier = this.one<{ id: string; name: string; price_delta_minor: number }>(
            `SELECT m.id, m.name, m.price_delta_minor FROM modifiers m
             JOIN product_modifiers pm ON pm.modifier_id = m.id
             WHERE m.id = ? AND pm.product_id = ? AND m.active = 1`,
            selected.modifierId,
            variant.product_id,
          );
          if (!modifier) fail("A selected modifier is not available for this product");
          const modifierAmounts = this.lineAmounts(
            modifier.price_delta_minor,
            line.quantity * selected.quantity,
            variant.tax_rate_bps,
            !!settings.prices_include_tax,
          );
          subtotal += modifierAmounts.net;
          tax += modifierAmounts.tax;
          total += modifierAmounts.gross;
          this.ctx.storage.sql.exec(
            "INSERT INTO order_line_modifiers (id, order_line_id, modifier_id, name_snapshot, quantity, unit_price_delta_minor, net_minor, tax_minor, gross_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id(), lineId, modifier.id, modifier.name, selected.quantity, modifier.price_delta_minor, modifierAmounts.net, modifierAmounts.tax, modifierAmounts.gross,
          );
        }
      }

      this.ctx.storage.sql.exec(
        "UPDATE orders SET subtotal_minor = ?, tax_minor = ?, total_minor = ? WHERE id = ?",
        subtotal, tax, total, orderId,
      );
      this.audit(actor, "order.created", "order", orderId, { number, lines: input.lines.length });
    });
    return json({ id: orderId, number }, 201);
  }

  private confirmOrder(orderId: string, request: Request) {
    const actor = this.actor(request);
    this.ctx.storage.transactionSync(() => {
      const order = this.one<{ status: string; location_id: string }>("SELECT status, location_id FROM orders WHERE id = ?", orderId);
      if (!order) fail("Order not found", 404);
      if (order.status !== "draft") fail("Only draft orders can be confirmed", 409);
      const lines = this.rows<{ id: string; variant_id: string; quantity: number }>(
        "SELECT id, variant_id, quantity FROM order_lines WHERE order_id = ?",
        orderId,
      );
      const timestamp = now();

      for (const line of lines) {
        const level = this.one<{ on_hand: number; reserved: number }>(
          "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?",
          line.variant_id,
          order.location_id,
        ) ?? { on_hand: 0, reserved: 0 };
        if (level.on_hand - level.reserved < line.quantity) fail(`Insufficient available stock for variant ${line.variant_id}`, 409);
        this.ctx.storage.sql.exec(
          "UPDATE inventory_levels SET reserved = reserved + ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
          line.quantity, timestamp, line.variant_id, order.location_id,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO inventory_reservations (id, order_id, order_line_id, variant_id, location_id, quantity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
          id(), orderId, line.id, line.variant_id, order.location_id, line.quantity, timestamp, timestamp,
        );
      }

      this.ctx.storage.sql.exec(
        "UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?",
        timestamp, timestamp, orderId,
      );
      this.audit(actor, "order.confirmed", "order", orderId);
    });
    return json({ ok: true });
  }

  private async fulfilOrder(orderId: string, request: Request) {
    const raw = await request.json().catch(() => ({}));
    const input = z.object({
      lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().positive() })).optional(),
    }).parse(raw);
    const actor = this.actor(request);

    this.ctx.storage.transactionSync(() => {
      const order = this.one<{ status: string; location_id: string }>("SELECT status, location_id FROM orders WHERE id = ?", orderId);
      if (!order) fail("Order not found", 404);
      if (order.status !== "confirmed") fail("Only confirmed orders can be fulfilled", 409);

      const lines = this.rows<{ id: string; variant_id: string; quantity: number; quantity_fulfilled: number }>(
        "SELECT id, variant_id, quantity, quantity_fulfilled FROM order_lines WHERE order_id = ?",
        orderId,
      );
      const requested = input.lines ? new Map(input.lines.map(line => [line.lineId, line.quantity])) : null;
      if (requested && requested.size !== input.lines!.length) fail("A fulfilment line was supplied more than once");
      if (requested && [...requested.keys()].some(lineId => !lines.some(line => line.id === lineId))) fail("Fulfilment contains an unknown order line");

      const fulfilmentId = id();
      const timestamp = now();
      let fulfilledAny = false;
      this.ctx.storage.sql.exec(
        "INSERT INTO fulfilments (id, order_id, created_at, actor_id) VALUES (?, ?, ?, ?)",
        fulfilmentId, orderId, timestamp, actor.id,
      );

      for (const line of lines) {
        const outstanding = line.quantity - line.quantity_fulfilled;
        const quantity = requested ? requested.get(line.id) ?? 0 : outstanding;
        if (quantity === 0) continue;
        if (quantity > outstanding) fail("Fulfilment exceeds outstanding order quantity", 409);

        const reservation = this.one<{ id: string; quantity: number }>(
          "SELECT id, quantity FROM inventory_reservations WHERE order_line_id = ? AND status = 'active'",
          line.id,
        );
        if (!reservation || reservation.quantity < quantity) fail("Reserved stock is no longer available", 409);
        const level = this.one<{ on_hand: number; reserved: number }>(
          "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?",
          line.variant_id,
          order.location_id,
        );
        if (!level || level.on_hand < quantity || level.reserved < quantity) fail("Reserved stock is no longer available", 409);

        this.ctx.storage.sql.exec(
          "UPDATE inventory_levels SET on_hand = on_hand - ?, reserved = reserved - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
          quantity, quantity, timestamp, line.variant_id, order.location_id,
        );
        this.ctx.storage.sql.exec("UPDATE order_lines SET quantity_fulfilled = quantity_fulfilled + ? WHERE id = ?", quantity, line.id);
        if (reservation.quantity === quantity) {
          this.ctx.storage.sql.exec("UPDATE inventory_reservations SET status = 'consumed', updated_at = ? WHERE id = ?", timestamp, reservation.id);
        } else {
          this.ctx.storage.sql.exec("UPDATE inventory_reservations SET quantity = quantity - ?, updated_at = ? WHERE id = ?", quantity, timestamp, reservation.id);
        }
        this.ctx.storage.sql.exec(
          "INSERT INTO fulfilment_lines (fulfilment_id, order_line_id, quantity) VALUES (?, ?, ?)",
          fulfilmentId, line.id, quantity,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, actor_id, created_at) VALUES (?, ?, ?, ?, 'order_fulfilment', 'order', ?, ?, ?)",
          id(), line.variant_id, order.location_id, -quantity, orderId, actor.id, timestamp,
        );
        fulfilledAny = true;
      }

      if (!fulfilledAny) fail("No outstanding quantity was selected for fulfilment");
      const remaining = this.one<{ quantity: number }>(
        "SELECT COALESCE(SUM(quantity - quantity_fulfilled), 0) AS quantity FROM order_lines WHERE order_id = ?",
        orderId,
      )?.quantity ?? 0;
      const fullyFulfilled = remaining === 0;
      this.ctx.storage.sql.exec(
        "UPDATE orders SET status = ?, fulfilment_status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
        fullyFulfilled ? "completed" : "confirmed",
        fullyFulfilled ? "fulfilled" : "partially_fulfilled",
        fullyFulfilled ? timestamp : null,
        timestamp,
        orderId,
      );
      this.audit(actor, fullyFulfilled ? "order.fulfilled" : "order.partially_fulfilled", "order", orderId, { fulfilmentId });
    });
    return json({ ok: true });
  }

  private cancelOrder(orderId: string, request: Request) {
    const actor = this.actor(request);
    this.ctx.storage.transactionSync(() => {
      const order = this.one<{ status: string }>("SELECT status FROM orders WHERE id = ?", orderId);
      if (!order) fail("Order not found", 404);
      if (!["draft", "confirmed"].includes(order.status)) fail("Order can no longer be cancelled", 409);
      const timestamp = now();
      const reservations = this.rows<{ id: string; variant_id: string; location_id: string; quantity: number }>(
        "SELECT id, variant_id, location_id, quantity FROM inventory_reservations WHERE order_id = ? AND status = 'active'",
        orderId,
      );
      for (const reservation of reservations) {
        this.ctx.storage.sql.exec(
          "UPDATE inventory_levels SET reserved = reserved - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
          reservation.quantity, timestamp, reservation.variant_id, reservation.location_id,
        );
        this.ctx.storage.sql.exec("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE id = ?", timestamp, reservation.id);
      }
      this.ctx.storage.sql.exec("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", timestamp, orderId);
      this.audit(actor, "order.cancelled", "order", orderId);
    });
    return json({ ok: true });
  }

  private async returnOrder(orderId: string, request: Request) {
    const input = z.object({
      notes: z.string().max(2000).optional(),
      lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().positive(), restock: z.boolean().default(true) })).min(1),
    }).parse(await request.json());
    const actor = this.actor(request);

    this.ctx.storage.transactionSync(() => {
      const order = this.one<{ status: string; location_id: string }>("SELECT status, location_id FROM orders WHERE id = ?", orderId);
      if (!order) fail("Order not found", 404);
      const fulfilled = this.one<{ quantity: number }>(
        "SELECT COALESCE(SUM(quantity_fulfilled), 0) AS quantity FROM order_lines WHERE order_id = ?",
        orderId,
      )?.quantity ?? 0;
      if (fulfilled === 0) fail("This order has no fulfilled items to return", 409);

      const returnId = id();
      const timestamp = now();
      this.ctx.storage.sql.exec(
        "INSERT INTO returns (id, order_id, created_at, actor_id, notes) VALUES (?, ?, ?, ?, ?)",
        returnId, orderId, timestamp, actor.id, input.notes ?? null,
      );

      for (const item of input.lines) {
        const line = this.one<{ variant_id: string; quantity_fulfilled: number; quantity_returned: number }>(
          "SELECT variant_id, quantity_fulfilled, quantity_returned FROM order_lines WHERE id = ? AND order_id = ?",
          item.lineId,
          orderId,
        );
        if (!line) fail("Order line not found", 404);
        if (line.quantity_returned + item.quantity > line.quantity_fulfilled) fail("Return exceeds fulfilled quantity", 409);

        this.ctx.storage.sql.exec("UPDATE order_lines SET quantity_returned = quantity_returned + ? WHERE id = ?", item.quantity, item.lineId);
        this.ctx.storage.sql.exec(
          "INSERT INTO return_lines (return_id, order_line_id, quantity, restocked) VALUES (?, ?, ?, ?)",
          returnId, item.lineId, item.quantity, item.restock ? 1 : 0,
        );
        if (item.restock) {
          this.ctx.storage.sql.exec(
            `INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, 0, ?)
             ON CONFLICT(variant_id, location_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand, updated_at = excluded.updated_at`,
            line.variant_id, order.location_id, item.quantity, timestamp,
          );
          this.ctx.storage.sql.exec(
            "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, actor_id, created_at) VALUES (?, ?, ?, ?, 'return_restock', 'return', ?, ?, ?)",
            id(), line.variant_id, order.location_id, item.quantity, returnId, actor.id, timestamp,
          );
        }
      }

      const totals = this.one<{ fulfilled: number; returned: number }>(
        "SELECT COALESCE(SUM(quantity_fulfilled), 0) AS fulfilled, COALESCE(SUM(quantity_returned), 0) AS returned FROM order_lines WHERE order_id = ?",
        orderId,
      )!;
      this.ctx.storage.sql.exec(
        "UPDATE orders SET fulfilment_status = ?, updated_at = ? WHERE id = ?",
        totals.returned >= totals.fulfilled ? "returned" : "partially_returned",
        timestamp,
        orderId,
      );
      this.audit(actor, "order.returned", "return", returnId, { orderId, lines: input.lines.length });
    });
    return json({ ok: true });
  }

  private async updateSettings(request: Request) {
    const input = z.object({
      businessName: z.string().trim().min(1).max(200).optional(),
      currency: z.string().trim().length(3).transform(value => value.toUpperCase()).optional(),
      pricesIncludeTax: z.boolean().optional(),
      defaultTaxRateBps: z.number().int().min(0).max(10000).optional(),
      lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
    }).parse(await request.json());
    const actor = this.actor(request);
    const current = this.one<{ business_name: string; currency: string; prices_include_tax: number; default_tax_rate_bps: number; low_stock_threshold: number }>(
      "SELECT business_name, currency, prices_include_tax, default_tax_rate_bps, low_stock_threshold FROM tenant_settings WHERE id = 1",
    )!;
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "UPDATE tenant_settings SET business_name = ?, currency = ?, prices_include_tax = ?, default_tax_rate_bps = ?, low_stock_threshold = ?, updated_at = ? WHERE id = 1",
      input.businessName ?? current.business_name,
      input.currency ?? current.currency,
      input.pricesIncludeTax === undefined ? current.prices_include_tax : input.pricesIncludeTax ? 1 : 0,
      input.defaultTaxRateBps ?? current.default_tax_rate_bps,
      input.lowStockThreshold ?? current.low_stock_threshold,
      timestamp,
    );
    this.audit(actor, "settings.updated", "tenant_settings", "1", input);
    return json({ ok: true });
  }
}
