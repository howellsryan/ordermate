import { z } from "zod";
import type { StocktakeResponse } from "../shared/stocktake";
import { TenantStore as ImportTenantStore } from "./tenant-store-imports";
import type { TenantEnv } from "./tenant-store";

type SupplierSkuRow = {
  variant_id: string;
  supplier_sku: string | null;
  product_name: string;
  variant_name: string;
  sku: string;
};

type SupplierVariantBody = {
  supplierId?: unknown;
  variantId?: unknown;
  supplierSku?: unknown;
};

type StocktakeCurrentRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  on_hand: number | null;
  reserved: number | null;
  tracked: number;
};

type PurchaseOrderDueRow = {
  status: string;
  ordered_at: string | null;
  expected_delivery_date: string | null;
  line_count: number;
  mapped_lead_time_count: number;
  lead_time_days: number | null;
};

const stocktakeInput = z.object({
  locationId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    variantId: z.string().min(1),
    expectedOnHand: z.number().int().min(0).max(1_000_000),
    expectedReserved: z.number().int().min(0).max(1_000_000),
    countedOnHand: z.number().int().min(0).max(1_000_000),
  })).min(1).max(500),
});

const expectedDeliveryInput = z.object({
  expectedDeliveryDate: z.union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
});

function normalizeSupplierSku(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function isRealIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addUtcDays(isoTimestamp: string, days: number) {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Final canonical runtime guards and reviewed operational batch mutations.
 *
 * - Supplier SKU matching is only deterministic when one supplier's code maps
 *   to one Operating Layer variant.
 * - Cycle counts compare against the stock position the operator reviewed and
 *   commit all accepted variances in one SQLite transaction.
 * - Purchase-order submission snapshots a reviewable expected delivery date.
 */
export class TenantStore extends ImportTenantStore {
  private readonly finalCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.finalCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "POST" && path === "/inventory/stocktake") {
      return this.commitStocktake(request);
    }

    const expectedDelivery = path.match(/^\/purchase-orders\/([^/]+)\/expected-delivery$/);
    if (request.method === "PATCH" && expectedDelivery) {
      return this.updateExpectedDeliveryDate(decodeURIComponent(expectedDelivery[1]), request);
    }

    const submitPurchaseOrder = path.match(/^\/purchase-orders\/([^/]+)\/submit$/);
    if (request.method === "POST" && submitPurchaseOrder) {
      return this.submitPurchaseOrderWithDueDate(decodeURIComponent(submitPurchaseOrder[1]), request);
    }

    if (request.method === "POST" && path === "/supplier-variants") {
      const body = await request.clone().json().catch(() => null) as SupplierVariantBody | null;
      const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
      const variantId = typeof body?.variantId === "string" ? body.variantId : "";
      const supplierSku = typeof body?.supplierSku === "string" ? body.supplierSku.trim() : "";

      if (supplierId && variantId && supplierSku) {
        const normalized = normalizeSupplierSku(supplierSku);
        const mappings = this.finalCtx.storage.sql.exec<SupplierSkuRow>(
          `SELECT sv.variant_id,
                  sv.supplier_sku,
                  p.name AS product_name,
                  v.name AS variant_name,
                  v.sku
           FROM supplier_variants sv
           JOIN product_variants v ON v.id = sv.variant_id
           JOIN products p ON p.id = v.product_id
           WHERE sv.supplier_id = ?
             AND sv.variant_id != ?
             AND sv.supplier_sku IS NOT NULL`,
          supplierId,
          variantId,
        ).toArray();
        const conflict = mappings.find(mapping => normalizeSupplierSku(mapping.supplier_sku || "") === normalized);
        if (conflict) {
          return Response.json({
            error: `Supplier SKU ${supplierSku} is already mapped to ${conflict.product_name} · ${conflict.variant_name} (${conflict.sku})`,
          }, { status: 409 });
        }
      }
    }

    return super.fetch(request);
  }

  private auditFinal(request: Request, action: string, entityType: string, entityId: string, metadata?: unknown) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "system";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "unknown";
    this.finalCtx.storage.sql.exec(
      "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id(), actorId, actorRole, action, entityType, entityId, metadata === undefined ? null : JSON.stringify(metadata), now(),
    );
  }

  private purchaseOrderDueRow(poId: string) {
    return this.finalCtx.storage.sql.exec<PurchaseOrderDueRow>(
      `SELECT po.status,
              po.ordered_at,
              po.expected_delivery_date,
              COUNT(pol.id) AS line_count,
              COUNT(sv.lead_time_days) AS mapped_lead_time_count,
              MAX(sv.lead_time_days) AS lead_time_days
       FROM purchase_orders po
       LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
       LEFT JOIN supplier_variants sv ON sv.supplier_id = po.supplier_id AND sv.variant_id = pol.variant_id
       WHERE po.id = ?
       GROUP BY po.id`,
      poId,
    ).toArray()[0];
  }

  private submitPurchaseOrderWithDueDate(poId: string, request: Request) {
    const current = this.purchaseOrderDueRow(poId);
    if (!current) return Response.json({ error: "Purchase order not found" }, { status: 404 });
    if (current.status !== "draft") return Response.json({ error: "Only draft purchase orders can be submitted" }, { status: 409 });

    const timestamp = now();
    const hasCompleteLeadTime = current.line_count > 0
      && current.mapped_lead_time_count === current.line_count
      && current.lead_time_days != null;
    const derivedDate = hasCompleteLeadTime ? addUtcDays(timestamp, Math.max(0, current.lead_time_days!)) : null;
    const expectedDeliveryDate = current.expected_delivery_date || derivedDate;

    this.finalCtx.storage.transactionSync(() => {
      this.finalCtx.storage.sql.exec(
        "UPDATE purchase_orders SET status = 'ordered', ordered_at = ?, expected_delivery_date = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
        timestamp,
        expectedDeliveryDate,
        timestamp,
        poId,
      );
      this.auditFinal(request, "purchase_order.submitted", "purchase_order", poId, {
        expectedDeliveryDate,
        expectedDeliverySource: current.expected_delivery_date ? "manual" : derivedDate ? "supplier_lead_time" : "unknown",
        leadTimeDays: derivedDate ? current.lead_time_days : null,
      });
    });

    return Response.json({ ok: true, expectedDeliveryDate });
  }

  private async updateExpectedDeliveryDate(poId: string, request: Request) {
    let input: z.infer<typeof expectedDeliveryInput>;
    try {
      input = expectedDeliveryInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: "Expected delivery date must use YYYY-MM-DD" }, { status: 400 });
      throw cause;
    }
    if (input.expectedDeliveryDate && !isRealIsoDate(input.expectedDeliveryDate)) {
      return Response.json({ error: "Expected delivery date is not a valid calendar date" }, { status: 400 });
    }

    const existing = this.finalCtx.storage.sql.exec<{ status: string; expected_delivery_date: string | null }>(
      "SELECT status, expected_delivery_date FROM purchase_orders WHERE id = ?",
      poId,
    ).toArray()[0];
    if (!existing) return Response.json({ error: "Purchase order not found" }, { status: 404 });
    if (existing.status === "received" || existing.status === "cancelled") {
      return Response.json({ error: "Expected delivery cannot be changed on a closed purchase order" }, { status: 409 });
    }

    const timestamp = now();
    this.finalCtx.storage.transactionSync(() => {
      this.finalCtx.storage.sql.exec(
        "UPDATE purchase_orders SET expected_delivery_date = ?, updated_at = ? WHERE id = ?",
        input.expectedDeliveryDate,
        timestamp,
        poId,
      );
      this.auditFinal(request, "purchase_order.expected_delivery_updated", "purchase_order", poId, {
        from: existing.expected_delivery_date,
        to: input.expectedDeliveryDate,
      });
    });
    return Response.json({ ok: true, expectedDeliveryDate: input.expectedDeliveryDate });
  }

  private async commitStocktake(request: Request) {
    let input: z.infer<typeof stocktakeInput>;
    try {
      input = stocktakeInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid cycle count" }, { status: 400 });
      throw cause;
    }

    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    const seen = new Set<string>();
    for (const line of input.lines) {
      if (seen.has(line.variantId)) return Response.json({ error: "A variant can only appear once in a cycle count" }, { status: 400 });
      seen.add(line.variantId);
    }

    const sql = this.finalCtx.storage.sql;
    const location = sql.exec<{ id: string; name: string }>(
      "SELECT id, name FROM locations WHERE id = ? AND active = 1",
      input.locationId,
    ).toArray()[0];
    if (!location) return Response.json({ error: "Active stock location not found" }, { status: 404 });

    const placeholders = input.lines.map(() => "?").join(", ");
    const currentRows = sql.exec<StocktakeCurrentRow>(
      `SELECT v.id AS variant_id,
              p.name AS product_name,
              v.name AS variant_name,
              v.sku,
              il.on_hand,
              il.reserved,
              CASE WHEN il.variant_id IS NULL THEN 0 ELSE 1 END AS tracked
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory_levels il ON il.variant_id = v.id AND il.location_id = ?
       WHERE v.id IN (${placeholders})`,
      input.locationId,
      ...input.lines.map(line => line.variantId),
    ).toArray();
    const currentByVariant = new Map(currentRows.map(row => [row.variant_id, row]));

    for (const line of input.lines) {
      const current = currentByVariant.get(line.variantId);
      if (!current) return Response.json({ error: `Product variant ${line.variantId} no longer exists` }, { status: 404 });
      const onHand = current.on_hand ?? 0;
      const reserved = current.reserved ?? 0;
      if (onHand !== line.expectedOnHand || reserved !== line.expectedReserved) {
        return Response.json({
          error: `Stock changed while you were counting ${current.product_name} · ${current.variant_name} (${current.sku}). Expected ${line.expectedOnHand} on hand / ${line.expectedReserved} reserved; it is now ${onHand} on hand / ${reserved} reserved. Refresh the location and review the count before committing.`,
        }, { status: 409 });
      }
      if (line.countedOnHand < reserved) {
        return Response.json({
          error: `${current.product_name} · ${current.variant_name} (${current.sku}) has ${reserved} reserved units, so on-hand stock cannot be counted below ${reserved}. Resolve the outstanding reservations before applying this variance.`,
        }, { status: 409 });
      }
    }

    const stocktakeId = id();
    const timestamp = now();
    let changedLines = 0;
    let totalVariance = 0;

    this.finalCtx.storage.transactionSync(() => {
      for (const line of input.lines) {
        const current = currentByVariant.get(line.variantId)!;
        const onHand = current.on_hand ?? 0;
        const reserved = current.reserved ?? 0;
        const variance = line.countedOnHand - onHand;

        if (current.tracked) {
          this.finalCtx.storage.sql.exec(
            "UPDATE inventory_levels SET on_hand = ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
            line.countedOnHand,
            timestamp,
            line.variantId,
            input.locationId,
          );
        } else {
          this.finalCtx.storage.sql.exec(
            "INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, 0, ?)",
            line.variantId,
            input.locationId,
            line.countedOnHand,
            timestamp,
          );
        }

        if (variance !== 0) {
          changedLines += 1;
          totalVariance += variance;
          this.finalCtx.storage.sql.exec(
            `INSERT INTO inventory_movements (
               id, variant_id, location_id, quantity_delta, movement_type,
               reference_type, reference_id, reason, actor_id, created_at
             ) VALUES (?, ?, ?, ?, 'stocktake', 'stocktake', ?, ?, ?, ?)`,
            id(),
            line.variantId,
            input.locationId,
            variance,
            stocktakeId,
            input.reason?.trim() || "Cycle count variance",
            actorId,
            timestamp,
          );
        }

        if (line.countedOnHand < reserved) throw new Error("Cycle count would reduce on-hand below reserved stock");
      }

      this.finalCtx.storage.sql.exec(
        `INSERT INTO audit_events (
           id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at
         ) VALUES (?, ?, ?, 'stocktake.committed', 'stocktake', ?, ?, ?)`,
        id(),
        actorId,
        actorRole,
        stocktakeId,
        JSON.stringify({
          locationId: input.locationId,
          locationName: location.name,
          countedLines: input.lines.length,
          changedLines,
          totalVariance,
          reason: input.reason?.trim() || null,
        }),
        timestamp,
      );
    });

    const response: StocktakeResponse = {
      ok: true,
      stocktakeId,
      countedLines: input.lines.length,
      changedLines,
      totalVariance,
    };
    return Response.json(response, { status: 201 });
  }
}
