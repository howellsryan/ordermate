import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-final";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`supplier-sku-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "supplier-learning-owner",
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

describe("supplier SKU mapping uniqueness", () => {
  it("allows one supplier code per variant but rejects the same supplier code on another variant", async () => {
    const stub = tenant();
    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Acme" });
    expect(supplier.response.status).toBe(201);

    const created = await request<{ id: string }>(stub, "/products", "POST", {
      name: "Supplier mapping product",
      variants: [
        { name: "Small", sku: "MAP-S", barcode: "5011111111111", priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: { Size: "Small" } },
        { name: "Medium", sku: "MAP-M", barcode: "5011111111128", priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: { Size: "Medium" } },
      ],
    });
    expect(created.response.status).toBe(201);

    const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
    const small = products.data.flatMap(product => product.variants).find(variant => variant.sku === "MAP-S")!;
    const medium = products.data.flatMap(product => product.variants).find(variant => variant.sku === "MAP-M")!;

    const first = await request(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId: small.id,
      supplierSku: "Acme-001",
      lastCostMinor: 390,
      leadTimeDays: 5,
    });
    expect(first.response.ok).toBe(true);

    const sameVariantUpdate = await request(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId: small.id,
      supplierSku: " ACME-001 ",
      lastCostMinor: 380,
      leadTimeDays: 6,
    });
    expect(sameVariantUpdate.response.ok).toBe(true);

    const conflict = await request<{ error: string }>(stub, "/supplier-variants", "POST", {
      supplierId: supplier.data.id,
      variantId: medium.id,
      supplierSku: "acme-001",
      lastCostMinor: 400,
      leadTimeDays: 7,
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.data.error).toMatch(/already mapped/i);

    const mappings = await request<Array<{ variant_id: string; supplier_sku: string }>>(stub, "/supplier-variants");
    expect(mappings.data).toHaveLength(1);
    expect(mappings.data[0]).toMatchObject({ variant_id: small.id, supplier_sku: "ACME-001" });
  });
});
