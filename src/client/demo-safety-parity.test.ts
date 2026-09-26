import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantApi } from "./api";
import { DEMO_TENANT_ID, resetDemoData } from "./demo-store";
import type { InventoryRow } from "./model";

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

describe("guest demo production safety parity", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("rejects a stale cycle count when stock changed after the operator reviewed it", async () => {
    const before = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const row = before.find(item => item.variant_id === "var-tape" && item.location_id === "loc-birmingham")!;

    await tenantApi(DEMO_TENANT_ID, "/inventory/adjust", {
      method: "POST",
      body: JSON.stringify({ variantId: row.variant_id, locationId: row.location_id, quantityDelta: 2, reason: "Concurrent demo adjustment" }),
    });

    await expect(tenantApi(DEMO_TENANT_ID, "/inventory/stocktake", {
      method: "POST",
      body: JSON.stringify({
        locationId: row.location_id,
        reason: "Stale count",
        lines: [{
          variantId: row.variant_id,
          expectedOnHand: row.on_hand,
          expectedReserved: row.reserved,
          countedOnHand: row.on_hand + 1,
        }],
      }),
    })).rejects.toThrow(/Stock changed while you were counting/);

    const after = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    expect(after.find(item => item.variant_id === row.variant_id && item.location_id === row.location_id)?.on_hand).toBe(row.on_hand + 2);
  });

  it("rejects duplicate variants inside a single cycle count", async () => {
    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const row = inventory.find(item => item.variant_id === "var-tape" && item.location_id === "loc-birmingham")!;
    const line = {
      variantId: row.variant_id,
      expectedOnHand: row.on_hand,
      expectedReserved: row.reserved,
      countedOnHand: row.on_hand,
    };

    await expect(tenantApi(DEMO_TENANT_ID, "/inventory/stocktake", {
      method: "POST",
      body: JSON.stringify({ locationId: row.location_id, lines: [line, line] }),
    })).rejects.toThrow(/only appear once/);
  });

  it("rejects one supplier SKU being mapped to two different product variants", async () => {
    await expect(tenantApi(DEMO_TENANT_ID, "/supplier-variants", {
      method: "POST",
      body: JSON.stringify({
        supplierId: "sup-pack",
        variantId: "var-gloves-m",
        supplierSku: "  mp-mail-s  ",
        lastCostMinor: 300,
        leadTimeDays: 5,
      }),
    })).rejects.toThrow(/Supplier SKU mp-mail-s is already mapped/i);
  });
});
