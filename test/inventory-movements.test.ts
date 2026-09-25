import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

type Stub = DurableObjectStub<TenantStore>;

type Movement = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  quantity_delta: number;
  movement_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  actor_id: string;
  created_at: string;
};

async function api<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "movement-test-user",
    "x-ordermate-actor-role": "owner",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>();
  return { response, data };
}

describe("inventory movement history", () => {
  it("reads the immutable movement rows with signed quantities and transfer reference", async () => {
    const stub = env.TENANT_STORES.getByName(`movement-${crypto.randomUUID()}`);

    const product = await api<{ id: string }>(stub, "/products", "POST", {
      name: "Movement test product",
      variants: [{
        name: "Default",
        sku: `MOVE-${crypto.randomUUID().slice(0, 8)}`,
        priceMinor: 1200,
        costMinor: 500,
        taxRateBps: 2000,
        options: {},
      }],
    });
    expect(product.response.status).toBe(201);

    const products = await api<Array<{ variants: Array<{ id: string }> }>>(stub, "/products");
    const variantId = products.data[0].variants[0].id;

    const source = await api<{ id: string }>(stub, "/locations", "POST", { name: "Source", code: `S${crypto.randomUUID().slice(0, 4)}` });
    const destination = await api<{ id: string }>(stub, "/locations", "POST", { name: "Destination", code: `D${crypto.randomUUID().slice(0, 4)}` });
    expect(source.response.status).toBe(201);
    expect(destination.response.status).toBe(201);

    const adjusted = await api(stub, "/inventory/adjust", "POST", {
      variantId,
      locationId: source.data.id,
      quantityDelta: 10,
      reason: "Initial count",
    });
    expect(adjusted.response.ok).toBe(true);

    const transferred = await api(stub, "/inventory/transfer", "POST", {
      variantId,
      fromLocationId: source.data.id,
      toLocationId: destination.data.id,
      quantity: 3,
    });
    expect(transferred.response.ok).toBe(true);

    const history = await api<Movement[]>(stub, "/inventory/movements");
    expect(history.response.ok).toBe(true);
    expect(history.data).toHaveLength(3);

    const adjustment = history.data.find(item => item.movement_type === "adjustment")!;
    expect(adjustment.quantity_delta).toBe(10);
    expect(adjustment.reason).toBe("Initial count");
    expect(adjustment.actor_id).toBe("movement-test-user");

    const outbound = history.data.find(item => item.movement_type === "transfer_out")!;
    const inbound = history.data.find(item => item.movement_type === "transfer_in")!;
    expect(outbound.quantity_delta).toBe(-3);
    expect(inbound.quantity_delta).toBe(3);
    expect(outbound.reference_type).toBe("transfer");
    expect(inbound.reference_type).toBe("transfer");
    expect(outbound.reference_id).toBeTruthy();
    expect(outbound.reference_id).toBe(inbound.reference_id);
  });
});
