import { describe, expect, it } from "vitest";
import { buildBuyBatches } from "../src/shared/buy-batches";
import type { OperatingIntelligenceRow } from "../src/shared/operating-intelligence";

function row(overrides: Partial<OperatingIntelligenceRow> = {}): OperatingIntelligenceRow {
  return {
    id: "variant-a:location-a",
    variant_id: "variant-a",
    product_name: "Carton",
    variant_name: "Small",
    sku: "CAR-S",
    location_id: "location-a",
    location_name: "Main",
    on_hand: 4,
    reserved: 0,
    available: 4,
    incoming: 0,
    fulfilled_30d: 30,
    fulfilled_prev_60d: 60,
    cost_minor: 400,
    threshold: 5,
    target_stock: 24,
    policy_custom: true,
    preferred_supplier_id: "supplier-a",
    effective_lead_time_days: 7,
    suppliers: [{ supplierId: "supplier-a", supplierName: "Supplier A", lastCostMinor: 350, leadTimeDays: 7, preferred: true }],
    average_daily_demand: 1,
    prior_daily_demand: 1,
    forecast_daily_demand: 1,
    trend_percent: 0,
    trend_label: "stable",
    safety_stock: 5,
    buffer_days: 4,
    projected_at_lead_time: -3,
    days_of_cover: 4,
    stockout_date: "2026-09-30",
    order_by_date: "2026-09-26",
    recommended_quantity: 24,
    scenarios: { minimum: 12, recommended: 24, maximum: 36 },
    forecast_12_weeks: [],
    risk: "critical",
    abc_class: "A",
    explanation: [],
    ...overrides,
  };
}

describe("smart buy batches", () => {
  it("groups due SKUs by supplier and destination into one reviewable purchase", () => {
    const batches = buildBuyBatches([
      row(),
      row({ id: "variant-b:location-a", variant_id: "variant-b", product_name: "Tape", sku: "TAPE", scenarios: { minimum: 6, recommended: 12, maximum: 24 }, recommended_quantity: 12, risk: "warning" }),
    ], "2026-09-26");

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ supplierId: "supplier-a", locationId: "location-a", totalUnits: 36, criticalLines: 1 });
    expect(batches[0].lines.map(line => line.variantId)).toEqual(["variant-a", "variant-b"]);
    expect(batches[0].estimatedCostMinor).toBe(12_600);
  });

  it("does not invent a supplier choice when several mappings exist without a preferred supplier", () => {
    const batches = buildBuyBatches([row({
      preferred_supplier_id: null,
      suppliers: [
        { supplierId: "supplier-a", supplierName: "Supplier A", preferred: false },
        { supplierId: "supplier-b", supplierName: "Supplier B", preferred: false },
      ],
    })], "2026-09-26");

    expect(batches).toEqual([]);
  });

  it("leaves future non-critical recommendations out until their order-by date arrives", () => {
    expect(buildBuyBatches([row({ risk: "warning", order_by_date: "2026-10-05" })], "2026-09-26")).toEqual([]);
  });

  it("keeps unknown commercial cost honest instead of showing a partial batch estimate", () => {
    const batches = buildBuyBatches([
      row(),
      row({ id: "variant-b:location-a", variant_id: "variant-b", suppliers: [{ supplierId: "supplier-a", supplierName: "Supplier A", lastCostMinor: null, preferred: true }] }),
    ], "2026-09-26");

    expect(batches[0].estimatedCostMinor).toBeNull();
  });
});
