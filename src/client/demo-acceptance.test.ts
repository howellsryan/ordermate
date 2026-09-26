import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryDiscrepancyRecord } from "../shared/delivery-discrepancy";
import type { OperationsReport } from "../shared/operations-report";
import { controlApi, tenantApi } from "./api";
import { DEMO_TENANT_ID, enterDemoMode, resetDemoData } from "./demo-store";
import { demoCsv } from "./demo-acceptance";
import type { InventoryRow, OrderDetail } from "./model";

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

describe("guest demo acceptance parity", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("provides a local supplier discrepancy that can be reviewed and resolved", async () => {
    enterDemoMode();
    const open = await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=open");
    expect(open).toHaveLength(1);
    expect(open[0]?.purchase_order_number).toBe("PO-2026-000141");
    expect(open[0]?.issue_count).toBe(2);

    const proposal = await controlApi<{ sourceKey: string; sourceName: string }>(`/delivery-documents/proposal?key=${encodeURIComponent(open[0]!.proposal_key)}`);
    expect(proposal.sourceKey).toBe("");
    expect(proposal.sourceName).toContain("Local demo");

    await tenantApi(DEMO_TENANT_ID, `/delivery-discrepancies/${open[0]!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolutionCode: "supplier_follow_up", resolutionNote: "Supplier confirmed a corrected note will follow." }),
    });

    const resolved = await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolution_code).toBe("supplier_follow_up");
    expect(resolved[0]?.resolution_note).toContain("corrected note");

    const exported = demoCsv("delivery-discrepancies");
    expect(exported.content).toContain("PO-2026-000141");
    expect(exported.content).toContain("Supplier confirmed a corrected note will follow.");
  });

  it("keeps operational order value aligned with production report semantics", async () => {
    const orders = await tenantApi<OrderDetail[]>(DEMO_TENANT_ID, "/orders");
    const report = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=30");
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - 29);
    const recent = orders.filter(order => new Date(order.created_at).getTime() >= cutoff.getTime());
    const expectedGross = recent
      .filter(order => order.status === "confirmed" || order.status === "completed")
      .reduce((sum, order) => sum + order.total_minor, 0);

    expect(report.orders.createdOrders).toBe(recent.length);
    expect(report.orders.grossOrderValueMinor).toBe(expectedGross);
    expect(report.orderTrend.reduce((sum, point) => sum + point.grossMinor, 0)).toBe(expectedGross);
  });

  it("does not count a draft purchase order as open supplier commitment", async () => {
    const before = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=30");
    await tenantApi(DEMO_TENANT_ID, "/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: "sup-pack",
        locationId: "loc-nottingham",
        lines: [{ variantId: "var-tape", quantity: 10, unitCostMinor: 231, taxRateBps: 2000 }],
      }),
    });
    const after = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=30");

    expect(after.purchasing.openPurchaseOrders).toBe(before.purchasing.openPurchaseOrders);
    expect(after.purchasing.outstandingCommitmentMinor).toBe(before.purchasing.outstandingCommitmentMinor);
  });

  it("counts a non-restocked customer return without inventing a stock movement", async () => {
    const inventoryBefore = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowBefore = inventoryBefore.find(row => row.variant_id === "var-mailer-m" && row.location_id === "loc-nottingham");
    const reportBefore = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=7");

    await tenantApi(DEMO_TENANT_ID, "/orders/ord-2/return", {
      method: "POST",
      body: JSON.stringify({ lines: [{ lineId: "ol-2a", quantity: 2, restock: false }], notes: "Damaged in transit" }),
    });

    const inventoryAfter = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const rowAfter = inventoryAfter.find(row => row.variant_id === "var-mailer-m" && row.location_id === "loc-nottingham");
    const reportAfter = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=7");

    expect(rowAfter?.on_hand).toBe(rowBefore?.on_hand);
    expect(reportAfter.orders.returnedUnits).toBe(reportBefore.orders.returnedUnits + 2);
    expect(reportAfter.movementTrend.reduce((sum, point) => sum + point.returnedUnits, 0)).toBe(reportAfter.orders.returnedUnits);
  });

  it("resets the seeded discrepancy together with the rest of the browser-only demo", async () => {
    const open = await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=open");
    await tenantApi(DEMO_TENANT_ID, `/delivery-discrepancies/${open[0]!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolutionCode: "accepted_variance", resolutionNote: "Accepted for the demo." }),
    });
    expect(await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=open")).toHaveLength(0);

    resetDemoData();

    const resetOpen = await tenantApi<DeliveryDiscrepancyRecord[]>(DEMO_TENANT_ID, "/delivery-discrepancies?status=open");
    expect(resetOpen).toHaveLength(1);
    expect(resetOpen[0]?.resolution_code).toBeNull();
  });
});
