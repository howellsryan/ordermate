import { describe, expect, it } from "vitest";
import { applyPlanningContext, buildOperatingIntelligence, type IntelligenceInput } from "../src/shared/operating-intelligence";

function input(overrides: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    id: "sku-a:loc-1",
    variant_id: "sku-a",
    product_name: "Core carton",
    variant_name: "Default",
    sku: "CORE-A",
    location_id: "loc-1",
    location_name: "Main",
    on_hand: 40,
    reserved: 10,
    available: 30,
    incoming: 0,
    fulfilled_30d: 90,
    fulfilled_prev_60d: 120,
    cost_minor: 500,
    threshold: 6,
    target_stock: 30,
    policy_custom: true,
    preferred_supplier_id: "supplier-a",
    effective_lead_time_days: 7,
    suppliers: [{ supplierId: "supplier-a", supplierName: "Supplier A", leadTimeDays: 7, preferred: true }],
    ...overrides,
  };
}

describe("operating intelligence", () => {
  it("keeps purchase scenarios ordered and exposes a twelve-week projection", () => {
    const result = buildOperatingIntelligence([input()], { defaultThreshold: 5, todayIso: "2026-09-26" });
    const row = result.positions[0];

    expect(result.window_days).toBe(90);
    expect(result.history_window_days).toBe(90);
    expect(row.forecast_12_weeks).toHaveLength(12);
    expect(row.scenarios.minimum).toBeLessThanOrEqual(row.scenarios.recommended);
    expect(row.scenarios.recommended).toBeLessThanOrEqual(row.scenarios.maximum);
    expect(row.recommended_quantity).toBe(row.scenarios.recommended);
    expect(row.explanation).toContain("The configured target stock of 30 units remains the recommended post-arrival target for this SKU/location policy.");
  });

  it("uses the recent run-rate without inventing a trend when prior history is absent", () => {
    const row = applyPlanningContext(input({ fulfilled_30d: 30, fulfilled_prev_60d: 0 }), "A", "2026-09-26");

    expect(row.average_daily_demand).toBe(1);
    expect(row.forecast_daily_demand).toBe(1);
    expect(row.trend_percent).toBeNull();
    expect(row.trend_label).toBe("insufficient_history");
  });

  it("makes a positive demand scenario more conservative without mutating the base input", () => {
    const baseInput = input();
    const base = applyPlanningContext(baseInput, "A", "2026-09-26");
    const campaign = applyPlanningContext(baseInput, "A", "2026-09-26", { demandAdjustmentPercent: 50 });

    expect(campaign.forecast_daily_demand).toBeGreaterThan(base.forecast_daily_demand);
    expect(campaign.safety_stock).toBeGreaterThanOrEqual(base.safety_stock);
    expect(campaign.scenarios.recommended).toBeGreaterThanOrEqual(base.scenarios.recommended);
    expect(baseInput.fulfilled_30d).toBe(90);
    expect(campaign.explanation.at(-1)).toContain("+50%");
  });

  it("makes supplier delay increase lead exposure and never reduce the recommendation", () => {
    const base = applyPlanningContext(input(), "A", "2026-09-26");
    const delayed = applyPlanningContext(input(), "A", "2026-09-26", { extraLeadTimeDays: 14 });

    expect(delayed.effective_lead_time_days).toBe(base.effective_lead_time_days + 14);
    expect(delayed.projected_at_lead_time).toBeLessThanOrEqual(base.projected_at_lead_time);
    expect(delayed.safety_stock).toBeGreaterThanOrEqual(base.safety_stock);
    expect(delayed.scenarios.recommended).toBeGreaterThanOrEqual(base.scenarios.recommended);
  });

  it("does not let late incoming stock hide a pre-arrival stockout", () => {
    const row = buildOperatingIntelligence([
      input({
        on_hand: 3,
        reserved: 0,
        available: 3,
        incoming: 100,
        incoming_schedule: [{ daysFromNow: 30, quantity: 100 }],
        fulfilled_30d: 90,
        fulfilled_prev_60d: 180,
      }),
    ], { defaultThreshold: 5, todayIso: "2026-09-26" }).positions[0];

    expect(row.days_of_cover).not.toBeNull();
    expect(row.days_of_cover!).toBeLessThanOrEqual(2);
    expect(row.risk).toBe("critical");
  });

  it("uses on-time dated incoming supply in the projection", () => {
    const withoutIncoming = applyPlanningContext(input({ on_hand: 12, reserved: 0, available: 12, incoming: 0 }), "A", "2026-09-26");
    const withIncoming = applyPlanningContext(input({
      on_hand: 12,
      reserved: 0,
      available: 12,
      incoming: 60,
      incoming_schedule: [{ daysFromNow: 2, quantity: 60 }],
    }), "A", "2026-09-26");

    expect(withIncoming.days_of_cover).not.toBeNull();
    expect(withIncoming.days_of_cover!).toBeGreaterThan(withoutIncoming.days_of_cover!);
    expect(withIncoming.forecast_12_weeks[0].projected).toBeGreaterThan(withoutIncoming.forecast_12_weeks[0].projected);
  });

  it("moves the next order date later when scheduled incoming supply covers the lead-time window", () => {
    const withoutIncoming = applyPlanningContext(input(), "A", "2026-09-26");
    const withIncoming = applyPlanningContext(input({
      incoming: 60,
      incoming_schedule: [{ daysFromNow: 2, quantity: 60 }],
    }), "A", "2026-09-26");

    expect(withoutIncoming.order_by_date).toBe("2026-09-26");
    expect(withIncoming.order_by_date).not.toBeNull();
    expect(Date.parse(`${withIncoming.order_by_date}T00:00:00Z`)).toBeGreaterThan(Date.parse(`${withoutIncoming.order_by_date}T00:00:00Z`));
  });

  it("moves dated incoming supply when simulating a supplier delay", () => {
    const scenarioInput = input({
      on_hand: 18,
      reserved: 0,
      available: 18,
      incoming: 60,
      incoming_schedule: [{ daysFromNow: 3, quantity: 60 }],
      effective_lead_time_days: 3,
    });
    const base = applyPlanningContext(scenarioInput, "A", "2026-09-26");
    const delayed = applyPlanningContext(scenarioInput, "A", "2026-09-26", { extraLeadTimeDays: 14 });

    expect(delayed.effective_lead_time_days).toBe(17);
    expect(delayed.days_of_cover ?? 0).toBeLessThanOrEqual(base.days_of_cover ?? 0);
    expect(delayed.explanation.at(-1)).toContain("dated incoming supply");
  });

  it("detects rising demand and a near-term stockout", () => {
    const result = buildOperatingIntelligence([
      input({ available: 8, on_hand: 8, reserved: 0, fulfilled_30d: 120, fulfilled_prev_60d: 60, incoming: 0 }),
    ], { defaultThreshold: 5, todayIso: "2026-09-26" });
    const row = result.positions[0];

    expect(row.trend_label).toBe("rising");
    expect(row.trend_percent).toBeGreaterThan(0);
    expect(row.days_of_cover).not.toBeNull();
    expect(row.days_of_cover!).toBeLessThanOrEqual(30);
    expect(row.stockout_date).not.toBeNull();
    expect(["critical", "warning"]).toContain(row.risk);
    expect(result.summary.projected_stockouts_30d).toBe(1);
  });

  it("keeps the dominant value-consumption SKU in A class", () => {
    const result = buildOperatingIntelligence([
      input({ id: "dominant", variant_id: "dominant", sku: "DOM", fulfilled_30d: 900, fulfilled_prev_60d: 1800, cost_minor: 1000 }),
      input({ id: "small", variant_id: "small", sku: "SMALL", fulfilled_30d: 2, fulfilled_prev_60d: 4, cost_minor: 100 }),
    ], { defaultThreshold: 5, todayIso: "2026-09-26" });

    expect(result.positions.find(row => row.id === "dominant")?.abc_class).toBe("A");
    expect(result.summary.a_class_positions).toBeGreaterThanOrEqual(1);
  });

  it("preserves the established no-demand target-stock recommendation", () => {
    const result = buildOperatingIntelligence([
      input({ available: 2, on_hand: 2, fulfilled_30d: 0, fulfilled_prev_60d: 0, threshold: 4, target_stock: 15, effective_lead_time_days: 10 }),
    ], { defaultThreshold: 5, todayIso: "2026-09-26" });

    expect(result.suggestions[0].scenarios.recommended).toBe(13);
    expect(result.suggestions[0].target_stock).toBe(15);
  });
});
