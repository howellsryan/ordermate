import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Product } from "../src/client/model";
import type { TenantStore } from "../src/worker/tenant-store-bulk";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`bulk-products-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "catalogue-manager",
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

async function createProduct(stub: Stub, name: string, suffix: string) {
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name,
    variants: [{ name: "Default", sku: `BULK-${suffix}`, barcode: `501${suffix.padStart(10, "0")}`, priceMinor: 1000, costMinor: 400, taxRateBps: 2000, options: {} }],
  });
  expect(created.response.status).toBe(201);
  return created.data.id;
}

describe("bulk product archive and restore", () => {
  it("archives and restores multiple products atomically with variant state and per-product audit parity", async () => {
    const stub = tenant();
    const firstId = await createProduct(stub, "Bulk one", "1");
    const secondId = await createProduct(stub, "Bulk two", "2");

    const archived = await request<{ changed: number; unchanged: number }>(stub, "/products/bulk-status", "PATCH", {
      productIds: [firstId, secondId],
      status: "archived",
    });
    expect(archived.response.ok).toBe(true);
    expect(archived.data).toMatchObject({ changed: 2, unchanged: 0 });

    const products = await request<Product[]>(stub, "/products");
    for (const productId of [firstId, secondId]) {
      const product = products.data.find(item => item.id === productId)!;
      expect(product.status).toBe("archived");
      expect(product.variants.every(variant => variant.active === 0)).toBe(true);
    }

    await runInDurableObject(stub, async (_instance, state) => {
      const audits = state.storage.sql.exec<{ action: string; entity_id: string; metadata_json: string | null }>(
        "SELECT action, entity_id, metadata_json FROM audit_events WHERE action = 'product.archived' ORDER BY created_at DESC",
      ).toArray().filter(row => [firstId, secondId].includes(row.entity_id));
      expect(audits).toHaveLength(2);
      expect(audits.every(row => JSON.parse(row.metadata_json || "{}").bulk === true)).toBe(true);
    });

    const restored = await request<{ changed: number }>(stub, "/products/bulk-status", "PATCH", {
      productIds: [firstId, secondId],
      status: "active",
    });
    expect(restored.response.ok).toBe(true);
    expect(restored.data.changed).toBe(2);

    const afterRestore = await request<Product[]>(stub, "/products");
    for (const productId of [firstId, secondId]) {
      const product = afterRestore.data.find(item => item.id === productId)!;
      expect(product.status).toBe("active");
      expect(product.variants.every(variant => variant.active !== 0)).toBe(true);
    }
  });

  it("rejects the whole batch when any selected product no longer exists", async () => {
    const stub = tenant();
    const firstId = await createProduct(stub, "Survivor", "3");

    const result = await request<{ error: string }>(stub, "/products/bulk-status", "PATCH", {
      productIds: [firstId, crypto.randomUUID()],
      status: "archived",
    });
    expect(result.response.status).toBe(404);

    const products = await request<Product[]>(stub, "/products");
    expect(products.data.find(item => item.id === firstId)?.status).toBe("active");
  });

  it("rejects duplicate product IDs instead of applying an ambiguous batch", async () => {
    const stub = tenant();
    const productId = await createProduct(stub, "Duplicate", "4");
    const result = await request<{ error: string }>(stub, "/products/bulk-status", "PATCH", {
      productIds: [productId, productId],
      status: "archived",
    });
    expect(result.response.status).toBe(400);
    expect(result.data.error).toMatch(/only appear once/i);
  });
});
