import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

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

async function createLocation(stub: Stub, code = `L${crypto.randomUUID().slice(0, 5)}`) {
  const { response, data } = await request<{ id: string }>(stub, "/locations", "POST", {
    name: "Main warehouse",
    code,
  });
  expect(response.status).toBe(201);
  return data.id;
}

async function createVariant(stub: Stub, sku = `SKU-${crypto.randomUUID().slice(0, 8)}`) {
  const barcode = `50${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`;
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Test product",
    category: "Test",
    variants: [{
      name: "Default",
      sku,
      barcode,
      priceMinor: 1999,
      costMinor: 800,
      taxRateBps: 2000,
      options: {},
    }],
  });
  expect(created.response.status).toBe(201);

  const listed = await request<Array<{ variants: Array<{ id: string; sku: string; barcode: string }> }>>(stub, "/products");
  const variant = listed.data.flatMap(product => product.variants).find(item => item.sku === sku)!;
  return { id: variant.id, barcode };
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
    const variant = await createVariant(stub);
    await adjust(stub, variant.id, locationId, 10);

    const firstOrder = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId,
      lines: [{ variantId: variant.id, quantity: 3 }],
    });
    expect(firstOrder.response.status).toBe(201);

    const confirmed = await request(stub, `/orders/${firstOrder.data.id}/confirm`, "POST", {});
    expect(confirmed.response.ok).toBe(true);

    let inventory = await request<Array<{ variant_id: string; reserved: number; available: number }>>(stub, "/inventory");
    const firstLevel = inventory.data.find(row => row.variant_id === variant.id)!;
    expect(firstLevel.reserved).toBe(3);
    expect(firstLevel.available).toBe(7);

    const secondOrder = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId,
      lines: [{ variantId: variant.id, quantity: 8 }],
    });
    const rejected = await request(stub, `/orders/${secondOrder.data.id}/confirm`, "POST", {});
    expect(rejected.response.status).toBe(409);

    const cancelled = await request(stub, `/orders/${firstOrder.data.id}/cancel`, "POST", {});
    expect(cancelled.response.ok).toBe(true);

    inventory = await request<Array<{ variant_id: string; reserved: number; available: number }>>(stub, "/inventory");
    const releasedLevel = inventory.data.find(row => row.variant_id === variant.id)!;
    expect(releasedLevel.reserved).toBe(0);
    expect(releasedLevel.available).toBe(10);
  });

  it("supports partial fulfilment without losing the remaining reservation", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variant = await createVariant(stub);
    await adjust(stub, variant.id, locationId, 10);

    const order = await request<{ id: string; number: string }>(stub, "/orders", "POST", {
      locationId,
      lines: [{ variantId: variant.id, quantity: 5 }],
    });
    expect(order.data.number).toBe("ORD-2026-000001");
    await request(stub, `/orders/${order.data.id}/confirm`, "POST", {});

    const detail = await request<{ lines: Array<{ id: string }> }>(stub, `/orders/${order.data.id}`);
    const lineId = detail.data.lines[0].id;

    const partial = await request(stub, `/orders/${order.data.id}/fulfil`, "POST", {
      lines: [{ lineId, quantity: 2 }],
    });
    expect(partial.response.ok).toBe(true);

    const afterPartial = await request<{ status: string; fulfilment_status: string; lines: Array<{ quantity_fulfilled: number }> }>(stub, `/orders/${order.data.id}`);
    expect(afterPartial.data.status).toBe("confirmed");
    expect(afterPartial.data.fulfilment_status).toBe("partially_fulfilled");
    expect(afterPartial.data.lines[0].quantity_fulfilled).toBe(2);

    let inventory = await request<Array<{ variant_id: string; on_hand: number; reserved: number; available: number }>>(stub, "/inventory");
    let level = inventory.data.find(row => row.variant_id === variant.id)!;
    expect(level.on_hand).toBe(8);
    expect(level.reserved).toBe(3);
    expect(level.available).toBe(5);

    const remainder = await request(stub, `/orders/${order.data.id}/fulfil`, "POST", {});
    expect(remainder.response.ok).toBe(true);

    const complete = await request<{ status: string; fulfilment_status: string; lines: Array<{ quantity_fulfilled: number }> }>(stub, `/orders/${order.data.id}`);
    expect(complete.data.status).toBe("completed");
    expect(complete.data.fulfilment_status).toBe("fulfilled");
    expect(complete.data.lines[0].quantity_fulfilled).toBe(5);

    inventory = await request<Array<{ variant_id: string; on_hand: number; reserved: number }>>(stub, "/inventory");
    level = inventory.data.find(row => row.variant_id === variant.id)! as typeof level;
    expect(level.on_hand).toBe(5);
    expect(level.reserved).toBe(0);
  });

  it("receives purchase-order stock through the immutable movement ledger", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variant = await createVariant(stub);

    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Test supplier" });
    expect(supplier.response.status).toBe(201);

    const purchaseOrder = await request<{ id: string; number: string }>(stub, "/purchase-orders", "POST", {
      supplierId: supplier.data.id,
      locationId,
      lines: [{ variantId: variant.id, quantity: 4, unitCostMinor: 700, taxRateBps: 2000 }],
    });
    expect(purchaseOrder.response.status).toBe(201);
    expect(purchaseOrder.data.number).toBe("PO-2026-000001");

    const submitted = await request(stub, `/purchase-orders/${purchaseOrder.data.id}/submit`, "POST", {});
    expect(submitted.response.ok).toBe(true);

    const detail = await request<{ lines: Array<{ id: string }> }>(stub, `/purchase-orders/${purchaseOrder.data.id}`);
    const lineId = detail.data.lines[0].id;

    const partial = await request(stub, `/purchase-orders/${purchaseOrder.data.id}/receive`, "POST", {
      lines: [{ lineId, quantity: 2 }],
    });
    expect(partial.response.ok).toBe(true);

    let inventory = await request<Array<{ variant_id: string; on_hand: number; incoming: number }>>(stub, "/inventory");
    let level = inventory.data.find(row => row.variant_id === variant.id)!;
    expect(level.on_hand).toBe(2);
    expect(level.incoming).toBe(2);

    const received = await request(stub, `/purchase-orders/${purchaseOrder.data.id}/receive`, "POST", {
      lines: [{ lineId, quantity: 2 }],
    });
    expect(received.response.ok).toBe(true);

    inventory = await request<Array<{ variant_id: string; on_hand: number; incoming: number }>>(stub, "/inventory");
    level = inventory.data.find(row => row.variant_id === variant.id)!;
    expect(level.on_hand).toBe(4);
    expect(level.incoming).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      const movements = state.storage.sql.exec<{ quantity_delta: number; movement_type: string }>(
        "SELECT quantity_delta, movement_type FROM inventory_movements WHERE reference_id = ? ORDER BY created_at",
        purchaseOrder.data.id,
      ).toArray();
      expect(movements).toHaveLength(2);
      expect(movements.every(movement => movement.quantity_delta === 2 && movement.movement_type === "purchase_receipt")).toBe(true);
    });
  });

  it("finds a sellable variant by barcode", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variant = await createVariant(stub, "SCAN-ME");
    await adjust(stub, variant.id, locationId, 6);

    const lookup = await request<{ sku: string; levels: Array<{ available: number }> }>(stub, `/inventory/barcode/${variant.barcode}`);
    expect(lookup.response.ok).toBe(true);
    expect(lookup.data.sku).toBe("SCAN-ME");
    expect(lookup.data.levels[0].available).toBe(6);
  });

  it("distinguishes tracked stock from never-stocked location combinations", async () => {
    const stub = tenant();
    const primaryLocationId = await createLocation(stub, "MAIN");
    const secondaryLocationId = await createLocation(stub, "SECOND");
    const variant = await createVariant(stub, "TRACKED-SKU");
    await adjust(stub, variant.id, primaryLocationId, 1);

    const inventory = await request<Array<{ variant_id: string; location_id: string; available: number; tracked: number }>>(stub, "/inventory");
    const primary = inventory.data.find(row => row.variant_id === variant.id && row.location_id === primaryLocationId)!;
    const secondary = inventory.data.find(row => row.variant_id === variant.id && row.location_id === secondaryLocationId)!;

    expect(primary.tracked).toBe(1);
    expect(primary.available).toBe(1);
    expect(secondary.tracked).toBe(0);
    expect(secondary.available).toBe(0);
  });

  it("exposes the immutable stock ledger through the runtime history endpoint", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub);
    const variant = await createVariant(stub, "LEDGER-SKU");
    await adjust(stub, variant.id, locationId, 4);

    const history = await request<Array<{ variant_id: string; sku: string; quantity_delta: number; movement_type: string; actor_id: string }>>(stub, "/inventory/movements");
    expect(history.response.ok).toBe(true);
    expect(history.data[0]).toMatchObject({
      variant_id: variant.id,
      sku: "LEDGER-SKU",
      quantity_delta: 4,
      movement_type: "adjustment",
      actor_id: "test-user",
    });
  });

  it("maps supplier catalogue data and produces an explainable replenishment suggestion", async () => {
    const stub = tenant();
    const locationId = await createLocation(stub, "REPLEN");
    const variant = await createVariant(stub, "REPLEN-SKU");
    await adjust(stub, variant.id, locationId, 1);

    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Mapped supplier" });
    expect(supplier.response.status).toBe(201);

    const mapped = await request(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId: variant.id,
      supplierSku: "SUP-REPLEN-1",
      lastCostMinor: 725,
      leadTimeDays: 12,
    });
    expect(mapped.response.ok).toBe(true);

    const mappings = await request<Array<{ supplier_id: string; variant_id: string; supplier_sku: string; last_cost_minor: number; lead_time_days: number }>>(stub, "/supplier-variants");
    expect(mappings.data).toContainEqual(expect.objectContaining({
      supplier_id: supplier.data.id,
      variant_id: variant.id,
      supplier_sku: "SUP-REPLEN-1",
      last_cost_minor: 725,
      lead_time_days: 12,
    }));

    const replenishment = await request<{ suggestions: Array<{ variant_id: string; location_id: string; recommended_quantity: number; projected_at_lead_time: number; effective_lead_time_days: number; suppliers: Array<{ supplierId: string; supplierSku: string; lastCostMinor: number; leadTimeDays: number }> }> }>(stub, "/replenishment");
    const suggestion = replenishment.data.suggestions.find(item => item.variant_id === variant.id && item.location_id === locationId)!;
    expect(suggestion).toBeTruthy();
    expect(suggestion.recommended_quantity).toBe(9);
    expect(suggestion.projected_at_lead_time).toBe(1);
    expect(suggestion.effective_lead_time_days).toBe(12);
    expect(suggestion.suppliers[0]).toMatchObject({
      supplierId: supplier.data.id,
      supplierSku: "SUP-REPLEN-1",
      lastCostMinor: 725,
      leadTimeDays: 12,
    });
  });
});
