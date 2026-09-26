import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryDiscrepancyRecord } from "../shared/delivery-discrepancy";
import { tenantApi, tenantOpsApi } from "./api";
import { DEMO_TENANT_ID, resetDemoData } from "./demo-store";
import type { AttentionResponse } from "./model";

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

describe("guest demo operational attention", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("surfaces the seeded delivery discrepancy in Overview attention", async () => {
    const attention = await tenantOpsApi<AttentionResponse>(DEMO_TENANT_ID, "/attention");
    expect(attention.items).toContainEqual(expect.objectContaining({
      id: "delivery-discrepancy:demo-discrepancy-1",
      type: "Open delivery discrepancy",
      title: "PO-2026-000141",
      page: "purchasing",
    }));
  });

  it("removes the attention item after the discrepancy is resolved", async () => {
    const open = await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=open");
    await tenantApi(DEMO_TENANT_ID, `/delivery-discrepancies/${open[0]!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolutionCode: "corrected_document", resolutionNote: "Corrected delivery note received." }),
    });

    const attention = await tenantOpsApi<AttentionResponse>(DEMO_TENANT_ID, "/attention");
    expect(attention.items.some(item => item.id === "delivery-discrepancy:demo-discrepancy-1")).toBe(false);
  });
});
