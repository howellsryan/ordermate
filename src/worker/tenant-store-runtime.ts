import { z } from "zod";
import { TenantStore as CoreTenantStore, type TenantEnv } from "./tenant-store";

type MovementRow = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  location_id: string;
  location_name: string;
  quantity_delta: number;
  movement_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  actor_id: string;
  created_at: string;
};

type SupplierVariantRow = {
  supplier_id: string;
  supplier_name: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  supplier_sku: string | null;
  last_cost_minor: number | null;
  lead_time_days: number | null;
};

type ReplenishmentStockRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  fulfilled_30d: number;
};

type TrackedInventoryRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  location_id: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
  tracked: number;
};

const productUpdateInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().trim().max(120).optional(),
  variants: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    sku: z.string().trim().min(1).max(100),
    barcode: z.string().trim().max(100).optional(),
    priceMinor: z.number().int().nonnegative(),
    costMinor: z.number().int().nonnegative(),
    taxRateBps: z.number().int().min(0).max(10000),
  })).min(1),
});

const supplierVariantInput = z.object({
  supplierId: z.string().min(1),
  variantId: z.string().min(1),
  supplierSku: z.string().trim().max(120).optional(),
  lastCostMinor: z.number().int().nonnegative().optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
});

const contactUpdateInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().trim().max(80).optional(),
  notes: z.string().max(4000).optional(),
});

const productStatusInput = z.object({ status: z.enum(["active", "archived"]) });
const timestamp = () => new Date().toISOString();

/**
 * Runtime extensions for the v1 TenantStore.
 *
 * The exported class name remains `TenantStore`, so this is a code update to
 * the existing Durable Object class/namespace rather than a class lifecycle
 * change. It reads the existing v1 schema and does not migrate or duplicate data.
 */
export class TenantStore extends CoreTenantStore {
  private readonly runtimeCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.runtimeCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/inventory") {
      return Response.json(this.listInventoryWithTracking());
    }

    if (request.method === "GET" && path === "/inventory/movements") {
      const movements = this.runtimeCtx.storage.sql.exec<MovementRow>(
        `SELECT im.id,
                im.variant_id,
                p.name AS product_name,
                v.name AS variant_name,
                v.sku,
                v.barcode,
                im.location_id,
                l.name AS location_name,
                im.quantity_delta,
                im.movement_type,
                im.reference_type,
                im.reference_id,
                im.reason,
                im.actor_id,
                im.created_at
         FROM inventory_movements im
         JOIN product_variants v ON v.id = im.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN locations l ON l.id = im.location_id
         ORDER BY im.created_at DESC, im.rowid DESC
         LIMIT 250`,
      ).toArray();
      return Response.json(movements);
    }

    if (request.method === "GET" && path === "/supplier-variants") {
      return Response.json(this.listSupplierVariants());
    }

    if (request.method === "POST" && path === "/supplier-variants") {
      return this.upsertSupplierVariant(request);
    }

    const supplierVariantDelete = path.match(/^\/supplier-variants\/([^/]+)\/([^/]+)$/);
    if (request.method === "DELETE" && supplierVariantDelete) {
      return this.deleteSupplierVariant(
        decodeURIComponent(supplierVariantDelete[1]),
        decodeURIComponent(supplierVariantDelete[2]),
        request,
      );
    }

    if (request.method === "GET" && path === "/replenishment") {
      return Response.json(this.replenishmentSuggestions());
    }

    const productStatus = path.match(/^\/products\/([^/]+)\/status$/);
    if (request.method === "PATCH" && productStatus) {
      return this.updateProductStatus(decodeURIComponent(productStatus[1]), request);
    }

    if (request.method === "PATCH" && /^\/products\/[^/]+$/.test(path)) {
      return this.updateProduct(decodeURIComponent(path.split("/")[2]), request);
    }

    const supplierUpdate = path.match(/^\/suppliers\/([^/]+)$/);
    if (request.method === "PATCH" && supplierUpdate) {
      return this.updateContact("supplier", decodeURIComponent(supplierUpdate[1]), request);
    }

    const customerUpdate = path.match(/^\/customers\/([^/]+)$/);
    if (request.method === "PATCH" && customerUpdate) {
      return this.updateContact("customer", decodeURIComponent(customerUpdate[1]), request);
    }

    const cancelPurchaseOrder = path.match(/^\/purchase-orders\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelPurchaseOrder) {
      return this.cancelPurchaseOrder(decodeURIComponent(cancelPurchaseOrder[1]), request);
    }

    return super.fetch(request);
  }

  private listInventoryWithTracking() {
    return this.runtimeCtx.storage.sql.exec<TrackedInventoryRow>(
      `WITH incoming AS (
         SELECT pol.variant_id,
                po.location_id,
                SUM(pol.quantity_ordered - pol.quantity_received) AS quantity
         FROM purchase_order_lines pol
         JOIN purchase_orders po ON po.id = pol.purchase_order_id
         WHERE po.status IN ('ordered','partially_received')
         GROUP BY pol.variant_id, po.location_id
       )
       SELECT v.id AS variant_id,
              p.name AS product_name,
              v.name AS variant_name,
              v.sku,
              v.barcode,
              l.id AS location_id,
              l.name AS location_name,
              COALESCE(il.on_hand, 0) AS on_hand,
              COALESCE(il.reserved, 0) AS reserved,
              COALESCE(il.on_hand, 0) - COALESCE(il.reserved, 0) AS available,
              COALESCE(inc.quantity, 0) AS incoming,
              CASE WHEN il.variant_id IS NOT NULL OR inc.quantity IS NOT NULL THEN 1 ELSE 0 END AS tracked
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       CROSS JOIN locations l
       LEFT JOIN inventory_levels il ON il.variant_id = v.id AND il.location_id = l.id
       LEFT JOIN incoming inc ON inc.variant_id = v.id AND inc.location_id = l.id
       WHERE l.active = 1 AND (v.active = 1 OR il.variant_id IS NOT NULL OR inc.quantity IS NOT NULL)
       ORDER BY p.name, v.name, l.name`,
    ).toArray();
  }

  private listSupplierVariants() {
    return this.runtimeCtx.storage.sql.exec<SupplierVariantRow>(
      `SELECT sv.supplier_id,
              s.name AS supplier_name,
              sv.variant_id,
              p.name AS product_name,
              v.name AS variant_name,
              v.sku,
              v.barcode,
              sv.supplier_sku,
              sv.last_cost_minor,
              sv.lead_time_days
       FROM supplier_variants sv
       JOIN suppliers s ON s.id = sv.supplier_id
       JOIN product_variants v ON v.id = sv.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE s.active = 1 AND v.active = 1
       ORDER BY s.name, p.name, v.name`,
    ).toArray();
  }

  private async upsertSupplierVariant(request: Request) {
    let input: z.infer<typeof supplierVariantInput>;
    try {
      input = supplierVariantInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid supplier mapping" }, { status: 400 });
      throw cause;
    }

    const supplier = this.runtimeCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM suppliers WHERE id = ? AND active = 1",
      input.supplierId,
    ).toArray()[0];
    if (!supplier) return Response.json({ error: "Supplier not found" }, { status: 404 });

    const variant = this.runtimeCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM product_variants WHERE id = ? AND active = 1",
      input.variantId,
    ).toArray()[0];
    if (!variant) return Response.json({ error: "Product variant not found" }, { status: 404 });

    this.runtimeCtx.storage.transactionSync(() => {
      this.runtimeCtx.storage.sql.exec(
        `INSERT INTO supplier_variants (supplier_id, variant_id, supplier_sku, last_cost_minor, lead_time_days)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(supplier_id, variant_id) DO UPDATE SET
           supplier_sku = excluded.supplier_sku,
           last_cost_minor = excluded.last_cost_minor,
           lead_time_days = excluded.lead_time_days`,
        input.supplierId,
        input.variantId,
        input.supplierSku?.trim() || null,
        input.lastCostMinor ?? null,
        input.leadTimeDays ?? null,
      );
      this.auditRuntime(request, "supplier_variant.updated", "supplier_variant", `${input.supplierId}:${input.variantId}`, {
        supplierId: input.supplierId,
        variantId: input.variantId,
      });
    });

    return Response.json({ ok: true });
  }

  private deleteSupplierVariant(supplierId: string, variantId: string, request: Request) {
    const existing = this.runtimeCtx.storage.sql.exec<{ supplier_id: string }>(
      "SELECT supplier_id FROM supplier_variants WHERE supplier_id = ? AND variant_id = ?",
      supplierId,
      variantId,
    ).toArray()[0];
    if (!existing) return Response.json({ error: "Supplier mapping not found" }, { status: 404 });

    this.runtimeCtx.storage.transactionSync(() => {
      this.runtimeCtx.storage.sql.exec(
        "DELETE FROM supplier_variants WHERE supplier_id = ? AND variant_id = ?",
        supplierId,
        variantId,
      );
      this.auditRuntime(request, "supplier_variant.deleted", "supplier_variant", `${supplierId}:${variantId}`, { supplierId, variantId });
    });
    return Response.json({ ok: true });
  }

  private replenishmentSuggestions() {
    const threshold = this.runtimeCtx.storage.sql.exec<{ low_stock_threshold: number }>(
      "SELECT low_stock_threshold FROM tenant_settings WHERE id = 1",
    ).toArray()[0]?.low_stock_threshold ?? 0;

    const stock = this.runtimeCtx.storage.sql.exec<ReplenishmentStockRow>(
      `WITH incoming AS (
         SELECT pol.variant_id,
                po.location_id,
                SUM(pol.quantity_ordered - pol.quantity_received) AS quantity
         FROM purchase_order_lines pol
         JOIN purchase_orders po ON po.id = pol.purchase_order_id
         WHERE po.status IN ('ordered','partially_received')
         GROUP BY pol.variant_id, po.location_id
       ),
       pairs AS (
         SELECT variant_id, location_id FROM inventory_levels
         UNION
         SELECT variant_id, location_id FROM incoming
       ),
       demand AS (
         SELECT variant_id,
                location_id,
                SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END) AS fulfilled_30d
         FROM inventory_movements
         WHERE movement_type = 'order_fulfilment'
           AND datetime(created_at) >= datetime('now', '-30 days')
         GROUP BY variant_id, location_id
       )
       SELECT pairs.variant_id,
              p.name AS product_name,
              v.name AS variant_name,
              v.sku,
              pairs.location_id,
              l.name AS location_name,
              COALESCE(il.on_hand, 0) AS on_hand,
              COALESCE(il.reserved, 0) AS reserved,
              COALESCE(il.on_hand, 0) - COALESCE(il.reserved, 0) AS available,
              COALESCE(inc.quantity, 0) AS incoming,
              COALESCE(d.fulfilled_30d, 0) AS fulfilled_30d
       FROM pairs
       JOIN product_variants v ON v.id = pairs.variant_id AND v.active = 1
       JOIN products p ON p.id = v.product_id
       JOIN locations l ON l.id = pairs.location_id AND l.active = 1
       LEFT JOIN inventory_levels il ON il.variant_id = pairs.variant_id AND il.location_id = pairs.location_id
       LEFT JOIN incoming inc ON inc.variant_id = pairs.variant_id AND inc.location_id = pairs.location_id
       LEFT JOIN demand d ON d.variant_id = pairs.variant_id AND d.location_id = pairs.location_id`,
    ).toArray();

    const mappings = this.listSupplierVariants();
    const suggestions = stock.flatMap(row => {
      const suppliers = mappings.filter(mapping => mapping.variant_id === row.variant_id).map(mapping => ({
        supplierId: mapping.supplier_id,
        supplierName: mapping.supplier_name,
        supplierSku: mapping.supplier_sku,
        lastCostMinor: mapping.last_cost_minor,
        leadTimeDays: mapping.lead_time_days,
      }));
      const knownLeadTimes = suppliers.map(supplier => supplier.leadTimeDays).filter((days): days is number => days !== null && days >= 0);
      const effectiveLeadTimeDays = knownLeadTimes.length ? Math.min(...knownLeadTimes) : 7;
      const averageDailyDemand = row.fulfilled_30d / 30;
      const leadTimeDemand = Math.ceil(averageDailyDemand * effectiveLeadTimeDays);
      const projectedAtLeadTime = row.available + row.incoming - leadTimeDemand;
      const targetStock = Math.max(
        threshold * 2,
        Math.ceil(averageDailyDemand * (effectiveLeadTimeDays + 14)) + threshold,
      );
      const recommendedQuantity = Math.max(0, targetStock - (row.available + row.incoming));
      if (projectedAtLeadTime > threshold || recommendedQuantity <= 0) return [];

      return [{
        id: `${row.variant_id}:${row.location_id}`,
        ...row,
        threshold,
        average_daily_demand: Number(averageDailyDemand.toFixed(2)),
        effective_lead_time_days: effectiveLeadTimeDays,
        projected_at_lead_time: projectedAtLeadTime,
        recommended_quantity: recommendedQuantity,
        suppliers,
      }];
    });

    suggestions.sort((a, b) => a.projected_at_lead_time - b.projected_at_lead_time || b.recommended_quantity - a.recommended_quantity || a.product_name.localeCompare(b.product_name));
    return { generated_at: timestamp(), window_days: 30, suggestions: suggestions.slice(0, 100) };
  }

  private auditRuntime(request: Request, action: string, entityType: string, entityId: string, metadata?: unknown) {
    this.runtimeCtx.storage.sql.exec(
      "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      request.headers.get("x-ordermate-actor-id") || "system",
      request.headers.get("x-ordermate-actor-role") || "unknown",
      action,
      entityType,
      entityId,
      metadata ? JSON.stringify(metadata) : null,
      timestamp(),
    );
  }

  private async updateProductStatus(productId: string, request: Request) {
    let input: z.infer<typeof productStatusInput>;
    try {
      input = productStatusInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid product status" }, { status: 400 });
      throw cause;
    }

    const product = this.runtimeCtx.storage.sql.exec<{ id: string; status: string }>(
      "SELECT id, status FROM products WHERE id = ?",
      productId,
    ).toArray()[0];
    if (!product) return Response.json({ error: "Product not found" }, { status: 404 });
    if (product.status === input.status) return Response.json({ ok: true, status: input.status });

    const updatedAt = timestamp();
    this.runtimeCtx.storage.transactionSync(() => {
      this.runtimeCtx.storage.sql.exec(
        "UPDATE products SET status = ?, updated_at = ? WHERE id = ?",
        input.status,
        updatedAt,
        productId,
      );
      this.runtimeCtx.storage.sql.exec(
        "UPDATE product_variants SET active = ?, updated_at = ? WHERE product_id = ?",
        input.status === "active" ? 1 : 0,
        updatedAt,
        productId,
      );
      this.auditRuntime(request, input.status === "active" ? "product.restored" : "product.archived", "product", productId, { previousStatus: product.status });
    });
    return Response.json({ ok: true, status: input.status });
  }

  private async updateProduct(productId: string, request: Request) {
    let input: z.infer<typeof productUpdateInput>;
    try {
      input = productUpdateInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid product update" }, { status: 400 });
      throw cause;
    }

    const actorId = request.headers.get("x-ordermate-actor-id") || "system";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "unknown";
    const updatedAt = timestamp();

    try {
      this.runtimeCtx.storage.transactionSync(() => {
        const product = this.runtimeCtx.storage.sql.exec<{ id: string }>("SELECT id FROM products WHERE id = ?", productId).toArray()[0];
        if (!product) throw new Error("PRODUCT_NOT_FOUND");

        let categoryId: string | null = null;
        const category = input.category?.trim();
        if (category) {
          const existing = this.runtimeCtx.storage.sql.exec<{ id: string }>("SELECT id FROM categories WHERE name = ? COLLATE NOCASE", category).toArray()[0];
          categoryId = existing?.id || crypto.randomUUID();
          if (!existing) {
            this.runtimeCtx.storage.sql.exec("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", categoryId, category, updatedAt);
          }
        }

        for (const variant of input.variants) {
          const owned = this.runtimeCtx.storage.sql.exec<{ id: string }>(
            "SELECT id FROM product_variants WHERE id = ? AND product_id = ?",
            variant.id,
            productId,
          ).toArray()[0];
          if (!owned) throw new Error("VARIANT_NOT_FOUND");
        }

        this.runtimeCtx.storage.sql.exec(
          "UPDATE products SET name = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ?",
          input.name,
          input.description?.trim() || null,
          categoryId,
          updatedAt,
          productId,
        );

        for (const variant of input.variants) {
          this.runtimeCtx.storage.sql.exec(
            `UPDATE product_variants
             SET name = ?, sku = ?, barcode = ?, price_minor = ?, cost_minor = ?, tax_rate_bps = ?, updated_at = ?
             WHERE id = ? AND product_id = ?`,
            variant.name,
            variant.sku,
            variant.barcode?.trim() || null,
            variant.priceMinor,
            variant.costMinor,
            variant.taxRateBps,
            updatedAt,
            variant.id,
            productId,
          );
        }

        this.runtimeCtx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'product.updated', 'product', ?, ?, ?)",
          crypto.randomUUID(),
          actorId,
          actorRole,
          productId,
          JSON.stringify({ name: input.name, variants: input.variants.length }),
          updatedAt,
        );
      });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "PRODUCT_NOT_FOUND") return Response.json({ error: "Product not found" }, { status: 404 });
      if (cause instanceof Error && cause.message === "VARIANT_NOT_FOUND") return Response.json({ error: "Product update contains an unknown variant" }, { status: 400 });
      if (cause instanceof Error && cause.message.includes("UNIQUE constraint failed")) return Response.json({ error: "SKU and barcode values must be unique inside this business" }, { status: 409 });
      console.error("TenantStore product update failed", cause instanceof Error ? cause.message : "unknown error");
      return Response.json({ error: "Could not update product" }, { status: 500 });
    }

    return Response.json({ ok: true });
  }

  private async updateContact(kind: "supplier" | "customer", recordId: string, request: Request) {
    let input: z.infer<typeof contactUpdateInput>;
    try {
      input = contactUpdateInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || `Invalid ${kind} update` }, { status: 400 });
      throw cause;
    }

    const table = kind === "supplier" ? "suppliers" : "customers";
    const existing = this.runtimeCtx.storage.sql.exec<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, recordId).toArray()[0];
    if (!existing) return Response.json({ error: `${kind === "supplier" ? "Supplier" : "Customer"} not found` }, { status: 404 });

    const updatedAt = timestamp();
    this.runtimeCtx.storage.transactionSync(() => {
      this.runtimeCtx.storage.sql.exec(
        `UPDATE ${table} SET name = ?, email = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?`,
        input.name,
        input.email?.trim() || null,
        input.phone?.trim() || null,
        input.notes?.trim() || null,
        updatedAt,
        recordId,
      );
      this.auditRuntime(request, `${kind}.updated`, kind, recordId, { name: input.name });
    });
    return Response.json({ ok: true });
  }

  private cancelPurchaseOrder(purchaseOrderId: string, request: Request) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "system";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "unknown";
    const updatedAt = timestamp();

    try {
      this.runtimeCtx.storage.transactionSync(() => {
        const purchaseOrder = this.runtimeCtx.storage.sql.exec<{ status: string }>(
          "SELECT status FROM purchase_orders WHERE id = ?",
          purchaseOrderId,
        ).toArray()[0];
        if (!purchaseOrder) throw new Error("PURCHASE_ORDER_NOT_FOUND");
        if (purchaseOrder.status === "cancelled") return;
        if (purchaseOrder.status === "received") throw new Error("PURCHASE_ORDER_ALREADY_RECEIVED");

        this.runtimeCtx.storage.sql.exec(
          "UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?",
          updatedAt,
          purchaseOrderId,
        );
        this.runtimeCtx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'purchase_order.cancelled', 'purchase_order', ?, ?, ?)",
          crypto.randomUUID(),
          actorId,
          actorRole,
          purchaseOrderId,
          JSON.stringify({ previousStatus: purchaseOrder.status }),
          updatedAt,
        );
      });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "PURCHASE_ORDER_NOT_FOUND") return Response.json({ error: "Purchase order not found" }, { status: 404 });
      if (cause instanceof Error && cause.message === "PURCHASE_ORDER_ALREADY_RECEIVED") return Response.json({ error: "A fully received purchase order cannot be cancelled" }, { status: 409 });
      console.error("TenantStore purchase-order cancellation failed", cause instanceof Error ? cause.message : "unknown error");
      return Response.json({ error: "Could not cancel purchase order" }, { status: 500 });
    }

    return Response.json({ ok: true });
  }
}
