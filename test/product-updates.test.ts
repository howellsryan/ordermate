import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

type Stub = DurableObjectStub<TenantStore>;

async function api<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "catalogue-editor",
    "x-ordermate-actor-role": "manager",
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

describe("catalogue updates", () => {
  it("updates live variant pricing while preserving an existing order snapshot", async () => {
    const stub = env.TENANT_STORES.getByName(`product-update-${crypto.randomUUID()}`);
    const sku = `PRICE-${crypto.randomUUID().slice(0, 8)}`;

    const createdProduct = await api<{ id: string }>(stub, "/products", "POST", {
      name: "Snapshot product",
      category: "Test",
      variants: [{
        name: "Default",
        sku,
        barcode: "5012345678900",
        priceMinor: 1000,
        costMinor: 400,
        taxRateBps: 2000,
        options: {},
      }],
    });
    expect(createdProduct.response.status).toBe(201);

    const products = await api<Array<{ id: string; name: string; variants: Array<{ id: string; name: string; sku: string; barcode: string; price_minor: number; cost_minor: number; tax_rate_bps: number }> }>>(stub, "/products");
    const product = products.data[0];
    const variant = product.variants[0];

    const location = await api<{ id: string }>(stub, "/locations", "POST", { name: "Main", code: `M${crypto.randomUUID().slice(0, 4)}` });
    expect(location.response.status).toBe(201);

    const order = await api<{ id: string }>(stub, "/orders", "POST", {
      locationId: location.data.id,
      lines: [{ variantId: variant.id, quantity: 2 }],
    });
    expect(order.response.status).toBe(201);

    const updated = await api(stub, `/products/${product.id}`, "PATCH", {
      name: "Snapshot product renamed",
      category: "Updated",
      description: "Current catalogue copy",
      variants: [{
        id: variant.id,
        name: "Default",
        sku,
        barcode: "5012345678900",
        priceMinor: 1500,
        costMinor: 450,
        taxRateBps: 2000,
      }],
    });
    expect(updated.response.ok).toBe(true);

    const refreshed = await api<Array<{ name: string; category_name: string; variants: Array<{ price_minor: number; cost_minor: number }> }>>(stub, "/products");
    expect(refreshed.data[0].name).toBe("Snapshot product renamed");
    expect(refreshed.data[0].category_name).toBe("Updated");
    expect(refreshed.data[0].variants[0].price_minor).toBe(1500);
    expect(refreshed.data[0].variants[0].cost_minor).toBe(450);

    const orderDetail = await api<{ lines: Array<{ unit_price_minor: number; product_name_snapshot: string }> }>(stub, `/orders/${order.data.id}`);
    expect(orderDetail.data.lines[0].unit_price_minor).toBe(1000);
    expect(orderDetail.data.lines[0].product_name_snapshot).toBe("Snapshot product");

    const audit = await api<Array<{ action: string; entity_id: string }>>(stub, "/audit");
    expect(audit.data.some(event => event.action === "product.updated" && event.entity_id === product.id)).toBe(true);
  });
});
