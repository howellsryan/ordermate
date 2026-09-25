import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`maintenance-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown): Promise<{ response: Response; data: T }> {
  const headers = new Headers({
    "x-ordermate-actor-id": "maintenance-user",
    "x-ordermate-actor-role": "owner",
    "content-type": "application/json",
  });
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>();
  return { response, data };
}

async function createProduct(stub: Stub) {
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Retirement test product",
    variants: [{
      name: "Default",
      sku: `RET-${crypto.randomUUID().slice(0, 7)}`,
      barcode: `88${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`,
      priceMinor: 1500,
      costMinor: 600,
      taxRateBps: 2000,
      options: {},
    }],
  });
  expect(created.response.status).toBe(201);
  const products = await request<Array<{ id: string; status: string; variants: Array<{ id: string; active: number }> }>>(stub, "/products");
  return { productId: products.data[0].id, variantId: products.data[0].variants[0].id };
}

describe("record maintenance", () => {
  it("updates suppliers and customers without replacing their identities", async () => {
    const stub = tenant();
    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", {
      name: "Original Supplier",
      email: "old-supplier@example.com",
    });
    const customer = await request<{ id: string }>(stub, "/customers", "POST", {
      name: "Original Customer",
      email: "old-customer@example.com",
    });

    expect((await request(stub, `/suppliers/${supplier.data.id}`, "PATCH", {
      name: "Updated Supplier",
      email: "supplier@example.com",
      phone: "01234 567890",
      notes: "Preferred purchasing contact",
    })).response.ok).toBe(true);
    expect((await request(stub, `/customers/${customer.data.id}`, "PATCH", {
      name: "Updated Customer",
      email: "customer@example.com",
      phone: "07123 456789",
      notes: "Call before dispatch",
    })).response.ok).toBe(true);

    const suppliers = await request<Array<{ id: string; name: string; email: string; phone: string; notes: string }>>(stub, "/suppliers");
    const customers = await request<Array<{ id: string; name: string; email: string; phone: string; notes: string }>>(stub, "/customers");

    expect(suppliers.data).toContainEqual(expect.objectContaining({
      id: supplier.data.id,
      name: "Updated Supplier",
      email: "supplier@example.com",
      phone: "01234 567890",
      notes: "Preferred purchasing contact",
    }));
    expect(customers.data).toContainEqual(expect.objectContaining({
      id: customer.data.id,
      name: "Updated Customer",
      email: "customer@example.com",
      phone: "07123 456789",
      notes: "Call before dispatch",
    }));
  });

  it("archives a product without hiding tracked stock or rewriting its identity", async () => {
    const stub = tenant();
    const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main", code: "MAIN" });
    const { productId, variantId } = await createProduct(stub);
    await request(stub, "/inventory/adjust", "POST", {
      variantId,
      locationId: location.data.id,
      quantityDelta: 3,
      reason: "Opening stock",
    });

    const archived = await request<{ ok: boolean; status: string }>(stub, `/products/${productId}/status`, "PATCH", { status: "archived" });
    expect(archived.response.ok).toBe(true);
    expect(archived.data.status).toBe("archived");

    const productsAfterArchive = await request<Array<{ id: string; status: string; variants: Array<{ id: string; active: number }> }>>(stub, "/products");
    const archivedProduct = productsAfterArchive.data.find(product => product.id === productId)!;
    expect(archivedProduct.status).toBe("archived");
    expect(archivedProduct.variants[0].active).toBe(0);

    const inventory = await request<Array<{ variant_id: string; on_hand: number; tracked: number }>>(stub, "/inventory");
    expect(inventory.data).toContainEqual(expect.objectContaining({ variant_id: variantId, on_hand: 3, tracked: 1 }));

    const blockedOrder = await request(stub, "/orders", "POST", {
      locationId: location.data.id,
      lines: [{ variantId, quantity: 1 }],
    });
    expect(blockedOrder.response.status).toBe(400);

    const replenishment = await request<{ suggestions: Array<{ variant_id: string }> }>(stub, "/replenishment");
    expect(replenishment.data.suggestions.some(item => item.variant_id === variantId)).toBe(false);

    const restored = await request<{ ok: boolean; status: string }>(stub, `/products/${productId}/status`, "PATCH", { status: "active" });
    expect(restored.response.ok).toBe(true);
    expect(restored.data.status).toBe("active");

    const restoredOrder = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId: location.data.id,
      lines: [{ variantId, quantity: 1 }],
    });
    expect(restoredOrder.response.status).toBe(201);
  });
});
