import { describe, expect, it } from "vitest";
import { buildOperatingIntelligence, type IntelligenceInput } from "../src/shared/operating-intelligence";
import { deterministicOperationsAnswer, type OperationsAssistantContext } from "../src/shared/operations-assistant";

function intelligenceInput(): IntelligenceInput {
  return {
    id: "sku-risk:loc-1",
    variant_id: "sku-risk",
    product_name: "Packing tape",
    variant_name: "50m",
    sku: "TAPE-50",
    location_id: "loc-1",
    location_name: "Nottingham",
    on_hand: 8,
    reserved: 2,
    available: 6,
    incoming: 0,
    fulfilled_30d: 90,
    fulfilled_prev_60d: 120,
    cost_minor: 250,
    threshold: 5,
    target_stock: 30,
    policy_custom: true,
    effective_lead_time_days: 7,
    suppliers: [{ supplierId: "sup-1", supplierName: "Supplier One", leadTimeDays: 7 }],
  };
}

function context(): OperationsAssistantContext {
  const intelligence = buildOperatingIntelligence([intelligenceInput()], { defaultThreshold: 5, todayIso: "2026-09-26" });
  return {
    generatedAt: "2026-09-26T10:00:00.000Z",
    dashboard: {
      ordersOpen: 3,
      ordersAwaitingFulfilment: 2,
      purchaseOrdersOpen: 1,
      lowStockVariants: 1,
      inventoryValueMinor: 100000,
      currency: "GBP",
    },
    intelligence: { summary: intelligence.summary, suggestions: intelligence.suggestions },
    confirmedOrders: [
      { number: "ORD-URGENT", customer: "Priority customer", location: "Nottingham", priority: "urgent", requiredBy: "2026-09-26" },
      { number: "ORD-NORMAL", customer: "Regular customer", location: "Nottingham", priority: "normal", requiredBy: "2026-09-30" },
    ],
    openPurchaseOrders: [
      { number: "PO-1", supplier: "Supplier One", location: "Nottingham", status: "ordered", expected: "2026-09-28" },
    ],
  };
}

describe("operations assistant deterministic fallback", () => {
  it("answers stock questions from forecast evidence and routes to reviewable workflows", () => {
    const answer = deterministicOperationsAnswer("What am I most likely to run out of?", context());

    expect(answer.mode).toBe("deterministic");
    expect(answer.answer).toContain("forecast");
    expect(answer.facts.join(" ")).toContain("Packing tape");
    expect(answer.recommendedPages.map(item => item.page)).toContain("purchasing");
    expect(answer.recommendedPages.map(item => item.page)).toContain("inventory");
  });

  it("surfaces prioritised confirmed orders without claiming a mutation", () => {
    const answer = deterministicOperationsAnswer("Which orders need attention first?", context());

    expect(answer.facts[0]).toContain("ORD-URGENT");
    expect(answer.answer.toLocaleLowerCase()).not.toContain("i changed");
    expect(answer.recommendedPages.map(item => item.page)).toContain("warehouse");
  });

  it("answers supplier and incoming-stock questions from open purchase orders", () => {
    const answer = deterministicOperationsAnswer("What should I know about incoming supply?", context());

    expect(answer.answer).toContain("purchase orders");
    expect(answer.facts[0]).toContain("PO-1");
    expect(answer.facts[0]).toContain("Supplier One");
    expect(answer.recommendedPages).toEqual([{ page: "purchasing", label: "Open purchasing" }]);
  });

  it("supports an explicit demo mode without changing evidence semantics", () => {
    const answer = deterministicOperationsAnswer("stock risk", context(), "demo");
    expect(answer.mode).toBe("demo");
    expect(answer.facts.length).toBeGreaterThan(0);
  });
});
