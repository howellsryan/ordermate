import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const internalHeaders = {
  "x-operating-layer-internal-integration": "integration-v1",
  "x-ordermate-actor-id": "owner-1",
  "x-ordermate-actor-role": "owner",
  "content-type": "application/json",
};

describe("integration catalogue suggestion collisions", () => {
  it("marks competing exact matches ambiguous instead of suggesting one local variant twice", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();
    const connection = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        id: connectionId,
        provider: "shopify",
        externalAccountId: "collision.myshopify.com",
        displayName: "collision.myshopify.com",
        status: "active",
        capabilities: ["catalogue:import"],
        credential: {
          envelope: { version: 1, algorithm: "A256GCM", keyVersion: "v1", iv: "aXY=", ciphertext: "Y2lwaGVydGV4dA==" },
          scopes: ["read_products"],
          accessTokenExpiresAt: "2026-09-28T12:00:00.000Z",
          refreshTokenExpiresAt: "2026-12-28T12:00:00.000Z",
        },
      }),
    }));
    expect(connection.status).toBe(200);

    await runInDurableObject(stub, async (_instance, state) => {
      const timestamp = "2026-09-28T07:00:00.000Z";
      state.storage.sql.exec("INSERT INTO products (id, name, status, created_at, updated_at) VALUES ('p1', 'Tee', 'active', ?, ?)", timestamp, timestamp);
      state.storage.sql.exec(
        `INSERT INTO product_variants (id, product_id, name, sku, barcode, price_minor, cost_minor, tax_rate_bps, active, created_at, updated_at)
         VALUES ('v1', 'p1', 'Default', 'SHARED-SKU', 'SHARED-BAR', 1000, 400, 2000, 1, ?, ?)`,
        timestamp,
        timestamp,
      );
    });

    const discover = await stub.fetch(new Request("https://tenant.internal/__integrations/discovery/replace", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        connectionId,
        provider: "shopify",
        externalAccountId: "collision.myshopify.com",
        resource: "catalogue",
        entityType: "variant",
        entities: [
          { externalId: "gid://shopify/ProductVariant/1", displayName: "First", payload: { sku: "SHARED-SKU", barcode: "SHARED-BAR" } },
          { externalId: "gid://shopify/ProductVariant/2", displayName: "Second", payload: { sku: "SHARED-SKU", barcode: "SHARED-BAR" } },
        ],
      }),
    }));
    expect(discover.status).toBe(200);
    expect(await discover.json()).toMatchObject({ summary: { mapped: 0, suggested: 0, ambiguous: 2, unmatched: 0 } });

    const state = await stub.fetch(`https://tenant.internal/integrations/${connectionId}/mappings`).then(response => response.json<{
      counts: Record<string, number>;
      entities: Array<{ matchStatus: string; suggestion: unknown }>;
    }>());
    expect(state.counts).toMatchObject({ mapped: 0, suggested: 0, ambiguous: 2 });
    expect(state.entities.every(entity => entity.matchStatus === "ambiguous" && entity.suggestion === null)).toBe(true);

    const mapOne = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/mappings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-ordermate-actor-id": "owner-1", "x-ordermate-actor-role": "owner" },
      body: JSON.stringify({ mappings: [{ entityType: "variant", externalId: "gid://shopify/ProductVariant/1", localEntityId: "v1" }] }),
    }));
    expect(mapOne.status).toBe(200);
    expect(await mapOne.json()).toMatchObject({ counts: { mapped: 1, suggested: 0, ambiguous: 1, unmatched: 0 } });
  });
});
