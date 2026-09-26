import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-runtime";

type Stub = DurableObjectStub<TenantStore>;

async function api<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "purchasing-manager",
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

describe("purchase-order cancellation", () => {
  it("cancels outstanding incoming quantity without reversing received stock", async () => {
    const stub = env.TENANT_STORES.getByName(`po-cancel-${crypto.randomUUID()}`);

    await api(stub, "/products", "POST", {
      name: "PO cancel product",
      variants: [{ name: "Default", sku: `POC-${crypto.randomUUID().slice(0, 8)}`, priceMinor: 1000, costMinor: 500, taxRateBps: 2000, options: {} }],
    });
    const products = await api<Array<{ variants: Array<{ id: string }> }>>(stub, "/products");
    const variantId = products.data[0].variants[0].id;

    const location = await api<{ id: string }>(stub, "/locations", "POST", { name: "Main", code: `P${crypto.randomUUID().slice(0, 4)}` });
    const supplier = await api<{ id: string }>(stub, "/suppliers", "POST", { name: "Supplier" });

    const po = await api<{ id: string }>(stub, "/purchase-orders", "POST", {
      supplierId: supplier.data.id,
      locationId: location.data.id,
      lines: [{ variantId, quantity: 5, unitCostMinor: 500, taxRateBps: 2000 }],
    });
    expect(po.response.status).toBe(201);
    expect((await api(stub, `/purchase-orders/${po.data.id}/submit`, "POST", {})).response.ok).toBe(true);

    const detail = await api<{ lines: Array<{ id: string }> }>(stub, `/purchase-orders/${po.data.id}`);
    const lineId = detail.data.lines[0].id;
    expect((await api(stub, `/purchase-orders/${po.data.id}/receive`, "POST", { lines: [{ lineId, quantity: 2 }] })).response.ok).toBe(true);

    let inventory = await api<Array<{ variant_id: string; on_hand: number; incoming: number }>>(stub, "/inventory");
    let level = inventory.data.find(row => row.variant_id === variantId)!;
    expect(level.on_hand).toBe(2);
    expect(level.incoming).toBe(3);

    const cancelled = await api(stub, `/purchase-orders/${po.data.id}/cancel`, "POST", {});
    expect(cancelled.response.ok).toBe(true);

    const afterCancel = await api<{ status: string }>(stub, `/purchase-orders/${po.data.id}`);
    expect(afterCancel.data.status).toBe("cancelled");

    inventory = await api<Array<{ variant_id: string; on_hand: number; incoming: number }>>(stub, "/inventory");
    level = inventory.data.find(row => row.variant_id === variantId)!;
    expect(level.on_hand).toBe(2);
    expect(level.incoming).toBe(0);

    const movements = await api<Array<{ quantity_delta: number; movement_type: string; reference_id: string | null }>>(stub, "/inventory/movements");
    const poMovements = movements.data.filter(movement => movement.reference_id === po.data.id);
    expect(poMovements).toHaveLength(1);
    expect(poMovements[0]).toMatchObject({ quantity_delta: 2, movement_type: "purchase_receipt" });

    const audit = await api<Array<{ action: string; entity_id: string }>>(stub, "/audit");
    expect(audit.data.some(event => event.action === "purchase_order.cancelled" && event.entity_id === po.data.id)).toBe(true);
  });
});
