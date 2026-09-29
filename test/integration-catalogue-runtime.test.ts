import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const internalHeaders = {
  "x-operating-layer-internal-integration": "integration-v1",
  "x-ordermate-actor-id": "owner-1",
  "x-ordermate-actor-role": "owner",
  "content-type": "application/json",
};

function connectionBody(id: string) {
  return {
    id,
    provider: "shopify",
    externalAccountId: "example.myshopify.com",
    displayName: "example.myshopify.com",
    status: "active",
    capabilities: ["catalogue:import"],
    credential: {
      envelope: {
        version: 1,
        algorithm: "A256GCM",
        keyVersion: "v1",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      scopes: ["read_products", "read_locations"],
      accessTokenExpiresAt: "2026-09-28T12:00:00.000Z",
      refreshTokenExpiresAt: "2026-12-28T12:00:00.000Z",
    },
  };
}

async function createConnection(stub: DurableObjectStub, connectionId: string) {
  const response = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify(connectionBody(connectionId)),
  }));
  expect(response.status).toBe(200);
}

async function seedLocalCatalogue(stub: DurableObjectStub) {
  await runInDurableObject(stub, async (_instance, state) => {
    const timestamp = "2026-09-28T07:00:00.000Z";
    state.storage.sql.exec(
      "INSERT INTO products (id, name, status, created_at, updated_at) VALUES ('product-1', 'Tee', 'active', ?, ?), ('product-2', 'Mug', 'active', ?, ?)",
      timestamp, timestamp, timestamp, timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO product_variants (id, product_id, name, sku, barcode, price_minor, cost_minor, tax_rate_bps, active, created_at, updated_at)
       VALUES ('variant-1', 'product-1', 'Blue', 'SKU-1', 'BAR-1', 1000, 400, 2000, 1, ?, ?),
              ('variant-2', 'product-2', 'Default', 'SKU-2', 'BAR-2', 1200, 500, 2000, 1, ?, ?)`,
      timestamp, timestamp, timestamp, timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO locations (id, name, code, active, created_at, updated_at)
       VALUES ('location-1', 'Main Warehouse', 'WH1', 1, ?, ?),
              ('location-2', 'Shop Floor', 'SHOP', 1, ?, ?)`,
      timestamp, timestamp, timestamp, timestamp,
    );
  });
}

async function discover(stub: DurableObjectStub, connectionId: string, entityType: "variant" | "location", entities: unknown[]) {
  const resource = entityType === "variant" ? "catalogue" : "locations";
  const response = await stub.fetch(new Request("https://tenant.internal/__integrations/discovery/replace", {
    method: "POST",
    headers: internalHeaders,
    body: JSON.stringify({
      connectionId,
      provider: "shopify",
      externalAccountId: "example.myshopify.com",
      resource,
      entityType,
      entities,
    }),
  }));
  expect(response.status).toBe(200);
  return response.json<{ summary: Record<string, number> }>();
}

describe("integration catalogue mapping runtime", () => {
  it("suggests only deterministic exact matches and requires explicit mapping approval", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();
    await createConnection(stub, connectionId);
    await seedLocalCatalogue(stub);

    const variantSummary = await discover(stub, connectionId, "variant", [
      {
        externalId: "gid://shopify/ProductVariant/1",
        displayName: "Tee — Blue",
        externalUpdatedAt: "2026-09-28T06:00:00.000Z",
        payload: { sku: " sku-1 ", barcode: "bar-1" },
      },
      {
        externalId: "gid://shopify/ProductVariant/2",
        displayName: "Conflicting evidence",
        externalUpdatedAt: "2026-09-28T06:00:00.000Z",
        payload: { sku: "SKU-1", barcode: "BAR-2" },
      },
      {
        externalId: "gid://shopify/ProductVariant/3",
        displayName: "Unmatched",
        externalUpdatedAt: "2026-09-28T06:00:00.000Z",
        payload: { sku: "NOPE", barcode: null },
      },
    ]);
    expect(variantSummary.summary).toMatchObject({ suggested: 1, ambiguous: 1, unmatched: 1, mapped: 0 });

    const locationSummary = await discover(stub, connectionId, "location", [
      {
        externalId: "gid://shopify/Location/1",
        displayName: "Main Warehouse",
        payload: { name: " main warehouse " },
      },
    ]);
    expect(locationSummary.summary).toMatchObject({ suggested: 1, ambiguous: 0, unmatched: 0, mapped: 0 });

    const stateBefore = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/mappings`).then(response => response.json<{
      counts: Record<string, number>;
      entities: Array<{ externalId: string; matchStatus: string; suggestion: { localEntityId: string } | null }>;
    }>());
    expect(stateBefore.counts).toMatchObject({ suggested: 2, ambiguous: 1, unmatched: 1, mapped: 0 });
    expect(stateBefore.entities.find(entity => entity.externalId.endsWith("/1"))?.suggestion?.localEntityId).toBeTruthy();

    await runInDurableObject(stub, async (_instance, state) => {
      const links = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM integration_entity_links").toArray()[0]?.count ?? 0;
      expect(links).toBe(0);
    });

    const approve = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/mappings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-ordermate-actor-id": "owner-1", "x-ordermate-actor-role": "owner" },
      body: JSON.stringify({ mappings: [
        { entityType: "variant", externalId: "gid://shopify/ProductVariant/1", localEntityId: "variant-1" },
        { entityType: "location", externalId: "gid://shopify/Location/1", localEntityId: "location-1" },
      ] }),
    }));
    expect(approve.status).toBe(200);
    const approved = await approve.json<{ counts: Record<string, number> }>();
    expect(approved.counts).toMatchObject({ mapped: 2, ambiguous: 1, unmatched: 1 });

    const duplicateTarget = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/mappings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-ordermate-actor-id": "owner-1", "x-ordermate-actor-role": "owner" },
      body: JSON.stringify({ mappings: [
        { entityType: "variant", externalId: "gid://shopify/ProductVariant/3", localEntityId: "variant-1" },
      ] }),
    }));
    expect(duplicateTarget.status).toBe(409);

    const unmap = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/mappings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-ordermate-actor-id": "owner-1", "x-ordermate-actor-role": "owner" },
      body: JSON.stringify({ mappings: [
        { entityType: "variant", externalId: "gid://shopify/ProductVariant/1", localEntityId: null },
      ] }),
    }));
    expect(unmap.status).toBe(200);
    const unmapped = await unmap.json<{ entities: Array<{ externalId: string; matchStatus: string }> }>();
    expect(unmapped.entities.find(entity => entity.externalId === "gid://shopify/ProductVariant/1")?.matchStatus).toBe("suggested");
  });

  it("preserves approved links as stale history when Shopify no longer returns the entity", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();
    await createConnection(stub, connectionId);
    await seedLocalCatalogue(stub);
    await discover(stub, connectionId, "variant", [{
      externalId: "gid://shopify/ProductVariant/10",
      displayName: "Tee — Blue",
      payload: { sku: "SKU-1", barcode: "BAR-1" },
    }]);

    const approve = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/mappings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-ordermate-actor-id": "owner-1", "x-ordermate-actor-role": "owner" },
      body: JSON.stringify({ mappings: [{ entityType: "variant", externalId: "gid://shopify/ProductVariant/10", localEntityId: "variant-1" }] }),
    }));
    expect(approve.status).toBe(200);

    await discover(stub, connectionId, "variant", []);
    const state = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/mappings`).then(response => response.json<{
      entities: unknown[];
      staleLinks: Array<{ externalId: string; localEntityId: string }>;
    }>());
    expect(state.entities).toHaveLength(0);
    expect(state.staleLinks).toEqual(expect.arrayContaining([{ externalId: "gid://shopify/ProductVariant/10", localEntityId: "variant-1", entityType: "variant", localEntityType: "product_variant", lastSyncedAt: expect.any(String) }]));
  });
});
