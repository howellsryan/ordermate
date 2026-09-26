import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary } from "../shared/types";
import { tenantApi, tenantOpsApi } from "./api";
import { DEMO_TENANT_ID, resetDemoData } from "./demo-store";
import type { AttentionResponse, InventoryRow, ReplenishmentResponse } from "./model";

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

describe("local demo archived catalogue planning", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("keeps archived variants visible for stock control but out of replenishment and low-stock attention", async () => {
    await tenantApi(DEMO_TENANT_ID, "/products/prod-labels/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });

    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const labelRows = inventory.filter(row => row.variant_id === "var-labels");
    expect(labelRows.length).toBeGreaterThan(0);
    expect(labelRows.every(row => row.product_status === "archived")).toBe(true);

    const replenishment = await tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment");
    expect(replenishment.suggestions.some(item => item.variant_id === "var-labels")).toBe(false);

    const attention = await tenantOpsApi<AttentionResponse>(DEMO_TENANT_ID, "/attention");
    expect(attention.items.some(item => item.type === "Low stock" && item.id.includes("var-labels"))).toBe(false);

    const dashboard = await tenantApi<DashboardSummary>(DEMO_TENANT_ID, "/dashboard");
    const activeLowStockRows = inventory.filter(row => row.product_status === "active" && row.tracked !== 0 && row.available <= 10);
    expect(dashboard.lowStockVariants).toBe(activeLowStockRows.length);
  });
});
