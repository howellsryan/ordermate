import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-planning";

type Stub = DurableObjectStub<TenantStore>;

async function call<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-ordermate-actor-id": "planning-test",
      "x-ordermate-actor-role": "owner",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { response, data: await response.json<T>() };
}

describe("custom replenishment arrival targets", () => {
  it("adds expected supplier lead-time demand to the quantity needed at arrival", async () => {
    const stub = env.TENANT_STORES.getByName(`arrival-target-${crypto.randomUUID()}`);
    const location = await call<{ id: string }>(stub, "/locations", "POST", { name: "Main", code: `M${crypto.randomUUID().slice(0, 5)}` });
    const sku = `ARR-${crypto.randomUUID().slice(0, 8)}`;
    await call(stub, "/products", "POST", {
      name: "Arrival target product",
      variants: [{ name: "Default", sku, barcode: `77${Date.now()}`, priceMinor: 1500, costMinor: 700, taxRateBps: 2000, options: {} }],
    });
    const products = await call<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
    const variantId = products.data.flatMap(product => product.variants).find(variant => variant.sku === sku)!.id;
    const supplier = await call<{ id: string }>(stub, "/suppliers", "POST", { name: "Ten-day supplier" });
    await call(stub, "/supplier-variants", "POST", { supplierId: supplier.data.id, variantId, supplierSku: "ARR-SUP", lastCostMinor: 650, leadTimeDays: 10 });
    await call(stub, "/inventory/adjust", "POST", { variantId, locationId: location.data.id, quantityDelta: 2, reason: "Opening stock" });
    await call(stub, "/inventory-policies", "PUT", {
      variantId,
      locationId: location.data.id,
      reorderPoint: 4,
      targetStock: 15,
      preferredSupplierId: supplier.data.id,
    });

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO inventory_movements (
          id, variant_id, location_id, quantity_delta, movement_type,
          reference_type, reference_id, reason, actor_id, created_at
        ) VALUES (?, ?, ?, -30, 'order_fulfilment', 'test', 'historic-demand', 'Demand fixture', 'planning-test', ?)`,
        crypto.randomUUID(), variantId, location.data.id, new Date().toISOString(),
      );
    });

    const response = await call<{ suggestions: Array<{ average_daily_demand: number; effective_lead_time_days: number; projected_at_lead_time: number; target_stock: number; recommended_quantity: number }> }>(stub, "/replenishment");
    expect(response.data.suggestions).toHaveLength(1);
    expect(response.data.suggestions[0]).toMatchObject({
      average_daily_demand: 1,
      effective_lead_time_days: 10,
      projected_at_lead_time: -8,
      target_stock: 15,
      recommended_quantity: 23,
    });
  });
});
