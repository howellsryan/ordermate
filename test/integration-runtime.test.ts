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
    capabilities: ["catalogue:import", "orders:import"],
    credential: {
      envelope: {
        version: 1,
        algorithm: "A256GCM",
        keyVersion: "v1",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      scopes: ["read_products", "read_orders"],
      accessTokenExpiresAt: "2026-09-27T16:00:00.000Z",
      refreshTokenExpiresAt: "2026-12-26T15:00:00.000Z",
    },
  };
}

describe("tenant integration runtime", () => {
  it("keeps encrypted credentials off public connection reads", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();

    const write = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(connectionBody(connectionId)),
    }));
    expect(write.status).toBe(200);

    const list = await stub.fetch("https://tenant.internal/integrations");
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).toContain("example.myshopify.com");
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("Y2lwaGVydGV4dA==");
    expect(text).not.toContain("accessTokenExpiresAt");
  });

  it("blocks internal credential routes without the Worker-only marker", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const response = await stub.fetch("https://tenant.internal/__integrations/credentials/anything");
    expect(response.status).toBe(404);
  });

  it("deduplicates Shopify delivery IDs without duplicating tenant events", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();
    await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(connectionBody(connectionId)),
    }));

    const event = {
      connectionId,
      provider: "shopify",
      providerEventId: "delivery-123",
      providerActionId: "action-123",
      topic: "orders/create",
      externalAccountId: "example.myshopify.com",
      occurredAt: "2026-09-27T15:00:00.000Z",
      apiVersion: "2026-07",
      payloadJson: JSON.stringify({ id: 123 }),
    };
    const first = await stub.fetch(new Request("https://tenant.internal/__integrations/events/receive", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(event),
    }));
    expect(first.status).toBe(202);
    const firstBody = await first.json<{ id: string; duplicate: boolean }>();
    expect(firstBody.duplicate).toBe(false);

    const replay = await stub.fetch(new Request("https://tenant.internal/__integrations/events/receive", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(event),
    }));
    expect(replay.status).toBe(200);
    const replayBody = await replay.json<{ id: string; duplicate: boolean }>();
    expect(replayBody).toEqual({ id: firstBody.id, duplicate: true });

    await runInDurableObject(stub, async (_instance, state) => {
      const count = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM integration_events").toArray()[0]?.count ?? 0;
      expect(count).toBe(1);
    });
  });

  it("physically isolates integration state between tenant Durable Objects", async () => {
    const first = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const second = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();

    await first.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(connectionBody(connectionId)),
    }));

    const firstList = await first.fetch("https://tenant.internal/integrations").then(response => response.json<{ connections: unknown[] }>());
    const secondList = await second.fetch("https://tenant.internal/integrations").then(response => response.json<{ connections: unknown[] }>());
    expect(firstList.connections).toHaveLength(1);
    expect(secondList.connections).toHaveLength(0);
  });
});
