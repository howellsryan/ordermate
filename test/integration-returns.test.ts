import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const internalHeaders = {
  "x-operating-layer-internal-integration": "integration-v1",
  "x-ordermate-actor-id": "integration:shopify:example.myshopify.com",
  "x-ordermate-actor-role": "integration",
  "x-ordermate-actor-name": "Shopify",
  "content-type": "application/json",
};

const operatorHeaders = {
  "x-ordermate-actor-id": "manager-1",
  "x-ordermate-actor-role": "manager",
  "x-ordermate-actor-name": "Operations manager",
  "content-type": "application/json",
};

function connectionBody(id: string) {
  return {
    id,
    provider: "shopify",
    externalAccountId: "example.myshopify.com",
    displayName: "Example Shopify",
    status: "active",
    capabilities: ["orders:import", "returns:import", "inventory:publish"],
    credential: {
      envelope: {
        version: 1,
        algorithm: "A256GCM",
        keyVersion: "v1",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      scopes: ["read_orders", "read_returns", "write_inventory"],
      accessTokenExpiresAt: "2027-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2027-03-01T00:00:00.000Z",
    },
  };
}

describe("Shopify return reconciliation", () => {
  it("records a refund as pending RMA work without treating it as a restock", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();

    const connection = await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(connectionBody(connectionId)),
    }));
    expect(connection.status).toBe(200);

    const observed = await stub.fetch(new Request("https://tenant.internal/__integrations/returns/observe", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        connectionId,
        topic: "refunds/create",
        payloadJson: JSON.stringify({ id: 555, order_id: 12345 }),
      }),
    }));
    expect(observed.status).toBe(200);

    const operations = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/operations`, {
      headers: operatorHeaders,
    }));
    expect(operations.status).toBe(200);
    const payload = await operations.json<{
      health: { pendingReturns: number };
      returns: Array<{
        id: string;
        externalReturnId: string;
        refundObserved: boolean;
        disposition: string;
        restockedAt: string | null;
      }>;
    }>();

    expect(payload.health.pendingReturns).toBe(1);
    expect(payload.returns).toHaveLength(1);
    expect(payload.returns[0]).toMatchObject({
      externalReturnId: "refund:555",
      refundObserved: true,
      disposition: "pending",
      restockedAt: null,
    });
  });

  it("requires an operator disposition and can explicitly close a refund as no-restock", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    const connectionId = crypto.randomUUID();
    await stub.fetch(new Request("https://tenant.internal/__integrations/connections/upsert", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify(connectionBody(connectionId)),
    }));
    await stub.fetch(new Request("https://tenant.internal/__integrations/returns/observe", {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        connectionId,
        topic: "refunds/create",
        payloadJson: JSON.stringify({ id: 777, order_id: 45678 }),
      }),
    }));

    const before = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/operations`, { headers: operatorHeaders }));
    const pending = await before.json<{ returns: Array<{ id: string; disposition: string }> }>();
    const returnCase = pending.returns[0];
    expect(returnCase?.disposition).toBe("pending");

    const disposition = await stub.fetch(new Request(`https://tenant.internal/integrations/${connectionId}/returns/${returnCase.id}/disposition`, {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({ disposition: "no_restock", notes: "Refunded but item was not returned to sellable stock." }),
    }));
    expect(disposition.status).toBe(200);
    const result = await disposition.json<{ case: { disposition: string; restockedAt: string | null } }>();
    expect(result.case.disposition).toBe("no_restock");
    expect(result.case.restockedAt).toBeNull();
  });
});
