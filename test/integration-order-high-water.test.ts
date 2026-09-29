import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const headers = {
  "x-operating-layer-internal-integration": "integration-v1",
  "x-ordermate-actor-id": "integration-test",
  "x-ordermate-actor-role": "integration",
  "content-type": "application/json",
};
const shop = "example.myshopify.com";
const locationExternalId = "gid://shopify/Location/1";
const firstExternalVariant = "gid://shopify/ProductVariant/1";
const secondExternalVariant = "gid://shopify/ProductVariant/2";
const externalOrderId = "gid://shopify/Order/500";

async function seed() {
  const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
  const connectionId = crypto.randomUUID();
  const connection = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: connectionId,
      provider: "shopify",
      externalAccountId: shop,
      displayName: shop,
      status: "active",
      capabilities: ["orders:import"],
      credential: {
        envelope: { version: 1, algorithm: "A256GCM", keyVersion: "v1", iv: "aXY=", ciphertext: "Y2lwaGVydGV4dA==" },
        scopes: ["read_orders"],
        accessTokenExpiresAt: "2027-09-29T12:00:00.000Z",
        refreshTokenExpiresAt: "2027-12-29T12:00:00.000Z",
      },
    }),
  }));
  expect(connection.status).toBe(200);

  await runInDurableObject(stub, async (_instance, state) => {
    const timestamp = "2026-09-29T10:00:00.000Z";
    state.storage.sql.exec(
      "INSERT INTO products (id, name, status, created_at, updated_at) VALUES ('p1', 'Tee', 'active', ?, ?), ('p2', 'Mug', 'active', ?, ?)",
      timestamp, timestamp, timestamp, timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO product_variants (id, product_id, name, sku, price_minor, cost_minor, tax_rate_bps, active, created_at, updated_at)
       VALUES ('v1', 'p1', 'Blue', 'TEE-BLUE', 1000, 400, 2000, 1, ?, ?),
              ('v2', 'p2', 'Default', 'MUG', 1200, 500, 2000, 1, ?, ?)`,
      timestamp, timestamp, timestamp, timestamp,
    );
    state.storage.sql.exec(
      "INSERT INTO locations (id, name, code, active, created_at, updated_at) VALUES ('loc1', 'Warehouse', 'WH', 1, ?, ?)",
      timestamp, timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO inventory_levels (variant_id, location_id, on_hand, reserved, updated_at)
       VALUES ('v1', 'loc1', 10, 0, ?), ('v2', 'loc1', 10, 0, ?)`,
      timestamp, timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO integration_entity_links (
         provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, last_synced_at
       ) VALUES ('shopify', ?, 'variant', ?, 'product_variant', 'v1', ?),
                ('shopify', ?, 'location', ?, 'location', 'loc1', ?)`,
      connectionId, firstExternalVariant, timestamp,
      connectionId, locationExternalId, timestamp,
    );
  });
  return { stub, connectionId };
}

async function receive(stub: DurableObjectStub, connectionId: string) {
  const response = await stub.fetch(new Request("https://tenant.internal/__integrations/events/receive", {
    method: "POST",
    headers,
    body: JSON.stringify({
      connectionId,
      provider: "shopify",
      providerEventId: crypto.randomUUID(),
      topic: "orders/updated",
      externalAccountId: shop,
      occurredAt: "2026-09-29T12:00:00.000Z",
      apiVersion: "2026-07",
      payloadJson: "{}",
    }),
  }));
  expect(response.status).toBe(202);
  return response.json<{ id: string }>();
}

function proposal(connectionId: string, updatedAt: string, externalVariantId: string, quantity: number) {
  const unit = externalVariantId === firstExternalVariant ? 1000 : 1200;
  const net = unit * quantity;
  const tax = Math.round(net * 0.2);
  return {
    provider: "shopify" as const,
    connectionId,
    externalOrderId,
    externalOrderName: "#500",
    externalUpdatedAt: updatedAt,
    state: "active" as const,
    currency: "GBP",
    locationExternalId,
    locationExternalIds: [locationExternalId],
    subtotalMinor: net,
    taxMinor: tax,
    totalMinor: net + tax,
    nonMerchandiseMinor: 0,
    lines: [{
      externalLineId: `line:${externalVariantId}`,
      externalVariantId,
      quantity,
      productNameSnapshot: externalVariantId === firstExternalVariant ? "Tee" : "Mug",
      variantNameSnapshot: externalVariantId === firstExternalVariant ? "Blue" : "Default",
      skuSnapshot: externalVariantId === firstExternalVariant ? "TEE-BLUE" : "MUG",
      unitPriceMinor: unit,
      taxRateBps: 2000,
      netMinor: net,
      taxMinor: tax,
      grossMinor: net + tax,
    }],
    block: null,
  };
}

async function process(stub: DurableObjectStub, eventId: string, value: ReturnType<typeof proposal>) {
  return stub.fetch(new Request("https://tenant.internal/__integrations/orders/process", {
    method: "POST",
    headers,
    body: JSON.stringify({ eventId, proposal: value }),
  }));
}

describe("integration order observed high-water mark", () => {
  it("prevents an older event applying after a newer version blocks, then permits the same blocked version after repair", async () => {
    const { stub, connectionId } = await seed();

    const firstEvent = await receive(stub, connectionId);
    const firstResponse = await process(stub, firstEvent.id, proposal(connectionId, "2026-09-29T12:00:00.000Z", firstExternalVariant, 2));
    const first = await firstResponse.json<{ outcome: string; localOrderId: string }>();
    expect(first.outcome).toBe("applied");

    const newerBlockedEvent = await receive(stub, connectionId);
    const newerBlockedProposal = proposal(connectionId, "2026-09-29T12:10:00.000Z", secondExternalVariant, 1);
    const blockedResponse = await process(stub, newerBlockedEvent.id, newerBlockedProposal);
    expect(await blockedResponse.json()).toMatchObject({ outcome: "blocked", retryDelivery: false });

    await runInDurableObject(stub, async (_instance, state) => {
      const orderState = state.storage.sql.exec<{
        applied_external_updated_at: string;
        observed_external_updated_at: string;
        status: string;
      }>(
        "SELECT applied_external_updated_at, observed_external_updated_at, status FROM integration_order_state WHERE connection_id = ? AND external_order_id = ?",
        connectionId, externalOrderId,
      ).toArray()[0];
      expect(orderState).toEqual({
        applied_external_updated_at: "2026-09-29T12:00:00.000Z",
        observed_external_updated_at: "2026-09-29T12:10:00.000Z",
        status: "blocked",
      });
    });

    const olderEvent = await receive(stub, connectionId);
    const olderResponse = await process(stub, olderEvent.id, proposal(connectionId, "2026-09-29T12:05:00.000Z", firstExternalVariant, 1));
    expect(await olderResponse.json()).toMatchObject({ outcome: "ignored", reason: "out_of_order", retryDelivery: false });

    await runInDurableObject(stub, async (_instance, state) => {
      const order = state.storage.sql.exec<{ id: string }>("SELECT id FROM orders").toArray();
      expect(order).toHaveLength(1);
      expect(order[0]?.id).toBe(first.localOrderId);
      const lines = state.storage.sql.exec<{ variant_id: string; quantity: number }>("SELECT variant_id, quantity FROM order_lines WHERE order_id = ?", first.localOrderId).toArray();
      expect(lines).toEqual([{ variant_id: "v1", quantity: 2 }]);
      const reservations = state.storage.sql.exec<{ variant_id: string; quantity: number }>("SELECT variant_id, quantity FROM inventory_reservations WHERE order_id = ? AND status = 'active'", first.localOrderId).toArray();
      expect(reservations).toEqual([{ variant_id: "v1", quantity: 2 }]);

      state.storage.sql.exec(
        `INSERT INTO integration_entity_links (
           provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id, last_synced_at
         ) VALUES ('shopify', ?, 'variant', ?, 'product_variant', 'v2', ?)`,
        connectionId, secondExternalVariant, "2026-09-29T12:11:00.000Z",
      );
    });

    const repairedEvent = await receive(stub, connectionId);
    const repairedResponse = await process(stub, repairedEvent.id, newerBlockedProposal);
    expect(await repairedResponse.json()).toMatchObject({
      outcome: "applied",
      action: "updated",
      localOrderId: first.localOrderId,
      retryDelivery: false,
    });

    await runInDurableObject(stub, async (_instance, state) => {
      const orderState = state.storage.sql.exec<{
        applied_external_updated_at: string;
        observed_external_updated_at: string;
        status: string;
      }>(
        "SELECT applied_external_updated_at, observed_external_updated_at, status FROM integration_order_state WHERE connection_id = ? AND external_order_id = ?",
        connectionId, externalOrderId,
      ).toArray()[0];
      expect(orderState).toEqual({
        applied_external_updated_at: "2026-09-29T12:10:00.000Z",
        observed_external_updated_at: "2026-09-29T12:10:00.000Z",
        status: "active",
      });
      const lines = state.storage.sql.exec<{ variant_id: string; quantity: number }>("SELECT variant_id, quantity FROM order_lines WHERE order_id = ?", first.localOrderId).toArray();
      expect(lines).toEqual([{ variant_id: "v2", quantity: 1 }]);
    });
  });
});
