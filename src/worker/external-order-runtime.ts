import { z } from "zod";
import { integrationInternalHeaders } from "./integration-runtime";

const importLineSchema = z.object({
  externalLineId: z.string().trim().min(1).max(255),
  externalVariantId: z.string().trim().min(1).max(255),
  variantId: z.string().trim().min(1).max(255),
  quantity: z.number().int().positive().max(1_000_000),
  productNameSnapshot: z.string().trim().min(1).max(500),
  variantNameSnapshot: z.string().trim().min(1).max(500),
  skuSnapshot: z.string().trim().max(255),
  unitPriceMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxRateBps: z.number().int().nonnegative().max(1_000_000),
  netMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grossMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).superRefine((line, ctx) => {
  if (line.grossMinor !== line.netMinor + line.taxMinor) {
    ctx.addIssue({ code: "custom", message: "External order line gross must equal net plus tax" });
  }
});

const importOrderSchema = z.object({
  orderId: z.string().uuid(),
  source: z.string().trim().min(1).max(80),
  externalReference: z.string().trim().min(1).max(255),
  locationId: z.string().trim().min(1).max(255),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  subtotalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  taxMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  totalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nonMerchandiseMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  lines: z.array(importLineSchema).min(1).max(2_000),
}).superRefine((order, ctx) => {
  const lineSubtotal = order.lines.reduce((sum, line) => sum + line.netMinor, 0);
  const merchandiseTax = order.lines.reduce((sum, line) => sum + line.taxMinor, 0);
  if (lineSubtotal !== order.subtotalMinor) ctx.addIssue({ code: "custom", message: "External order lines do not match the supplied subtotal" });
  if (merchandiseTax > order.taxMinor) ctx.addIssue({ code: "custom", message: "External merchandise tax cannot exceed the supplied order tax total" });
  if (order.totalMinor !== order.subtotalMinor + order.taxMinor + order.nonMerchandiseMinor) {
    ctx.addIssue({ code: "custom", message: "External order totals do not reconcile" });
  }
});

const INTERNAL_ENTRIES = Object.entries(integrationInternalHeaders);

type ExistingOrder = {
  id: string;
  number: string;
  status: string;
  fulfilment_status: string;
  location_id: string;
};
type ReservationRow = { id: string; variant_id: string; location_id: string; quantity: number };
type VariantRow = { id: string; active: number; product_status: string };
type LevelRow = { on_hand: number; reserved: number };
type FulfilledRow = { fulfilled: number; returned: number };
type SettingsRow = { currency: string };

class ExternalOrderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function now() {
  return new Date().toISOString();
}

function internalRequest(request: Request) {
  return INTERNAL_ENTRIES.every(([key, value]) => request.headers.get(key) === value);
}

function actor(request: Request) {
  return {
    id: request.headers.get("x-ordermate-actor-id") || "integration-system",
    role: request.headers.get("x-ordermate-actor-role") || "integration",
  };
}

/**
 * Provider-neutral canonical boundary for externally sourced orders.
 *
 * Provider adapters must never write order/reservation SQL. They supply reviewed,
 * locally mapped facts here. This runtime owns the atomic canonical mutation and
 * enforces the same stock reservation invariant as normal order confirmation.
 */
export class ExternalOrderRuntime {
  constructor(private readonly ctx: DurableObjectState) {}

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!path.startsWith("/__orders/")) return null;
    if (!internalRequest(request)) return Response.json({ error: "Internal canonical order route" }, { status: 404 });

    try {
      if (request.method === "POST" && path === "/__orders/import-external") return await this.importExternal(request);
      const cancellation = path.match(/^\/__orders\/([^/]+)\/cancel-external$/);
      if (request.method === "POST" && cancellation) return this.cancelExternal(decodeURIComponent(cancellation[1]), request);
      return Response.json({ error: "Internal canonical order route not found" }, { status: 404 });
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid external order" }, { status: 400 });
      if (cause instanceof ExternalOrderError) return Response.json({ error: cause.message }, { status: cause.status });
      throw cause;
    }
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private nextOrderNumber() {
    this.ctx.storage.sql.exec("INSERT INTO sequences (name, next_value) VALUES ('order', 1) ON CONFLICT(name) DO NOTHING");
    const sequence = this.one<{ next_value: number }>("SELECT next_value FROM sequences WHERE name = 'order'");
    if (!sequence) throw new ExternalOrderError("Unable to allocate an order number", 500);
    this.ctx.storage.sql.exec("UPDATE sequences SET next_value = next_value + 1 WHERE name = 'order'");
    return `ORD-${new Date().getUTCFullYear()}-${String(sequence.next_value).padStart(6, "0")}`;
  }

  private audit(request: Request, action: string, orderId: string, metadata: Record<string, unknown>) {
    const requestActor = actor(request);
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'order', ?, ?, ?)`,
      crypto.randomUUID(),
      requestActor.id,
      requestActor.role,
      action,
      orderId,
      JSON.stringify(metadata),
      now(),
    );
  }

  private existing(orderId: string) {
    return this.one<ExistingOrder>(
      "SELECT id, number, status, fulfilment_status, location_id FROM orders WHERE id = ?",
      orderId,
    );
  }

  private assertNoFulfilledQuantity(orderId: string) {
    const totals = this.one<FulfilledRow>(
      `SELECT COALESCE(SUM(quantity_fulfilled), 0) AS fulfilled,
              COALESCE(SUM(quantity_returned), 0) AS returned
       FROM order_lines WHERE order_id = ?`,
      orderId,
    ) ?? { fulfilled: 0, returned: 0 };
    if (totals.fulfilled > 0 || totals.returned > 0) {
      throw new ExternalOrderError("An externally sourced order cannot be rewritten after fulfilment has started", 409);
    }
  }

  private preflightStock(
    locationId: string,
    quantities: Map<string, number>,
    currentReservations: ReservationRow[],
  ) {
    const reservationCredit = new Map<string, number>();
    for (const reservation of currentReservations) {
      const key = `${reservation.variant_id}:${reservation.location_id}`;
      reservationCredit.set(key, (reservationCredit.get(key) || 0) + reservation.quantity);
    }
    for (const [variantId, quantity] of quantities) {
      const level = this.one<LevelRow>(
        "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?",
        variantId,
        locationId,
      ) ?? { on_hand: 0, reserved: 0 };
      const credit = reservationCredit.get(`${variantId}:${locationId}`) || 0;
      if (level.on_hand - level.reserved + credit < quantity) {
        throw new ExternalOrderError(`Insufficient available stock for mapped variant ${variantId}`, 409);
      }
    }
  }

  private async importExternal(request: Request) {
    const input = importOrderSchema.parse(await request.json());
    const settings = this.one<SettingsRow>("SELECT currency FROM tenant_settings WHERE id = 1");
    if (!settings) throw new ExternalOrderError("Tenant settings are unavailable", 500);
    if (settings.currency.toUpperCase() !== input.currency) {
      throw new ExternalOrderError(`External order currency ${input.currency} does not match workspace currency ${settings.currency}`, 409);
    }
    if (!this.one<{ id: string }>("SELECT id FROM locations WHERE id = ? AND active = 1", input.locationId)) {
      throw new ExternalOrderError("Mapped fulfilment location is no longer active", 409);
    }

    const seenLines = new Set<string>();
    const quantities = new Map<string, number>();
    for (const line of input.lines) {
      if (seenLines.has(line.externalLineId)) throw new ExternalOrderError(`External line ${line.externalLineId} was supplied more than once`);
      seenLines.add(line.externalLineId);
      const variant = this.one<VariantRow>(
        `SELECT pv.id, pv.active, p.status AS product_status
         FROM product_variants pv JOIN products p ON p.id = pv.product_id
         WHERE pv.id = ?`,
        line.variantId,
      );
      if (!variant || variant.active !== 1 || variant.product_status !== "active") {
        throw new ExternalOrderError(`Mapped product variant ${line.variantId} is no longer active`, 409);
      }
      quantities.set(line.variantId, (quantities.get(line.variantId) || 0) + line.quantity);
    }

    const existing = this.existing(input.orderId);
    if (existing) {
      if (existing.status === "cancelled") throw new ExternalOrderError("A cancelled external order cannot be reactivated automatically", 409);
      this.assertNoFulfilledQuantity(input.orderId);
    }
    const currentReservations = existing
      ? this.rows<ReservationRow>("SELECT id, variant_id, location_id, quantity FROM inventory_reservations WHERE order_id = ? AND status = 'active'", input.orderId)
      : [];
    this.preflightStock(input.locationId, quantities, currentReservations);

    const timestamp = now();
    let number = existing?.number || "";
    let created = false;
    this.ctx.storage.transactionSync(() => {
      if (!existing) {
        number = this.nextOrderNumber();
        this.ctx.storage.sql.exec(
          `INSERT INTO orders (
             id, number, customer_id, location_id, status, fulfilment_status, currency, notes,
             subtotal_minor, tax_minor, total_minor, confirmed_at, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, 'draft', 'unfulfilled', ?, ?, ?, ?, ?, NULL, ?, ?)`,
          input.orderId,
          number,
          input.locationId,
          input.currency,
          `Imported ${input.source} order ${input.externalReference}`,
          input.subtotalMinor,
          input.taxMinor,
          input.totalMinor,
          timestamp,
          timestamp,
        );
        created = true;
      } else {
        for (const reservation of currentReservations) {
          this.ctx.storage.sql.exec(
            "UPDATE inventory_levels SET reserved = reserved - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
            reservation.quantity,
            timestamp,
            reservation.variant_id,
            reservation.location_id,
          );
        }
        this.ctx.storage.sql.exec("DELETE FROM inventory_reservations WHERE order_id = ?", input.orderId);
        this.ctx.storage.sql.exec("DELETE FROM order_lines WHERE order_id = ?", input.orderId);
        this.ctx.storage.sql.exec(
          `UPDATE orders SET location_id = ?, status = 'draft', fulfilment_status = 'unfulfilled', currency = ?, notes = ?,
             subtotal_minor = ?, tax_minor = ?, total_minor = ?, confirmed_at = NULL, completed_at = NULL, updated_at = ?
           WHERE id = ?`,
          input.locationId,
          input.currency,
          `Imported ${input.source} order ${input.externalReference}`,
          input.subtotalMinor,
          input.taxMinor,
          input.totalMinor,
          timestamp,
          input.orderId,
        );
      }

      for (const line of input.lines) {
        const lineId = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          `INSERT INTO order_lines (
             id, order_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot,
             quantity, unit_price_minor, tax_rate_bps, net_minor, tax_minor, gross_minor
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          lineId,
          input.orderId,
          line.variantId,
          line.productNameSnapshot,
          line.variantNameSnapshot,
          line.skuSnapshot,
          line.quantity,
          line.unitPriceMinor,
          line.taxRateBps,
          line.netMinor,
          line.taxMinor,
          line.grossMinor,
        );
        this.ctx.storage.sql.exec(
          "UPDATE inventory_levels SET reserved = reserved + ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
          line.quantity,
          timestamp,
          line.variantId,
          input.locationId,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO inventory_reservations (
             id, order_id, order_line_id, variant_id, location_id, quantity, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          crypto.randomUUID(),
          input.orderId,
          lineId,
          line.variantId,
          input.locationId,
          line.quantity,
          timestamp,
          timestamp,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?",
        timestamp,
        timestamp,
        input.orderId,
      );
      this.audit(request, created ? "order.imported" : "order.external_sync_applied", input.orderId, {
        source: input.source,
        externalReference: input.externalReference,
        lines: input.lines.length,
        nonMerchandiseMinor: input.nonMerchandiseMinor,
      });
    });

    return Response.json({ ok: true, orderId: input.orderId, number, created, status: "confirmed" }, { status: created ? 201 : 200 });
  }

  private cancelExternal(orderId: string, request: Request) {
    const existing = this.existing(orderId);
    if (!existing) return Response.json({ error: "Order not found" }, { status: 404 });
    if (existing.status === "cancelled") return Response.json({ ok: true, orderId, status: "cancelled", changed: false });
    this.assertNoFulfilledQuantity(orderId);
    if (!["draft", "confirmed"].includes(existing.status)) {
      return Response.json({ error: "Externally sourced order can no longer be cancelled automatically" }, { status: 409 });
    }

    const timestamp = now();
    const reservations = this.rows<ReservationRow>(
      "SELECT id, variant_id, location_id, quantity FROM inventory_reservations WHERE order_id = ? AND status = 'active'",
      orderId,
    );
    this.ctx.storage.transactionSync(() => {
      for (const reservation of reservations) {
        this.ctx.storage.sql.exec(
          "UPDATE inventory_levels SET reserved = reserved - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?",
          reservation.quantity,
          timestamp,
          reservation.variant_id,
          reservation.location_id,
        );
        this.ctx.storage.sql.exec("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE id = ?", timestamp, reservation.id);
      }
      this.ctx.storage.sql.exec("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", timestamp, orderId);
      this.audit(request, "order.external_cancelled", orderId, {});
    });
    return Response.json({ ok: true, orderId, status: "cancelled", changed: true });
  }
}
