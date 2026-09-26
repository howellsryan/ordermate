import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, tenantApi } from "./api";
import { DEMO_TENANT_ID, enterDemoMode, resetDemoData } from "./demo-store";
import type { InventoryRow, OrderDetail, PurchaseOrderDetail } from "./model";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("local guest demo", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("creates a demo session without calling Google or the backend", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network should not be used in demo mode"); });
    vi.stubGlobal("fetch", fetchSpy);

    enterDemoMode();
    const session = await getSession();

    expect(session?.user.name).toBe("Guest operator");
    expect(session?.organizations[0]?.id).toBe(DEMO_TENANT_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("persists order confirmation and reservation changes in localStorage only", async () => {
    const before = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowBefore = before.find(row => row.variant_id === "var-mailer-m" && row.location_id === "loc-birmingham");
    expect(rowBefore?.reserved).toBe(0);

    await tenantApi(DEMO_TENANT_ID, "/orders/ord-3/confirm", { method: "POST" });

    const order = await tenantApi<OrderDetail>(DEMO_TENANT_ID, "/orders/ord-3");
    const after = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowAfter = after.find(row => row.variant_id === "var-mailer-m" && row.location_id === "loc-birmingham");
    expect(order.status).toBe("confirmed");
    expect(rowAfter?.reserved).toBe(15);
    expect(rowAfter?.available).toBe(19);
  });

  it("receives purchase-order stock and reduces incoming supply", async () => {
    const before = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowBefore = before.find(row => row.variant_id === "var-mailer-s" && row.location_id === "loc-nottingham");

    await tenantApi(DEMO_TENANT_ID, "/purchase-orders/po-1/receive", {
      method: "POST",
      body: JSON.stringify({ lines: [{ lineId: "pol-1a", quantity: 10 }] }),
    });

    const po = await tenantApi<PurchaseOrderDetail>(DEMO_TENANT_ID, "/purchase-orders/po-1");
    const after = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowAfter = after.find(row => row.variant_id === "var-mailer-s" && row.location_id === "loc-nottingham");
    expect(po.lines.find(line => line.id === "pol-1a")?.quantity_received).toBe(10);
    expect(rowAfter?.on_hand).toBe((rowBefore?.on_hand ?? 0) + 10);
    expect(rowAfter?.incoming).toBe((rowBefore?.incoming ?? 0) - 10);
  });

  it("restores the seeded workspace when the demo is reset", async () => {
    await tenantApi(DEMO_TENANT_ID, "/inventory/adjust", {
      method: "POST",
      body: JSON.stringify({ variantId: "var-labels", locationId: "loc-nottingham", quantityDelta: 5, reason: "test" }),
    });
    const changed = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    expect(changed.find(row => row.variant_id === "var-labels" && row.location_id === "loc-nottingham")?.on_hand).toBe(12);

    resetDemoData();
    const restored = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    expect(restored.find(row => row.variant_id === "var-labels" && row.location_id === "loc-nottingham")?.on_hand).toBe(7);
  });
});
