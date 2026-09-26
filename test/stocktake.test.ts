import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { StocktakeResponse } from "../src/shared/stocktake";
import type { TenantStore } from "../src/worker/tenant-store-final";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`stocktake-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "stocktake-owner",
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

async function setup(stub: Stub) {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main warehouse", code: "MAIN" });
  expect(location.response.status).toBe(201);
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Counted product",
    variants: [
      { name: "Small", sku: "COUNT-S", barcode: "5012222222211", priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: { Size: "Small" } },
      { name: "Medium", sku: "COUNT-M", barcode: "5012222222228", priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: { Size: "Medium" } },
      { name: "Large", sku: "COUNT-L", barcode: "5012222222235", priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: { Size: "Large" } },
    ],
  });
  expect(created.response.status).toBe(201);
  const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
  const variants = Object.fromEntries(products.data.flatMap(product => product.variants).map(variant => [variant.sku, variant.id]));
  return { locationId: location.data.id, variants };
}

describe("cycle counts", () => {
  it("commits reviewed variances atomically with one stocktake reference and audit event", async () => {
    const stub = tenant();
    const { locationId, variants } = await setup(stub);
    await request(stub, "/inventory/adjust", "POST", { variantId: variants["COUNT-S"], locationId, quantityDelta: 10, reason: "Opening stock" });
    await request(stub, "/inventory/adjust", "POST", { variantId: variants["COUNT-M"], locationId, quantityDelta: 5, reason: "Opening stock" });

    const count = await request<StocktakeResponse>(stub, "/inventory/stocktake", "POST", {
      locationId,
      reason: "Aisle A cycle count",
      lines: [
        { variantId: variants["COUNT-S"], expectedOnHand: 10, expectedReserved: 0, countedOnHand: 8 },
        { variantId: variants["COUNT-M"], expectedOnHand: 5, expectedReserved: 0, countedOnHand: 7 },
      ],
    });
    expect(count.response.status).toBe(201);
    expect(count.data).toMatchObject({ ok: true, countedLines: 2, changedLines: 2, totalVariance: 0 });

    const inventory = await request<Array<{ sku: string; location_id: string; on_hand: number; reserved: number }>>(stub, "/inventory");
    expect(inventory.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "COUNT-S", location_id: locationId, on_hand: 8, reserved: 0 }),
      expect.objectContaining({ sku: "COUNT-M", location_id: locationId, on_hand: 7, reserved: 0 }),
    ]));

    await runInDurableObject(stub, async (_instance, state) => {
      const movements = state.storage.sql.exec<{ reference_id: string; quantity_delta: number; reason: string }>(
        "SELECT reference_id, quantity_delta, reason FROM inventory_movements WHERE movement_type = 'stocktake' ORDER BY quantity_delta",
      ).toArray();
      expect(movements).toHaveLength(2);
      expect(movements.map(item => item.quantity_delta)).toEqual([-2, 2]);
      expect(new Set(movements.map(item => item.reference_id))).toEqual(new Set([count.data.stocktakeId]));
      expect(movements.every(item => item.reason === "Aisle A cycle count")).toBe(true);

      const audit = state.storage.sql.exec<{ action: string; entity_id: string; metadata_json: string }>(
        "SELECT action, entity_id, metadata_json FROM audit_events WHERE action = 'stocktake.committed' ORDER BY created_at DESC LIMIT 1",
      ).toArray()[0];
      expect(audit.action).toBe("stocktake.committed");
      expect(audit.entity_id).toBe(count.data.stocktakeId);
      expect(JSON.parse(audit.metadata_json)).toMatchObject({ countedLines: 2, changedLines: 2, totalVariance: 0 });
    });
  });

  it("rejects the whole batch when stock changed after the operator reviewed it", async () => {
    const stub = tenant();
    const { locationId, variants } = await setup(stub);
    await request(stub, "/inventory/adjust", "POST", { variantId: variants["COUNT-S"], locationId, quantityDelta: 10, reason: "Opening stock" });
    await request(stub, "/inventory/adjust", "POST", { variantId: variants["COUNT-S"], locationId, quantityDelta: 1, reason: "Concurrent receipt" });

    const count = await request<{ error: string }>(stub, "/inventory/stocktake", "POST", {
      locationId,
      lines: [
        { variantId: variants["COUNT-S"], expectedOnHand: 10, expectedReserved: 0, countedOnHand: 8 },
        { variantId: variants["COUNT-M"], expectedOnHand: 0, expectedReserved: 0, countedOnHand: 4 },
      ],
    });
    expect(count.response.status).toBe(409);
    expect(count.data.error).toMatch(/Stock changed while you were counting/i);

    const inventory = await request<Array<{ sku: string; on_hand: number }>>(stub, "/inventory");
    expect(inventory.data.find(row => row.sku === "COUNT-S")?.on_hand).toBe(11);
    expect(inventory.data.find(row => row.sku === "COUNT-M")?.on_hand).toBe(0);

    await runInDurableObject(stub, async (_instance, state) => {
      const countMovements = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_movements WHERE movement_type = 'stocktake'").toArray()[0].count;
      expect(countMovements).toBe(0);
    });
  });

  it("blocks a physical count below stock already reserved to confirmed orders", async () => {
    const stub = tenant();
    const { locationId, variants } = await setup(stub);
    await request(stub, "/inventory/adjust", "POST", { variantId: variants["COUNT-S"], locationId, quantityDelta: 10, reason: "Opening stock" });
    const order = await request<{ id: string }>(stub, "/orders", "POST", { locationId, lines: [{ variantId: variants["COUNT-S"], quantity: 3 }] });
    expect(order.response.status).toBe(201);
    expect((await request(stub, `/orders/${order.data.id}/confirm`, "POST", {})).response.ok).toBe(true);

    const count = await request<{ error: string }>(stub, "/inventory/stocktake", "POST", {
      locationId,
      lines: [{ variantId: variants["COUNT-S"], expectedOnHand: 10, expectedReserved: 3, countedOnHand: 2 }],
    });
    expect(count.response.status).toBe(409);
    expect(count.data.error).toMatch(/reserved units/i);

    const inventory = await request<Array<{ sku: string; on_hand: number; reserved: number }>>(stub, "/inventory");
    expect(inventory.data.find(row => row.sku === "COUNT-S")).toMatchObject({ on_hand: 10, reserved: 3 });
  });

  it("can explicitly establish a never-stocked SKU as a tracked zero position", async () => {
    const stub = tenant();
    const { locationId, variants } = await setup(stub);

    const count = await request<StocktakeResponse>(stub, "/inventory/stocktake", "POST", {
      locationId,
      reason: "Shelf verified empty",
      lines: [{ variantId: variants["COUNT-L"], expectedOnHand: 0, expectedReserved: 0, countedOnHand: 0 }],
    });
    expect(count.response.status).toBe(201);
    expect(count.data).toMatchObject({ countedLines: 1, changedLines: 0, totalVariance: 0 });

    const inventory = await request<Array<{ sku: string; on_hand: number; tracked: number }>>(stub, "/inventory");
    expect(inventory.data.find(row => row.sku === "COUNT-L")).toMatchObject({ on_hand: 0, tracked: 1 });

    await runInDurableObject(stub, async (_instance, state) => {
      const movementCount = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_movements WHERE movement_type = 'stocktake'").toArray()[0].count;
      expect(movementCount).toBe(0);
    });
  });
});
