import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store";

type Stub = DurableObjectStub<TenantStore>;

function tenant(name = crypto.randomUUID()): Stub {
  return env.TENANT_STORES.getByName(name);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown): Promise<{ response: Response; data: T }> {
  const headers = new Headers({
    "x-ordermate-actor-id": "test-user",
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

async function createLocation(stub: Stub, code = "MAIN") {
  const { response, data } = await request<{ id: string }>(stub, "/locations", "POST", {
    name: "Main warehouse",
    code,
  });
  expect(response.status).toBe(201);
  return data.id;
}

async function createVariant(stub: Stub, sku = `SKU-${crypto.randomUUID().slice(0, 8)}`) {
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Test product",
    category: "Test",
    variants: [{
      name: "Default",
      sku,
      barcode: `50${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`,
      priceMinor: 1999,
      costMinor: 800,
      taxRateBps: 2000,
      options: {},
    }],
  });
  expect(created.response.status).toBe(201);

  const listed = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
  return listed.data.flatMap(product => product.variants).find(variant => variant.sku === sku)!.id;
}

async function adjust(stub: Stub, variantId: string, locationId: string, quantityDelta: number) {
  const result = await request(stub, "/inventory/adjust", "POST", {
    variantId,
    locationId,
    quantityDelta,
    reason: "Test stock setup",
  });
  expect(result.response.ok).toBe(true);
}

describe("TenantStore isolation", () => {
  it("physically isolates catalogue data between tenant objects", async () => {
    const tenantA = tenant(`a-${crypto.randomUUID()}`);
    const tenantB = tenant(`b-${crypto.randomUUID()}`);

    await createVariant(tenantA, "A-ONLY-SKU");

    const productsA = await request<Array<{ name: string }>>(tenantA, "/products");
    const productsB = await request<Array<{ name: string }>>(tenantB, "/products");

    expect(productsA.data).toHaveLength(1);
    expect(productsB.data).toEqual([]);
  });
});

describe("inventory consistency", () => {
  it("reserves available stock, prevents overselling and releases a cancelled order", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variantId = await createVariant(stub);
    await adjust(stub, variantId, locationId, 10);

    const firstOrder = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId,
      lines: [{ variantId, quantity: 3 }],
    });
    expect(firstOrder.response.status).toBe(201);

    const confirmed = await request(stub, `/orders/${firstOrder.data.id}/confirm`, "POST", {});
    expect(confirmed.response.ok).toBe(true);

    let inventory = await request<Array<{ variant_id: string; reserved: number; available: number }>>(stub, "/inventory");
    const firstLevel = inventory.data.find(row => row.variant_id === variantId)!;
    expect(firstLevel.reserved).toBe(3);
    expect(firstLevel.available).toBe(7);

    const secondOrder = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId,
      lines: [{ variantId, quantity: 8 }],
    });
    const rejected = await request(stub, `/orders/${secondOrder.data.id}/confirm`, "POST", {});
    expect(rejected.response.ok).toBe(false);

    const cancelled = await request(stub, `/orders/${firstOrder.data.id}/cancel`, "POST", {});
    expect(cancelled.response.ok).toBe(true);

    inventory = await request<Array<{ variant_id: string; reserved: number; available: number }>>(stub, "/inventory");
    const releasedLevel = inventory.data.find(row => row.variant_id === variantId)!;
    expect(releasedLevel.reserved).toBe(0);
    expect(releasedLevel.available).toBe(10);
  });

  it("receives purchase-order stock through the immutable movement ledger", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variantId = await createVariant(stub);

    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Test supplier" });
    expect(supplier.response.status).toBe(201);

    const purchaseOrder = await request<{ id: string }>(stub, "/purchase-orders", "POST", {
      supplierId: supplier.data.id,
      locationId,
      lines: [{ variantId, quantity: 4, unitCostMinor: 700, taxRateBps: 2000 }],
    });
    expect(purchaseOrder.response.status).toBe(201);

    const submitted = await request(stub, `/purchase-orders/${purchaseOrder.data.id}/submit`, "POST", {});
    expect(submitted.response.ok).toBe(true);

    const lineId = await runInDurableObject(stub, async (_instance, state) => {
      return state.storage.sql.exec<{ id: string }>(
        "SELECT id FROM purchase_order_lines WHERE purchase_order_id = ?",
        purchaseOrder.data.id,
      ).one().id;
    });

    const received = await request(stub, `/purchase-orders/${purchaseOrder.data.id}/receive`, "POST", {
      lines: [{ lineId, quantity: 4 }],
    });
    expect(received.response.ok).toBe(true);

    const inventory = await request<Array<{ variant_id: string; on_hand: number; incoming: number }>>(stub, "/inventory");
    const level = inventory.data.find(row => row.variant_id === variantId)!;
    expect(level.on_hand).toBe(4);
    expect(level.incoming).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      const movement = state.storage.sql.exec<{ quantity_delta: number; movement_type: string }>(
        "SELECT quantity_delta, movement_type FROM inventory_movements WHERE reference_id = ?",
        purchaseOrder.data.id,
      ).one();
      expect(movement.quantity_delta).toBe(4);
      expect(movement.movement_type).toBe("purchase_receipt");
    });
  });
});
