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

function normalizeSupplierSku(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

/**
 * Final canonical runtime guards and reviewed operational batch mutations.
 *
 * - Supplier SKU matching is only deterministic when one supplier's code maps
 *   to one OrderMate variant.
 * - Cycle counts compare against the stock position the operator reviewed and
 *   commit all accepted variances in one SQLite transaction.
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

        // Retain the explicit reservation invariant inside the transaction too.
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
