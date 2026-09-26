import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`supplier-terms-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "buyer-user",
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

describe("supplier buying terms", () => {
  it("persists MOQ/multiple atomically with the mapping, audits the change and returns an order-ready replenishment quantity", async () => {
    const stub = tenant();
    const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main warehouse", code: `M${crypto.randomUUID().slice(0, 5)}` });
    expect(location.response.status).toBe(201);

    const sku = `MOQ-${crypto.randomUUID().slice(0, 8)}`;
    const product = await request<{ id: string }>(stub, "/products", "POST", {
      name: "Case packed item",
      variants: [{ name: "Default", sku, priceMinor: 2000, costMinor: 900, taxRateBps: 2000, options: {} }],
    });
    expect(product.response.status).toBe(201);
    const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
    const variantId = products.data.flatMap(item => item.variants).find(item => item.sku === sku)!.id;

    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Case Supplier" });
    expect(supplier.response.status).toBe(201);

    const mapping = await request(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId,
      supplierSku: "CASE-12",
      lastCostMinor: 850,
      leadTimeDays: 7,
      minimumOrderQuantity: 12,
      orderMultiple: 12,
    });
    expect(mapping.response.ok).toBe(true);

    await request(stub, "/inventory/adjust", "POST", { variantId, locationId: location.data.id, quantityDelta: 2, reason: "Initial stock" });
    const policy = await request(stub, "/inventory-policies", "PUT", {
      variantId,
      locationId: location.data.id,
      reorderPoint: 4,
      targetStock: 15,
      preferredSupplierId: supplier.data.id,
    });
    expect(policy.response.ok).toBe(true);

    const mappings = await request<Array<{ minimum_order_quantity: number | null; order_multiple: number | null }>>(stub, "/supplier-variants");
    expect(mappings.data[0]).toMatchObject({ minimum_order_quantity: 12, order_multiple: 12 });

    const replenishment = await request<{ suggestions: Array<{ recommended_quantity: number; scenarios: { minimum: number; recommended: number; maximum: number }; explanation: string[] }> }>(stub, "/replenishment");
    expect(replenishment.data.suggestions).toHaveLength(1);
    expect(replenishment.data.suggestions[0].recommended_quantity).toBe(24);
    expect(replenishment.data.suggestions[0].scenarios.recommended).toBe(24);
    expect(replenishment.data.suggestions[0].explanation.some(line => line.includes("order-ready"))).toBe(true);

    await runInDurableObject(stub, async (_instance, state) => {
      const audit = state.storage.sql.exec<{ action: string; entity_id: string | null; metadata_json: string | null }>(
        "SELECT action, entity_id, metadata_json FROM audit_events WHERE action = 'supplier_variant.updated' ORDER BY created_at DESC LIMIT 1",
      ).toArray()[0];
      expect(audit.action).toBe("supplier_variant.updated");
      expect(audit.entity_id).toBe(`${supplier.data.id}:${variantId}`);
      expect(JSON.parse(audit.metadata_json || "{}")).toMatchObject({ minimumOrderQuantity: 12, orderMultiple: 12 });
    });
  });

  it("rejects invalid buying terms before mutating the supplier mapping", async () => {
    const stub = tenant();
    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Supplier" });
    const sku = `BAD-${crypto.randomUUID().slice(0, 8)}`;
    await request(stub, "/products", "POST", {
      name: "Item",
      variants: [{ name: "Default", sku, priceMinor: 1000, costMinor: 500, taxRateBps: 2000, options: {} }],
    });
    const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
    const variantId = products.data.flatMap(item => item.variants).find(item => item.sku === sku)!.id;

    const invalid = await request<{ error: string }>(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId,
      minimumOrderQuantity: 0,
      orderMultiple: 12,
    });
    expect(invalid.response.status).toBe(400);

    const mappings = await request<unknown[]>(stub, "/supplier-variants");
    expect(mappings.data).toEqual([]);
  });
});
