import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { OperationsReport } from "../src/shared/operations-report";
import type { TenantStore } from "../src/worker/tenant-store-reports";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`report-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "report-owner",
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

function yesterday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

describe("operational reports", () => {
  it("reconciles stock, outstanding purchasing and partial fulfilment from canonical records", async () => {
    const stub = tenant();
    const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Report warehouse", code: "RPT" });
    const created = await request<{ id: string }>(stub, "/products", "POST", {
      name: "Report product",
      variants: [{ name: "Default", sku: "RPT-001", barcode: "5015550000001", priceMinor: 1000, costMinor: 400, taxRateBps: 0, options: {} }],
    });
    expect(created.response.status).toBe(201);
    const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
    const variantId = products.data.flatMap(product => product.variants).find(variant => variant.sku === "RPT-001")!.id;

    await request(stub, "/inventory/adjust", "POST", { variantId, locationId: location.data.id, quantityDelta: 20, reason: "Opening stock" });

    const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Report supplier" });
    const po = await request<{ id: string }>(stub, "/purchase-orders", "POST", {
      supplierId: supplier.data.id,
      locationId: location.data.id,
      lines: [{ variantId, quantity: 10, unitCostMinor: 400, taxRateBps: 0 }],
    });
    await request(stub, `/purchase-orders/${po.data.id}/submit`, "POST", {});
    await request(stub, `/purchase-orders/${po.data.id}/expected-delivery`, "PATCH", { expectedDeliveryDate: yesterday() });
    const poDetail = await request<{ lines: Array<{ id: string }> }>(stub, `/purchase-orders/${po.data.id}`);
    await request(stub, `/purchase-orders/${po.data.id}/receive`, "POST", { lines: [{ lineId: poDetail.data.lines[0].id, quantity: 4 }] });

    const order = await request<{ id: string }>(stub, "/orders", "POST", {
      locationId: location.data.id,
      lines: [{ variantId, quantity: 5 }],
    });
    await request(stub, `/orders/${order.data.id}/confirm`, "POST", {});
    const orderDetail = await request<{ lines: Array<{ id: string }> }>(stub, `/orders/${order.data.id}`);
    await request(stub, `/orders/${order.data.id}/fulfil`, "POST", { lines: [{ lineId: orderDetail.data.lines[0].id, quantity: 3 }] });

    const report = await request<OperationsReport>(stub, "/reports/operations?days=30");
    expect(report.response.ok).toBe(true);
    expect(report.data.windowDays).toBe(30);
    expect(report.data.currency).toBe("GBP");
    expect(report.data.inventory).toMatchObject({
      onHandUnits: 21,
      reservedUnits: 2,
      availableUnits: 19,
      incomingUnits: 6,
      inventoryValueMinor: 8400,
      trackedPositions: 1,
      lowStockPositions: 0,
      stockoutPositions: 0,
    });
    expect(report.data.orders.createdOrders).toBe(1);
    expect(report.data.orders.openOrders).toBe(1);
    expect(report.data.orders.fulfilledUnits).toBe(3);
    expect(report.data.orders.returnedUnits).toBe(0);
    expect(report.data.orders.grossOrderValueMinor).toBeGreaterThan(0);
    expect(report.data.purchasing).toMatchObject({
      openPurchaseOrders: 1,
      overduePurchaseOrders: 1,
      outstandingCommitmentMinor: 2400,
      receivedUnits: 4,
    });
    expect(report.data.locations).toEqual([
      expect.objectContaining({ locationName: "Report warehouse", onHandUnits: 21, availableUnits: 19, inventoryValueMinor: 8400 }),
    ]);
    expect(report.data.topFulfilled[0]).toMatchObject({ sku: "RPT-001", fulfilledUnits: 3 });
    expect(report.data.orderTrend).toHaveLength(30);
    expect(report.data.movementTrend).toHaveLength(30);
  });

  it("rejects an unbounded report window", async () => {
    const stub = tenant();
    const report = await request<{ error: string }>(stub, "/reports/operations?days=365");
    expect(report.response.status).toBe(400);
  });
});
