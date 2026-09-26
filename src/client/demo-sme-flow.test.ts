import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBuyBatches, deterministicPlanningSupplier } from "../shared/buy-batches";
import { buildFlowPlan } from "../shared/flow-plan";
import { tenantApi, tenantOpsApi } from "./api";
import type { AttentionResponse, InventoryRow, Product, PurchaseOrderDetail, ReplenishmentResponse, SupplierVariant } from "./model";
import { DEMO_TENANT_ID, enterDemoMode, resetDemoData } from "./demo-store";
import { resetDemoSupplierOrdering } from "./demo-supplier-ordering";

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

async function productTaxRate(variantId: string) {
  const products = await tenantApi<Product[]>(DEMO_TENANT_ID, "/products");
  return products.flatMap(product => product.variants).find(variant => variant.id === variantId)?.tax_rate_bps ?? 2000;
}

describe("guest demo SME automation journey", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
    resetDemoSupplierOrdering();
    enterDemoMode();
  });

  it("builds the same exception-first Flow Plan from demo attention and replenishment data", async () => {
    const [attention, replenishment] = await Promise.all([
      tenantOpsApi<AttentionResponse>(DEMO_TENANT_ID, "/attention"),
      tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment"),
    ]);

    const plan = buildFlowPlan(attention.items, replenishment, replenishment.generated_at);

    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.length).toBeLessThanOrEqual(8);
    expect(plan.actions.some(action => action.category === "customer_promise" || action.category === "supply_risk")).toBe(true);
  });

  it("persists demo MOQ/pack edits and recalculates an order-ready recommendation", async () => {
    const before = await tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment");
    const suggestion = before.suggestions.find(row => deterministicPlanningSupplier(row));
    expect(suggestion).toBeTruthy();
    const supplier = deterministicPlanningSupplier(suggestion!);
    expect(supplier).toBeTruthy();

    const mappings = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    const mapping = mappings.find(item => item.supplier_id === supplier!.supplierId && item.variant_id === suggestion!.variant_id);
    expect(mapping).toBeTruthy();

    const minimumOrderQuantity = suggestion!.scenarios.recommended + 7;
    await tenantApi(DEMO_TENANT_ID, "/supplier-variants", {
      method: "POST",
      body: JSON.stringify({
        supplierId: mapping!.supplier_id,
        variantId: mapping!.variant_id,
        supplierSku: mapping!.supplier_sku || undefined,
        lastCostMinor: mapping!.last_cost_minor ?? undefined,
        leadTimeDays: mapping!.lead_time_days ?? undefined,
        minimumOrderQuantity,
        orderMultiple: 10,
      }),
    });

    const savedMappings = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    expect(savedMappings.find(item => item.supplier_id === mapping!.supplier_id && item.variant_id === mapping!.variant_id)).toMatchObject({
      minimum_order_quantity: minimumOrderQuantity,
      order_multiple: 10,
    });

    const after = await tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment");
    const adjusted = after.positions.find(row => row.id === suggestion!.id)!;
    expect(adjusted.ordering_constraints?.supplier_id).toBe(mapping!.supplier_id);
    expect(adjusted.ordering_constraints?.adjusted).toBe(true);
    expect(adjusted.scenarios.recommended).toBeGreaterThanOrEqual(minimumOrderQuantity);
    expect(adjusted.scenarios.recommended % 10).toBe(0);
    expect(adjusted.explanation.some(line => line.includes("order-ready"))).toBe(true);
  });

  it("turns a demo stock risk into a Smart Buy batch and a reviewable draft PO without moving stock", async () => {
    await tenantApi(DEMO_TENANT_ID, "/inventory/adjust", {
      method: "POST",
      body: JSON.stringify({ variantId: "var-labels", locationId: "loc-birmingham", quantityDelta: -12, reason: "Demo Smart Buy validation" }),
    });

    const replenishment = await tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment");
    const batches = buildBuyBatches(replenishment.suggestions, replenishment.generated_at.slice(0, 10));
    const batch = batches.find(item => item.locationId === "loc-birmingham" && item.lines.some(line => line.variantId === "var-labels"));
    expect(batch).toBeTruthy();

    const inventoryBefore = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const beforeRow = inventoryBefore.find(row => row.variant_id === "var-labels" && row.location_id === "loc-birmingham")!;

    const created = await tenantApi<{ id: string }>(DEMO_TENANT_ID, "/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        supplierId: batch!.supplierId,
        locationId: batch!.locationId,
        notes: "Smart Buy demo validation",
        lines: await Promise.all(batch!.lines.map(async line => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostMinor: line.costMinor ?? 0,
          taxRateBps: await productTaxRate(line.variantId),
        }))),
      }),
    });

    const purchaseOrder = await tenantApi<PurchaseOrderDetail>(DEMO_TENANT_ID, `/purchase-orders/${created.id}`);
    expect(purchaseOrder.status).toBe("draft");
    expect(purchaseOrder.supplier_id).toBe(batch!.supplierId);
    expect(purchaseOrder.location_id).toBe(batch!.locationId);
    expect(purchaseOrder.lines).toHaveLength(batch!.lines.length);

    const inventoryAfter = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const afterRow = inventoryAfter.find(row => row.variant_id === "var-labels" && row.location_id === "loc-birmingham")!;
    expect(afterRow.on_hand).toBe(beforeRow.on_hand);
    expect(afterRow.incoming).toBe(beforeRow.incoming);
  });

  it("restores seeded buying terms when the user resets the browser demo", async () => {
    const initial = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    const tape = initial.find(item => item.supplier_id === "sup-pack" && item.variant_id === "var-tape")!;
    expect(tape).toMatchObject({ minimum_order_quantity: 24, order_multiple: 12 });

    await tenantApi(DEMO_TENANT_ID, "/supplier-variants", {
      method: "POST",
      body: JSON.stringify({
        supplierId: tape.supplier_id,
        variantId: tape.variant_id,
        supplierSku: tape.supplier_sku || undefined,
        lastCostMinor: tape.last_cost_minor ?? undefined,
        leadTimeDays: tape.lead_time_days ?? undefined,
        minimumOrderQuantity: 99,
        orderMultiple: 9,
      }),
    });
    const edited = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    expect(edited.find(item => item.supplier_id === tape.supplier_id && item.variant_id === tape.variant_id)).toMatchObject({ minimum_order_quantity: 99, order_multiple: 9 });

    resetDemoData();

    const reset = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    expect(reset.find(item => item.supplier_id === tape.supplier_id && item.variant_id === tape.variant_id)).toMatchObject({ minimum_order_quantity: 24, order_multiple: 12 });
  });
});
