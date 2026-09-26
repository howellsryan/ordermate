import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-final";

type Stub = DurableObjectStub<TenantStore>;

type Setup = {
  locationId: string;
  supplierId: string;
  smallId: string;
  mediumId: string;
};

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`po-due-${crypto.randomUUID()}`);
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

function addDays(timestamp: string, days: number) {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function setup(stub: Stub, mapMedium = true): Promise<Setup> {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main warehouse", code: `D${crypto.randomUUID().slice(0, 5)}` });
  const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Lead Time Ltd" });
  const product = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Due-date product",
    variants: [
      { name: "Small", sku: `DUE-S-${crypto.randomUUID().slice(0, 5)}`, priceMinor: 1000, costMinor: 500, taxRateBps: 2000, options: { Size: "Small" } },
      { name: "Medium", sku: `DUE-M-${crypto.randomUUID().slice(0, 5)}`, priceMinor: 1000, costMinor: 500, taxRateBps: 2000, options: { Size: "Medium" } },
    ],
  });
  expect(location.response.status).toBe(201);
  expect(supplier.response.status).toBe(201);
  expect(product.response.status).toBe(201);

  const products = await request<Array<{ id: string; variants: Array<{ id: string; name: string }> }>>(stub, "/products");
  const variants = products.data.find(item => item.id === product.data.id)!.variants;
  const smallId = variants.find(variant => variant.name === "Small")!.id;
  const mediumId = variants.find(variant => variant.name === "Medium")!.id;

  expect((await request(stub, "/supplier-variants", "POST", { supplierId: supplier.data.id, variantId: smallId, supplierSku: "LT-S", leadTimeDays: 3, lastCostMinor: 480 })).response.ok).toBe(true);
  if (mapMedium) {
    expect((await request(stub, "/supplier-variants", "POST", { supplierId: supplier.data.id, variantId: mediumId, supplierSku: "LT-M", leadTimeDays: 8, lastCostMinor: 470 })).response.ok).toBe(true);
  }

  return { locationId: location.data.id, supplierId: supplier.data.id, smallId, mediumId };
}

async function createPo(stub: Stub, setupData: Setup) {
  const created = await request<{ id: string; number: string }>(stub, "/purchase-orders", "POST", {
    supplierId: setupData.supplierId,
    locationId: setupData.locationId,
    lines: [
      { variantId: setupData.smallId, quantity: 2, unitCostMinor: 480, taxRateBps: 2000 },
      { variantId: setupData.mediumId, quantity: 3, unitCostMinor: 470, taxRateBps: 2000 },
    ],
  });
  expect(created.response.status).toBe(201);
  return created.data;
}

describe("purchase-order expected delivery dates", () => {
  it("derives the expected date from the slowest mapped line when every line has lead-time coverage", async () => {
    const stub = tenant();
    const setupData = await setup(stub);
    const po = await createPo(stub, setupData);

    const submitted = await request<{ ok: true; expectedDeliveryDate: string | null }>(stub, `/purchase-orders/${po.id}/submit`, "POST", {});
    expect(submitted.response.ok).toBe(true);

    const detail = await request<{ ordered_at: string; expected_delivery_date: string | null }>(stub, `/purchase-orders/${po.id}`);
    expect(detail.data.expected_delivery_date).toBe(addDays(detail.data.ordered_at, 8));
    expect(submitted.data.expectedDeliveryDate).toBe(detail.data.expected_delivery_date);
  });

  it("preserves an explicitly reviewed date instead of replacing it with supplier lead time", async () => {
    const stub = tenant();
    const setupData = await setup(stub);
    const po = await createPo(stub, setupData);
    const expectedDeliveryDate = "2030-02-14";

    const patched = await request<{ ok: true; expectedDeliveryDate: string | null }>(stub, `/purchase-orders/${po.id}/expected-delivery`, "PATCH", { expectedDeliveryDate });
    expect(patched.response.ok).toBe(true);
    expect(patched.data.expectedDeliveryDate).toBe(expectedDeliveryDate);

    const submitted = await request<{ ok: true; expectedDeliveryDate: string | null }>(stub, `/purchase-orders/${po.id}/submit`, "POST", {});
    expect(submitted.response.ok).toBe(true);
    expect(submitted.data.expectedDeliveryDate).toBe(expectedDeliveryDate);

    const detail = await request<{ expected_delivery_date: string | null }>(stub, `/purchase-orders/${po.id}`);
    expect(detail.data.expected_delivery_date).toBe(expectedDeliveryDate);

    await runInDurableObject(stub, async (_instance, state) => {
      const audit = state.storage.sql.exec<{ action: string; metadata_json: string | null }>(
        "SELECT action, metadata_json FROM audit_events WHERE entity_id = ? ORDER BY created_at",
        po.id,
      ).toArray();
      expect(audit.map(event => event.action)).toEqual(expect.arrayContaining(["purchase_order.expected_delivery_updated", "purchase_order.submitted"]));
      const submittedEvent = audit.find(event => event.action === "purchase_order.submitted")!;
      expect(JSON.parse(submittedEvent.metadata_json || "{}")).toMatchObject({ expectedDeliveryDate, expectedDeliverySource: "manual" });
    });
  });

  it("leaves the date unset when any ordered line lacks supplier lead-time coverage", async () => {
    const stub = tenant();
    const setupData = await setup(stub, false);
    const po = await createPo(stub, setupData);

    const submitted = await request<{ ok: true; expectedDeliveryDate: string | null }>(stub, `/purchase-orders/${po.id}/submit`, "POST", {});
    expect(submitted.response.ok).toBe(true);
    expect(submitted.data.expectedDeliveryDate).toBeNull();

    const detail = await request<{ expected_delivery_date: string | null }>(stub, `/purchase-orders/${po.id}`);
    expect(detail.data.expected_delivery_date).toBeNull();
  });

  it("rejects invalid calendar dates and changes after the PO is fully received", async () => {
    const stub = tenant();
    const setupData = await setup(stub);
    const po = await createPo(stub, setupData);

    const invalid = await request<{ error: string }>(stub, `/purchase-orders/${po.id}/expected-delivery`, "PATCH", { expectedDeliveryDate: "2027-02-31" });
    expect(invalid.response.status).toBe(400);

    await request(stub, `/purchase-orders/${po.id}/submit`, "POST", {});
    const detail = await request<{ lines: Array<{ id: string; quantity_ordered: number }> }>(stub, `/purchase-orders/${po.id}`);
    const received = await request(stub, `/purchase-orders/${po.id}/receive`, "POST", {
      lines: detail.data.lines.map(line => ({ lineId: line.id, quantity: line.quantity_ordered })),
    });
    expect(received.response.ok).toBe(true);

    const closed = await request<{ error: string }>(stub, `/purchase-orders/${po.id}/expected-delivery`, "PATCH", { expectedDeliveryDate: "2030-03-01" });
    expect(closed.response.status).toBe(409);
    expect(closed.data.error).toMatch(/closed purchase order/i);
  });
});
