import { describe, expect, it } from "vitest";
import { buildFlowPlan, type FlowPlanAttentionItem } from "../src/shared/flow-plan";
import type { OperatingIntelligenceResponse, OperatingIntelligenceRow } from "../src/shared/operating-intelligence";

function stock(overrides: Partial<OperatingIntelligenceRow> = {}): OperatingIntelligenceRow {
  return {
    id: "variant-a:location-a",
    variant_id: "variant-a",
    product_name: "Core carton",
    variant_name: "Default",
    sku: "CORE-A",
    location_id: "location-a",
    location_name: "Main warehouse",
    on_hand: 20,
    reserved: 5,
    available: 15,
    incoming: 0,
    fulfilled_30d: 90,
    fulfilled_prev_60d: 120,
    cost_minor: 500,
    threshold: 5,
    target_stock: 30,
    policy_custom: true,
    preferred_supplier_id: "supplier-a",
    effective_lead_time_days: 7,
    suppliers: [{ supplierId: "supplier-a", supplierName: "Supplier A", leadTimeDays: 7, preferred: true }],
    average_daily_demand: 3,
    prior_daily_demand: 2,
    forecast_daily_demand: 3.2,
    trend_percent: 50,
    trend_label: "rising",
    safety_stock: 13,
    buffer_days: 4,
    projected_at_lead_time: -7,
    days_of_cover: 4,
    stockout_date: "2026-09-30",
    order_by_date: "2026-09-26",
    recommended_quantity: 37,
    scenarios: { minimum: 20, recommended: 37, maximum: 70 },
    forecast_12_weeks: [],
    risk: "critical",
    abc_class: "A",
    explanation: [],
    ...overrides,
  };
}

function intelligence(suggestions: OperatingIntelligenceRow[]): Pick<OperatingIntelligenceResponse, "suggestions"> {
  return { suggestions };
}

describe("automatic flow plan", () => {
  it("puts overdue customer promises ahead of lower-priority work", () => {
    const attention: FlowPlanAttentionItem[] = [
      { id: "order:1", severity: "critical", type: "Required-by overdue", title: "ORD-1001", detail: "Acme · Main", page: "orders" },
      { id: "po:1", severity: "warning", type: "Partial receipt", title: "PO-1001", detail: "Supplier A · Main", page: "purchasing" },
    ];

    const plan = buildFlowPlan(attention, intelligence([]), "2026-09-26T12:00:00.000Z");

    expect(plan.actions[0]?.category).toBe("customer_promise");
    expect(plan.actions[0]?.page).toBe("warehouse");
    expect(plan.critical).toBe(1);
  });

  it("turns critical forecast risk into a concrete reviewed buying action", () => {
    const plan = buildFlowPlan([], intelligence([stock()]), "2026-09-26T12:00:00.000Z");

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.category).toBe("stock_risk");
    expect(plan.actions[0]?.nextAction).toBe("Review 37 units from Supplier A");
    expect(plan.actions[0]?.evidence).toContain("A-class inventory position");
  });

  it("asks the buyer to choose when multiple suppliers exist without a preferred supplier", () => {
    const plan = buildFlowPlan([], intelligence([stock({
      preferred_supplier_id: null,
      suppliers: [
        { supplierId: "supplier-a", supplierName: "Supplier A", preferred: false },
        { supplierId: "supplier-b", supplierName: "Supplier B", preferred: false },
      ],
    })]));

    expect(plan.actions[0]?.nextAction).toBe("Review the recommended buy of 37 units and choose a supplier");
  });

  it("ignores healthy/watch replenishment positions and keeps the queue exception-first", () => {
    const plan = buildFlowPlan([], intelligence([
      stock({ id: "watch", risk: "watch" }),
      stock({ id: "healthy", risk: "healthy" }),
    ]));

    expect(plan.actions).toHaveLength(0);
  });

  it("caps the live plan so a small team gets a decision queue rather than another backlog", () => {
    const attention: FlowPlanAttentionItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `po:${index}`,
      severity: "critical",
      type: "Overdue purchase order",
      title: `PO-${index}`,
      detail: "Supplier · Main",
      page: "purchasing",
    }));

    expect(buildFlowPlan(attention, intelligence([])).actions).toHaveLength(8);
  });
});
