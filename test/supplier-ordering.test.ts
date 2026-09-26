import { describe, expect, it } from "vitest";
import { applySupplierOrderingTerms, orderableQuantity } from "../src/shared/supplier-ordering";
import type { OperatingIntelligenceResponse, OperatingIntelligenceRow } from "../src/shared/operating-intelligence";

function row(overrides: Partial<OperatingIntelligenceRow> = {}): OperatingIntelligenceRow {
  return {
    id: "variant-a:location-a",
    variant_id: "variant-a",
    product_name: "Mailer",
    variant_name: "Small",
    sku: "MAIL-S",
    location_id: "location-a",
    location_name: "Main",
    on_hand: 10,
    reserved: 2,
    available: 8,
    incoming: 0,
    fulfilled_30d: 30,
    fulfilled_prev_60d: 60,
    cost_minor: 100,
    threshold: 5,
    target_stock: 30,
    policy_custom: true,
    preferred_supplier_id: "supplier-a",
    effective_lead_time_days: 7,
    suppliers: [{ supplierId: "supplier-a", supplierName: "Supplier A", preferred: true }],
    average_daily_demand: 1,
    prior_daily_demand: 1,
    forecast_daily_demand: 1,
    trend_percent: 0,
    trend_label: "stable",
    safety_stock: 5,
    buffer_days: 4,
    projected_at_lead_time: 1,
    days_of_cover: 8,
    stockout_date: "2026-10-04",
    order_by_date: "2026-09-26",
    recommended_quantity: 23,
    scenarios: { minimum: 4, recommended: 23, maximum: 37 },
    forecast_12_weeks: [],
    risk: "critical",
    abc_class: "A",
    explanation: [],
    ...overrides,
  };
}

function response(position = row()): OperatingIntelligenceResponse {
  return {
    generated_at: "2026-09-26T12:00:00.000Z",
    window_days: 90,
    history_window_days: 90,
    forecast_horizon_weeks: 12,
    default_threshold: 5,
    summary: { tracked_positions: 1, at_risk: 1, critical: 1, projected_stockouts_30d: 1, a_class_positions: 1 },
    positions: [position],
    suggestions: [position],
  };
}

describe("supplier ordering constraints", () => {
  it("honours minimum order quantity before rounding to a pack multiple", () => {
    expect(orderableQuantity(7, 10, 6)).toBe(12);
    expect(orderableQuantity(13, 10, 6)).toBe(18);
  });

  it("leaves zero recommendations at zero rather than forcing an unnecessary minimum", () => {
    expect(orderableQuantity(0, 20, 12)).toBe(0);
  });

  it("turns forecast scenarios into supplier-orderable quantities", () => {
    const result = applySupplierOrderingTerms(response(), [{
      supplier_id: "supplier-a",
      variant_id: "variant-a",
      minimum_order_quantity: 12,
      order_multiple: 12,
    }]);

    const adjusted = result.suggestions[0];
    expect(adjusted.scenarios).toEqual({ minimum: 12, recommended: 24, maximum: 48 });
    expect(adjusted.recommended_quantity).toBe(24);
    expect(adjusted.ordering_constraints.adjusted).toBe(true);
    expect(adjusted.explanation.at(-1)).toContain("order-ready");
  });

  it("does not apply one supplier's terms when multiple suppliers exist without a preferred supplier", () => {
    const position = row({
      preferred_supplier_id: null,
      suppliers: [
        { supplierId: "supplier-a", supplierName: "Supplier A", preferred: false },
        { supplierId: "supplier-b", supplierName: "Supplier B", preferred: false },
      ],
    });
    const result = applySupplierOrderingTerms(response(position), [{
      supplier_id: "supplier-a",
      variant_id: "variant-a",
      minimum_order_quantity: 24,
      order_multiple: 12,
    }]);

    expect(result.suggestions[0].scenarios).toEqual({ minimum: 4, recommended: 23, maximum: 37 });
    expect(result.suggestions[0].ordering_constraints.supplier_id).toBeNull();
    expect(result.suggestions[0].ordering_constraints.adjusted).toBe(false);
  });
});
