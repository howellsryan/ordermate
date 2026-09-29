import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const internalHeaders = {
  "x-operating-layer-internal-integration": "integration-v1",
  "x-ordermate-actor-id": "integration-test",
  "x-ordermate-actor-role": "integration",
  "content-type": "application/json",
};

const actorHeaders = {
  "x-ordermate-actor-id": "owner-1",
  "x-ordermate-actor-role": "owner",
  "content-type": "application/json",
};

const shop = "example.myshopify.com";
const externalVariantId = "gid://shopify/ProductVariant/1";
const externalLocationId = "gid://shopify/Location/1";
const externalOrderId = "gid://shopify/Order/100";

function connectionBody(id: string) {
  return {
    id,
    provider: "shopify",
    externalAccountId: shop,
    displayName: shop,
    status: "active",
    capabilities: ["catalogue:import", "orders:import"],
    credential: {
      envelope: {
        version: 1,
        algorithm: "A256GCM",
        keyVersion: "v1",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      scopes: ["read_products", "read_locations", "read_orders"],
      accessTokenExpiresAt: "2027-09-29T12:00:00.000Z",
      refreshTokenExpiresAt: "2027-12-29T12:00:00.000Z",
    },
  };
}

async function setup(options: { stock?: number; mapVariant?: boolean; mapLocation?: boolean } = {}) {
  const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
  const connectionId = crypto.randomUUID();
  const response = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify(connectionBody(connectionId)),
  }));
  expect(response.status).toBe(200);

  await runInDurableObject(stub, async (_instance, state) => {
    const timestamp = "2026-09-29T10:00:00.000Z";
    state.storage.sql.exec(
      "INSERT INTO products (id, name, status, created_at, updated_at) VALUES ('product-1', 'Blue Tee', 'active', ?, ?)",
      timestamp,
      timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO product_variants (
         id, product_id, name, sku, barcode, price_minor, cost_minor, tax_rate_bps, active, created_at, updated_at
       ) VALUES ('variant-1', 'product-1', 'Large', 'TEE-L', 'TEE-L-BAR', 900, 400, 2000, 1, ?, ?)`,
      timestamp,
      timestamp,
    );
    state.storage.sql.exec(
      "INSERT INTO locations (id, name, code, active, created_at, updated_at) VALUES ('location-1', 'Main Warehouse', 'MAIN', 1, ?, ?)",
      timestamp,
      timestamp,
    );
    state.storage.sql.exec(
      "INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at) VALUES ('variant-1', 'location-1', ?, 0, ?)",
      options.stock ?? 10,
      timestamp,
    );
    if (options.mapVariant !== false) {
      state.storage.sql.exec(
        `INSERT INTO integration_entity_links (
           provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, external_updated_at, last_synced_at
         ) VALUES ('shopify', ?, 'variant', ?, 'product_variant', 'variant-1', NULL, ?)`,
        connectionId,
        externalVariantId,
        timestamp,
      );
    }
    if (options.mapLocation !== false) {
      state.storage.sql.exec(
        `INSERT INTO integration_entity_links (
           provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, external_updated_at, last_synced_at
         ) VALUES ('shopify', ?, 'location', ?, 'location', 'location-1', NULL, ?)`,
        connectionId,
        externalLocationId,
        timestamp,
      );
    }
  });
  return { stub, connectionId };
}

async function receiveEvent(stub: DurableObjectStub, connectionId: string, topic = "orders/updated") {
  const providerEventId = crypto.randomUUID();
  const response = await stub.fetch(new Request("https://tenant.internal/__integrations/events/receive", {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({
      connectionId,
      provider: "shopify",
      providerEventId,
      providerActionId: null,
      topic,
      externalAccountId: shop,
      occurredAt: "2026-09-29T12:00:00.000Z",
      apiVersion: "2026-07",
      payloadJson: JSON.stringify({ id: 100 }),
    }),
  }));
  expect(response.status).toBe(202);
  return response.json<{ id: string; duplicate: boolean }>();
}

function proposal(connectionId: string, input: {
  updatedAt?: string;
  quantity?: number;
  state?: "active" | "cancelled";
  block?: { code: string; message: string; retryable: boolean; retryDelivery: boolean } | null;
} = {}) {
  const quantity = input.quantity ?? 2;
  const state = input.state ?? "active";
  const net = 900 * quantity;
  const tax = 180 * quantity;
  return {
    provider: "shopify" as const,
    connectionId,
    externalOrderId,
    externalOrderName: "#1001",
    externalUpdatedAt: input.updatedAt ?? "2026-09-29T12:00:00.000Z",
    state,
    currency: "GBP",
    locationExternalId: state === "active" ? externalLocationId : null,
    locationExternalIds: state === "active" ? [externalLocationId] : [],
    subtotalMinor: state === "active" ? net : 0,
    taxMinor: state === "active" ? tax : 0,
    totalMinor: state === "active" ? net + tax : 0,
    nonMerchandiseMinor: 0,
    lines: state === "active" ? [{
      externalLineId: "gid://shopify/LineItem/1",
      externalVariantId,
      quantity,
      productNameSnapshot: "Blue Tee",
      variantNameSnapshot: "Large",
      skuSnapshot: "TEE-L",
      unitPriceMinor: 900,
      taxRateBps: 2000,
      netMinor: net,
      taxMinor: tax,
      grossMinor: net + tax,
    }] : [],
    block: input.block ?? null,
  };
}

async function process(stub: DurableObjectStub, eventId: string, value: ReturnType<typeof proposal>) {
  return stub.fetch(new Request("https://tenant.internal/__integrations/orders/process", {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({ eventId, proposal: value }),
  }));
}

async function orderSnapshot(stub: DurableObjectStub) {
  return runInDurableObject(stub, async (_instance, state) => {
    const order = state.storage.sql.exec<{
      id: string;
      status: string;
      fulfilment_status: string;
      location_id: string;
      subtotal_minor: number;
      tax_minor: number;
      total_minor: number;
    }>(
      "SELECT id, status, fulfilment_status, location_id, subtotal_minor, tax_minor, total_minor FROM orders LIMIT 1",
    ).toArray()[0] || null;
    const level = state.storage.sql.exec<{ on_hand: number; reserved: number }>(
      "SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = 'variant-1' AND location_id = 'location-1'",
    ).toArray()[0];
    const activeReservations = state.storage.sql.exec<{ count: number; quantity: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
       FROM inventory_reservations WHERE status = 'active'`,
    ).toArray()[0];
    return { order, level, activeReservations };
  });
}

describe("integration order runtime", () => {
  it("creates, reconciles, ignores stale versions and cancels one canonical order", async () => {
    const { stub, connectionId } = await setup();

    const createdEvent = await receiveEvent(stub, connectionId, "orders/create");
    const createdResponse = await process(stub, createdEvent.id, proposal(connectionId));
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json<{ outcome: string; action: string; localOrderId: string }>();
    expect(created).toMatchObject({ outcome: "applied", action: "created" });
    expect(created.localOrderId).toBeTruthy();

    let snapshot = await orderSnapshot(stub);
    expect(snapshot.order).toMatchObject({
      id: created.localOrderId,
      status: "confirmed",
      fulfilment_status: "unfulfilled",
      location_id: "location-1",
      subtotal_minor: 1800,
      tax_minor: 360,
      total_minor: 2160,
    });
    expect(snapshot.level).toEqual({ on_hand: 10, reserved: 2 });
    expect(snapshot.activeReservations).toMatchObject({ count: 1, quantity: 2 });

    const updatedEvent = await receiveEvent(stub, connectionId);
    const updatedResponse = await process(stub, updatedEvent.id, proposal(connectionId, {
      updatedAt: "2026-09-29T12:05:00.000Z",
      quantity: 3,
    }));
    const updated = await updatedResponse.json<{ outcome: string; action: string; localOrderId: string }>();
    expect(updated).toMatchObject({ outcome: "applied", action: "updated", localOrderId: created.localOrderId });
    snapshot = await orderSnapshot(stub);
    expect(snapshot.level.reserved).toBe(3);
    expect(snapshot.activeReservations).toMatchObject({ count: 1, quantity: 3 });

    const staleEvent = await receiveEvent(stub, connectionId);
    const staleResponse = await process(stub, staleEvent.id, proposal(connectionId, {
      updatedAt: "2026-09-29T12:03:00.000Z",
      quantity: 1,
    }));
    expect(await staleResponse.json()).toMatchObject({ outcome: "ignored", reason: "out_of_order", retryDelivery: false });
    snapshot = await orderSnapshot(stub);
    expect(snapshot.level.reserved).toBe(3);

    const cancelEvent = await receiveEvent(stub, connectionId, "orders/cancelled");
    const cancelResponse = await process(stub, cancelEvent.id, proposal(connectionId, {
      updatedAt: "2026-09-29T12:10:00.000Z",
      state: "cancelled",
    }));
    expect(await cancelResponse.json()).toMatchObject({ outcome: "applied", action: "cancelled", retryDelivery: false });
    snapshot = await orderSnapshot(stub);
    expect(snapshot.order?.status).toBe("cancelled");
    expect(snapshot.level.reserved).toBe(0);
    expect(snapshot.activeReservations.quantity).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      const stateRow = state.storage.sql.exec<{ local_order_id: string; status: string; applied_external_updated_at: string }>(
        "SELECT local_order_id, status, applied_external_updated_at FROM integration_order_state WHERE connection_id = ? AND external_order_id = ?",
        connectionId,
        externalOrderId,
      ).toArray()[0];
      expect(stateRow).toMatchObject({
        local_order_id: created.localOrderId,
        status: "cancelled",
        applied_external_updated_at: "2026-09-29T12:10:00.000Z",
      });
      const orderCount = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM orders").toArray()[0]?.count;
      expect(orderCount).toBe(1);
    });
  });

  it("blocks an unmapped line without creating a partial order and exposes an exception", async () => {
    const { stub, connectionId } = await setup({ mapVariant: false });
    const event = await receiveEvent(stub, connectionId, "orders/create");
    const response = await process(stub, event.id, proposal(connectionId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "blocked", retryDelivery: false });

    const exceptions = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/exceptions`).then(result => result.json<{
      exceptions: Array<{ code: string; externalId: string; status: string }>;
    }>());
    expect(exceptions.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unmapped_variant", externalId: externalVariantId, status: "open" }),
    ]));

    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM orders").toArray()[0]?.count).toBe(0);
      const integrationEvent = state.storage.sql.exec<{ status: string }>("SELECT status FROM integration_events WHERE id = ?", event.id).toArray()[0];
      expect(integrationEvent?.status).toBe("failed");
    });
  });

  it("rolls back a canonical import when mapped stock is insufficient", async () => {
    const { stub, connectionId } = await setup({ stock: 1 });
    const event = await receiveEvent(stub, connectionId, "orders/create");
    const response = await process(stub, event.id, proposal(connectionId, { quantity: 2 }));
    expect(await response.json()).toMatchObject({ outcome: "blocked", retryDelivery: false });

    const exceptions = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/exceptions`).then(result => result.json<{
      exceptions: Array<{ code: string; status: string }>;
    }>());
    expect(exceptions.exceptions[0]).toMatchObject({ code: "insufficient_stock", status: "open" });
    const snapshot = await orderSnapshot(stub);
    expect(snapshot.order).toBeNull();
    expect(snapshot.level).toEqual({ on_hand: 1, reserved: 0 });
  });

  it("refuses Shopify rewrites after Operating Layer fulfilment has started", async () => {
    const { stub, connectionId } = await setup();
    const event = await receiveEvent(stub, connectionId, "orders/create");
    const response = await process(stub, event.id, proposal(connectionId));
    const created = await response.json<{ localOrderId: string }>();

    const fulfil = await stub.fetch(new Request(`https://tenant.internal/orders/${created.localOrderId}/fulfil`, {
      method: "POST",
      headers: actorHeaders,
      body: JSON.stringify({}),
    }));
    expect(fulfil.status).toBe(200);

    const updateEvent = await receiveEvent(stub, connectionId);
    const updateResponse = await process(stub, updateEvent.id, proposal(connectionId, {
      updatedAt: "2026-09-29T12:05:00.000Z",
      quantity: 1,
    }));
    expect(await updateResponse.json()).toMatchObject({ outcome: "blocked", retryDelivery: false });

    const snapshot = await orderSnapshot(stub);
    expect(snapshot.order).toMatchObject({ id: created.localOrderId, status: "completed", fulfilment_status: "fulfilled" });
    expect(snapshot.level).toEqual({ on_hand: 8, reserved: 0 });

    const exceptions = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/exceptions`).then(result => result.json<{
      exceptions: Array<{ code: string; message: string }>;
    }>());
    expect(exceptions.exceptions[0]).toMatchObject({
      code: "canonical_order_rejected",
      message: expect.stringContaining("cannot be rewritten after fulfilment has started"),
    });
  });
});
