import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StocktakeResponse } from "../shared/stocktake";
import { tenantApi, tenantOpsApi } from "./api";
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

describe("guest demo stocktake audit reference", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("returns the same unique stocktake reference written to movement history", async () => {
    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const row = inventory.find(item => item.variant_id === "var-tape" && item.location_id === "loc-birmingham")!;

    const result = await tenantApi<StocktakeResponse>(DEMO_TENANT_ID, "/inventory/stocktake", {
      method: "POST",
      body: JSON.stringify({
        locationId: row.location_id,
        reason: "Acceptance count",
        lines: [{
          variantId: row.variant_id,
          expectedOnHand: row.on_hand,
          expectedReserved: row.reserved,
          countedOnHand: row.on_hand + 1,
        }],
      }),
    });

    const movements = await tenantOpsApi<Array<{ movement_type: string; reference_type: string | null; reference_id: string | null; reason: string | null }>>(DEMO_TENANT_ID, "/movements");
    const movement = movements.find(item => item.movement_type === "stocktake" && item.reason === "Acceptance count");

    expect(result.stocktakeId).toBeTruthy();
    expect(movement?.reference_type).toBe("stocktake");
    expect(movement?.reference_id).toBe(result.stocktakeId);
  });
});
