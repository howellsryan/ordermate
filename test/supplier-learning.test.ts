import { describe, expect, it } from "vitest";
import type { SupplierVariant } from "../src/client/model";
import { supplierLearningDecision } from "../src/client/supplier-learning";

function mapping(overrides: Partial<SupplierVariant> = {}): SupplierVariant {
  return {
    supplier_id: "supplier-1",
    supplier_name: "Acme",
    variant_id: "variant-1",
    product_name: "Classic Tee",
    variant_name: "Small",
    sku: "TEE-S",
    supplier_sku: "ACME-S",
    last_cost_minor: 800,
    lead_time_days: 7,
    ...overrides,
  };
}

describe("supplier SKU learning decisions", () => {
  it("selects a new reviewed supplier SKU by default", () => {
    const decision = supplierLearningDecision([], "supplier-1", "variant-1", "ACME-S");
    expect(decision.defaultSelected).toBe(true);
    expect(decision.disabled).toBe(false);
    expect(decision.label).toMatch(/Remember supplier SKU/i);
  });

  it("keeps an identical existing mapping selected", () => {
    const decision = supplierLearningDecision([mapping()], "supplier-1", "variant-1", " acme-s ");
    expect(decision.defaultSelected).toBe(true);
    expect(decision.currentMapping?.lead_time_days).toBe(7);
    expect(decision.label).toMatch(/Keep supplier SKU/i);
  });

  it("requires explicit opt-in before replacing a different supplier SKU on the same variant", () => {
    const decision = supplierLearningDecision([mapping({ supplier_sku: "OLD-CODE" })], "supplier-1", "variant-1", "NEW-CODE");
    expect(decision.defaultSelected).toBe(false);
    expect(decision.disabled).toBe(false);
    expect(decision.label).toMatch(/Replace remembered supplier SKU OLD-CODE with NEW-CODE/i);
  });

  it("disables learning when the supplier SKU already belongs to another variant", () => {
    const decision = supplierLearningDecision([
      mapping({ variant_id: "variant-2", variant_name: "Medium", sku: "TEE-M", supplier_sku: "ACME-S" }),
    ], "supplier-1", "variant-1", "acme-s");

    expect(decision.defaultSelected).toBe(false);
    expect(decision.disabled).toBe(true);
    expect(decision.conflictingMapping?.variant_id).toBe("variant-2");
  });
});
