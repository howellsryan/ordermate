import { z } from "zod";
import { buildOperatingIntelligence, type IntelligenceInput } from "../shared/operating-intelligence";
import { TenantStore as VersionedTenantStore } from "./tenant-store-versioned";
import type { TenantEnv } from "./tenant-store";

const policyInput = z.object({
  variantId: z.string().min(1),
  locationId: z.string().min(1),
  reorderPoint: z.number().int().min(0).max(1_000_000),
  targetStock: z.number().int().min(0).max(1_000_000),
  preferredSupplierId: z.string().min(1).nullable().optional(),
}).refine(input => input.targetStock >= input.reorderPoint, {
  message: "Target stock must be greater than or equal to the reorder point",
  path: ["targetStock"],
});

type PolicyRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  reorder_point: number;
  target_stock: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
  updated_at: string;
  updated_by: string;
};

type StockRow = {
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
  fulfilled_prev_60d: number;
  cost_minor: number;
  reorder_point: number | null;
  target_stock: number | null;
  preferred_supplier_id: string | null;
};

type SupplierMappingRow = {
  supplier_id: string;
  supplier_name: string;
  variant_id: string;
  supplier_sku: string | null;
  last_cost_minor: number | null;
  lead_time_days: number | null;
};

type IncomingScheduleRow = {
  variant_id: string;
  location_id: string;
  expected_delivery_date: string | null;
  quantity: number;
};

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const DAY_MS = 86_400_000;

function daysFromToday(date: string | null, fallback: number) {
  if (!date) return fallback;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expected = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(expected)) return fallback;
  return Math.max(0, Math.round((expected - todayUtc) / DAY_MS));
}

/**
 * v2 planning layer. This is intentionally separate from the v1 runtime
 * extension so new schema-backed behaviour is easy to identify and migrate.
 */
export class TenantStore extends VersionedTenantStore {
  private readonly planningCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.planningCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/dashboard") {
      return Response.json(this.dashboardV2());
    }
    if (request.method === "GET" && path === "/inventory-policies") {
      return Response.json(this.listPolicies());
    }
    if (request.method === "PUT" && path === "/inventory-policies") {
      return this.upsertPolicy(request);
    }
    const policyDelete = path.match(/^\/inventory-policies\/([^/]+)\/([^/]+)$/);
    if (request.method === "DELETE" && policyDelete) {
      return this.deletePolicy(decodeURIComponent(policyDelete[1]), decodeURIComponent(policyDelete[2]), request);
    }
    if (request.method === "GET" && path === "/replenishment") {
      return Response.json(this.planningReplenishmentSuggestions());
    }

    return super.fetch(request);
  }

  private dashboardV2() {
    const sql = this.planningCtx.storage.sql;
    const settings = sql.exec<{ currency: string; low_stock_threshold: number }>(
      "SELECT currency, low_stock_threshold FROM tenant_settings WHERE id = 1",
    ).toArray()[0] || { currency: "GBP", low_stock_threshold: 0 };
    const count = (query: string, ...bindings: unknown[]) => sql.exec<{ count: number }>(query, ...bindings).toArray()[0]?.count ?? 0;

    return {
      ordersOpen: count("SELECT COUNT(*) AS count FROM orders WHERE status IN ('draft','confirmed')"),
      ordersAwaitingFulfilment: count("SELECT COUNT(*) AS count FROM orders WHERE status = 'confirmed' AND fulfilment_status != 'fulfilled'"),
      purchaseOrdersOpen: count("SELECT COUNT(*) AS count FROM purchase_orders WHERE status IN ('draft','ordered','partially_received')"),
      lowStockVariants: count(
        `SELECT COUNT(*) AS count
         FROM inventory_levels il
         JOIN product_variants v ON v.id = il.variant_id AND v.active = 1
         JOIN products p ON p.id = v.product_id AND p.status = 'active'
         JOIN locations l ON l.id = il.location_id AND l.active = 1
         LEFT JOIN inventory_policies ip ON ip.variant_id = il.variant_id AND ip.location_id = il.location_id
         WHERE (il.on_hand - il.reserved) <= COALESCE(ip.reorder_point, ?)`,
        settings.low_stock_threshold,
      ),
      inventoryValueMinor: sql.exec<{ total: number | null }>(
        "SELECT SUM(il.on_hand * v.cost_minor) AS total FROM inventory_levels il JOIN product_variants v ON v.id = il.variant_id",
      ).toArray()[0]?.total ?? 0,
      currency: settings.currency,
    };
  }

  private listPolicies() {
    return this.planningCtx.storage.sql.exec<PolicyRow>(
      `SELECT ip.variant_id,
              p.name AS product_name,
              v.name AS variant_name,
              v.sku,
              ip.location_id,
              l.name AS location_name,
              ip.reorder_point,
              ip.target_stock,
              ip.preferred_supplier_id,
              s.name AS preferred_supplier_name,
              ip.updated_at,
              ip.updated_by
       FROM inventory_policies ip
       JOIN product_variants v ON v.id = ip.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN locations l ON l.id = ip.location_id
       LEFT JOIN suppliers s ON s.id = ip.preferred_supplier_id
       ORDER BY p.name, v.name, l.name`,
    ).toArray();
  }

  private planningActor(request: Request) {
    const id = request.headers.get("x-ordermate-actor-id") || "";
    const role = request.headers.get("x-ordermate-actor-role") || "";
    if (!id || !role) throw new Error("Missing authenticated actor context");
    return { id, role };
  }

  private auditPlanning(request: Request, action: string, entityId: string, metadata: Record<string, unknown>) {
    const actor = this.planningActor(request);
    this.planningCtx.storage.sql.exec(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'inventory_policy', ?, ?, ?)`,
      newId(), actor.id, actor.role, action, entityId, JSON.stringify(metadata), now(),
    );
  }

  private async upsertPolicy(request: Request) {
    let input: z.infer<typeof policyInput>;
    try {
      input = policyInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid replenishment policy" }, { status: 400 });
      throw cause;
    }

    const variant = this.planningCtx.storage.sql.exec<{ id: string }>(
      `SELECT v.id FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = ? AND v.active = 1 AND p.status = 'active'`,
      input.variantId,
    ).toArray()[0];
    if (!variant) return Response.json({ error: "Active product variant not found" }, { status: 404 });

    const location = this.planningCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM locations WHERE id = ? AND active = 1",
      input.locationId,
    ).toArray()[0];
    if (!location) return Response.json({ error: "Active stock location not found" }, { status: 404 });

    if (input.preferredSupplierId) {
      const mapping = this.planningCtx.storage.sql.exec<{ supplier_id: string }>(
        `SELECT sv.supplier_id
         FROM supplier_variants sv
         JOIN suppliers s ON s.id = sv.supplier_id
         WHERE sv.supplier_id = ? AND sv.variant_id = ? AND s.active = 1`,
        input.preferredSupplierId,
        input.variantId,
      ).toArray()[0];
      if (!mapping) return Response.json({ error: "Preferred supplier must be an active supplier mapped to this variant" }, { status: 409 });
    }

    const actor = this.planningActor(request);
    const updatedAt = now();
    this.planningCtx.storage.transactionSync(() => {
      this.planningCtx.storage.sql.exec(
        `INSERT INTO inventory_policies (
           variant_id, location_id, reorder_point, target_stock,
           preferred_supplier_id, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(variant_id, location_id) DO UPDATE SET
           reorder_point = excluded.reorder_point,
           target_stock = excluded.target_stock,
           preferred_supplier_id = excluded.preferred_supplier_id,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        input.variantId,
        input.locationId,
        input.reorderPoint,
        input.targetStock,
        input.preferredSupplierId || null,
        updatedAt,
        actor.id,
      );
      this.auditPlanning(request, "inventory_policy.updated", `${input.variantId}:${input.locationId}`, {
        variantId: input.variantId,
        locationId: input.locationId,
        reorderPoint: input.reorderPoint,
        targetStock: input.targetStock,
        preferredSupplierId: input.preferredSupplierId || null,
      });
    });
    return Response.json({ ok: true });
  }

  private deletePolicy(variantId: string, locationId: string, request: Request) {
    const existing = this.planningCtx.storage.sql.exec<{ variant_id: string }>(
      "SELECT variant_id FROM inventory_policies WHERE variant_id = ? AND location_id = ?",
      variantId,
      locationId,
    ).toArray()[0];
    if (!existing) return Response.json({ error: "Replenishment policy not found" }, { status: 404 });

    this.planningCtx.storage.transactionSync(() => {
      this.planningCtx.storage.sql.exec(
        "DELETE FROM inventory_policies WHERE variant_id = ? AND location_id = ?",
        variantId,
        locationId,
      );
      this.auditPlanning(request, "inventory_policy.deleted", `${variantId}:${locationId}`, { variantId, locationId });
    });
    return Response.json({ ok: true });
  }

  private planningReplenishmentSuggestions() {
    const defaultThreshold = this.planningCtx.storage.sql.exec<{ low_stock_threshold: number }>(
      "SELECT low_stock_threshold FROM tenant_settings WHERE id = 1",
    ).toArray()[0]?.low_stock_threshold ?? 0;

    const stock = this.planningCtx.storage.sql.exec<StockRow>(
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
                SUM(CASE WHEN datetime(created_at) >= datetime('now', '-30 days') AND quantity_delta < 0 THEN -quantity_delta ELSE 0 END) AS fulfilled_30d,
                SUM(CASE WHEN datetime(created_at) < datetime('now', '-30 days') AND datetime(created_at) >= datetime('now', '-90 days') AND quantity_delta < 0 THEN -quantity_delta ELSE 0 END) AS fulfilled_prev_60d
         FROM inventory_movements
         WHERE movement_type = 'order_fulfilment'
           AND datetime(created_at) >= datetime('now', '-90 days')
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
              COALESCE(d.fulfilled_30d, 0) AS fulfilled_30d,
              COALESCE(d.fulfilled_prev_60d, 0) AS fulfilled_prev_60d,
              v.cost_minor,
              ip.reorder_point,
              ip.target_stock,
              ip.preferred_supplier_id
       FROM pairs
       JOIN product_variants v ON v.id = pairs.variant_id AND v.active = 1
       JOIN products p ON p.id = v.product_id AND p.status = 'active'
       JOIN locations l ON l.id = pairs.location_id AND l.active = 1
       LEFT JOIN inventory_levels il ON il.variant_id = pairs.variant_id AND il.location_id = pairs.location_id
       LEFT JOIN incoming inc ON inc.variant_id = pairs.variant_id AND inc.location_id = pairs.location_id
       LEFT JOIN demand d ON d.variant_id = pairs.variant_id AND d.location_id = pairs.location_id
       LEFT JOIN inventory_policies ip ON ip.variant_id = pairs.variant_id AND ip.location_id = pairs.location_id`,
    ).toArray();

    const mappings = this.planningCtx.storage.sql.exec<SupplierMappingRow>(
      `SELECT sv.supplier_id,
              s.name AS supplier_name,
              sv.variant_id,
              sv.supplier_sku,
              sv.last_cost_minor,
              sv.lead_time_days
       FROM supplier_variants sv
       JOIN suppliers s ON s.id = sv.supplier_id AND s.active = 1
       JOIN product_variants v ON v.id = sv.variant_id AND v.active = 1
       JOIN products p ON p.id = v.product_id AND p.status = 'active'`,
    ).toArray();

    const incomingSchedule = this.planningCtx.storage.sql.exec<IncomingScheduleRow>(
      `SELECT pol.variant_id,
              po.location_id,
              po.expected_delivery_date,
              SUM(pol.quantity_ordered - pol.quantity_received) AS quantity
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
       WHERE po.status IN ('ordered','partially_received')
         AND pol.quantity_ordered > pol.quantity_received
       GROUP BY pol.variant_id, po.location_id, po.expected_delivery_date`,
    ).toArray();

    const inputs: IntelligenceInput[] = stock.map(row => {
      const preferredSupplierId = row.preferred_supplier_id;
      const suppliers = mappings.filter(mapping => mapping.variant_id === row.variant_id).map(mapping => ({
        supplierId: mapping.supplier_id,
        supplierName: mapping.supplier_name,
        supplierSku: mapping.supplier_sku,
        lastCostMinor: mapping.last_cost_minor,
        leadTimeDays: mapping.lead_time_days,
        preferred: mapping.supplier_id === preferredSupplierId,
      }));
      suppliers.sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.supplierName.localeCompare(b.supplierName));

      const preferred = suppliers.find(supplier => supplier.preferred);
      const knownLeadTimes = suppliers.map(supplier => supplier.leadTimeDays).filter((days): days is number => days !== null && days >= 0);
      const effectiveLeadTimeDays = preferred
        ? preferred.leadTimeDays ?? 7
        : knownLeadTimes.length ? Math.min(...knownLeadTimes) : 7;
      const recentDailyDemand = row.fulfilled_30d / 30;
      const reorderPoint = row.reorder_point ?? defaultThreshold;
      const targetStock = row.target_stock ?? Math.max(
        reorderPoint * 2,
        Math.ceil(recentDailyDemand * 14) + reorderPoint,
      );
      const schedule = incomingSchedule
        .filter(item => item.variant_id === row.variant_id && item.location_id === row.location_id)
        .map(item => ({ daysFromNow: daysFromToday(item.expected_delivery_date, effectiveLeadTimeDays), quantity: item.quantity }))
        .sort((a, b) => a.daysFromNow - b.daysFromNow);

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
        incoming_schedule: schedule,
        fulfilled_30d: row.fulfilled_30d,
        fulfilled_prev_60d: row.fulfilled_prev_60d,
        cost_minor: row.cost_minor,
        threshold: reorderPoint,
        target_stock: targetStock,
        policy_custom: row.reorder_point !== null,
        preferred_supplier_id: preferredSupplierId,
        effective_lead_time_days: effectiveLeadTimeDays,
        suppliers,
      };
    });

    return buildOperatingIntelligence(inputs, { defaultThreshold });
  }
}
