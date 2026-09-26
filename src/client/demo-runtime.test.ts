import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueImportPlan } from "../shared/catalogue-import";
import type { OperationsReport } from "../shared/operations-report";
import { controlApi, tenantApi, tenantOpsApi } from "./api";
import { DEMO_TENANT_ID, enterDemoMode, resetDemoData } from "./demo-store";
import { demoCsv } from "./demo-runtime";
import type { InventoryRow, OrderDetail, Product, PurchaseOrderDetail, ReplenishmentResponse, SupplierVariant } from "./model";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";

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

describe("hardened local guest demo", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("reconciles seeded commercial totals, reservations and incoming stock", async () => {
    const orders = await tenantApi<OrderDetail[]>(DEMO_TENANT_ID, "/orders");
    const purchaseOrders = await tenantApi<PurchaseOrderDetail[]>(DEMO_TENANT_ID, "/purchase-orders");
    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");

    expect(orders.find(order => order.id === "ord-1")?.total_minor).toBe(9972);
    expect(orders.find(order => order.id === "ord-3")?.total_minor).toBe(5130);
    expect(purchaseOrders.find(po => po.id === "po-2")?.subtotal_minor).toBe(29664);

    const mailerSmall = inventory.find(row => row.variant_id === "var-mailer-s" && row.location_id === "loc-nottingham");
    const mailerMedium = inventory.find(row => row.variant_id === "var-mailer-m" && row.location_id === "loc-nottingham");
    const labels = inventory.find(row => row.variant_id === "var-labels" && row.location_id === "loc-nottingham");
    expect(mailerSmall?.reserved).toBe(30);
    expect(mailerSmall?.incoming).toBe(120);
    expect(mailerMedium?.reserved).toBe(6);
    expect(mailerMedium?.incoming).toBe(0);
    expect(labels?.reserved).toBe(4);
    expect(labels?.incoming).toBe(0);
  });

  it("normalises movement history for the Inventory History UI", async () => {
    const movements = await tenantOpsApi<Array<{ quantity_delta: number; actor_name: string; movement_type: string; barcode: string | null }>>(DEMO_TENANT_ID, "/movements");
    expect(movements.length).toBeGreaterThan(0);
    expect(movements[0]?.quantity_delta).toBeTypeOf("number");
    expect(movements[0]?.actor_name).toBe("Guest operator");
    expect(movements.some(item => item.movement_type === "order_fulfilment")).toBe(true);
    expect(movements.some(item => item.barcode !== null)).toBe(true);
  });

  it("uses movement timestamps as the demand history for demo operating intelligence", async () => {
    const raw = JSON.parse(localStorage.getItem(DEMO_DATA_KEY) || "{}") as { movements: Array<Record<string, unknown>> };
    raw.movements = raw.movements.filter(item => !(item.variant_id === "var-tape" && item.location_id === "loc-birmingham" && item.movement_type === "order_fulfilment"));
    const movementBase = {
      product_name: "Paper Packing Tape",
      variant_name: "50 mm × 50 m",
      sku: "TAPE-PAPER-50",
      variant_id: "var-tape",
      location_id: "loc-birmingham",
      location_name: "Birmingham Overflow",
      movement_type: "order_fulfilment",
      reference_type: "order",
      reference_id: "forecast-test",
      reason: null,
      actor_id: "demo-user",
      actor_role: "owner",
    };
    raw.movements.push({ ...movementBase, id: "forecast-recent", quantity: -30, created_at: new Date().toISOString() });
    raw.movements.push({ ...movementBase, id: "forecast-prior", quantity: -60, created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() });
    localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(raw));

    const intelligence = await tenantApi<ReplenishmentResponse>(DEMO_TENANT_ID, "/replenishment");
    const position = intelligence.positions.find(row => row.variant_id === "var-tape" && row.location_id === "loc-birmingham");

    expect(position?.fulfilled_30d).toBe(30);
    expect(position?.fulfilled_prev_60d).toBe(60);
  });

  it("uses the selected report window for physical movement KPIs and trends", async () => {
    await tenantApi(DEMO_TENANT_ID, "/inventory/adjust", {
      method: "POST",
      body: JSON.stringify({ variantId: "var-tape", locationId: "loc-birmingham", quantityDelta: 2, reason: "window test" }),
    });
    const raw = JSON.parse(localStorage.getItem(DEMO_DATA_KEY) || "{}") as { movements: Array<{ movement_type: string; quantity: number; created_at: string }> };
    raw.movements.push({ movement_type: "purchase_receipt", quantity: 99, created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString() });
    localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(raw));

    const seven = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=7");
    const sixty = await tenantApi<OperationsReport>(DEMO_TENANT_ID, "/reports/operations?days=60");

    expect(seven.orderTrend).toHaveLength(7);
    expect(sixty.orderTrend).toHaveLength(60);
    expect(sixty.purchasing.receivedUnits - seven.purchasing.receivedUnits).toBe(99);
  });

  it("exports populated purchase orders and a valid empty discrepancy dataset", async () => {
    await tenantApi(DEMO_TENANT_ID, "/purchase-orders");
    const purchaseOrders = demoCsv("purchase-orders");
    const discrepancies = demoCsv("delivery-discrepancies");

    expect(purchaseOrders.content).toContain("PO-2026-000142");
    expect(purchaseOrders.content).toContain("Midlands Packaging Ltd");
    expect(discrepancies.content).toContain("issue_count");
    expect(discrepancies.content).not.toContain("export is empty");
  });

  it("dry-runs and atomically commits a catalogue CSV entirely in localStorage", async () => {
    const rows = [{
      rowNumber: 2,
      productName: "Demo Void Fill",
      variantName: "10 litre",
      sku: "VOID-DEMO-10",
      description: "Local import test",
      category: "Packaging",
      barcode: "5056400199992",
      price: "8.50",
      cost: "4.10",
      taxPercent: "20",
      options: { Size: "10 litre" },
      locationCode: "NOT",
      openingStock: "25",
      supplierName: "Midlands Packaging Ltd",
      supplierSku: "MP-VOID-10",
      supplierCost: "3.95",
      leadTimeDays: "4",
    }];

    const plan = await tenantApi<CatalogueImportPlan>(DEMO_TENANT_ID, "/imports/catalogue/preview", { method: "POST", body: JSON.stringify({ rows }) });
    expect(plan.canCommit).toBe(true);
    expect(plan.summary.productsToCreate).toBe(1);
    await tenantApi(DEMO_TENANT_ID, "/imports/catalogue/commit", { method: "POST", body: JSON.stringify({ rows, expectedFingerprint: plan.fingerprint }) });

    const products = await tenantApi<Product[]>(DEMO_TENANT_ID, "/products");
    const imported = products.find(product => product.name === "Demo Void Fill");
    expect(imported?.variants[0]?.sku).toBe("VOID-DEMO-10");

    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    expect(inventory.find(row => row.variant_id === imported?.variants[0]?.id && row.location_id === "loc-nottingham")?.on_hand).toBe(25);
  });

  it("adds demo teammates locally rather than creating unusable invite links", async () => {
    enterDemoMode();
    const result = await controlApi<{ inviteUrl: string }>(`/organizations/${DEMO_TENANT_ID}/invites`, {
      method: "POST",
      body: JSON.stringify({ email: "jamie@example.com", role: "inventory" }),
    });
    const team = await controlApi<{ members: Array<{ email: string; role: string }>; pendingInvites: unknown[] }>(`/organizations/${DEMO_TENANT_ID}/members`);

    expect(result.inviteUrl).toBe("");
    expect(team.members).toContainEqual(expect.objectContaining({ email: "jamie@example.com", role: "inventory" }));
    expect(team.pendingInvites).toHaveLength(0);
  });

  it("keeps derived inventory and supplier labels in sync after catalogue edits", async () => {
    const products = await tenantApi<Product[]>(DEMO_TENANT_ID, "/products");
    const product = products.find(item => item.id === "prod-mailer")!;
    await tenantApi(DEMO_TENANT_ID, "/products/prod-mailer", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Recycled Mailer Box Pro",
        category: product.category_name,
        description: product.description,
        variants: product.variants.map(variant => ({
          id: variant.id,
          name: variant.name,
          sku: variant.id === "var-mailer-s" ? "BOX-MAIL-S-PRO" : variant.sku,
          barcode: variant.barcode,
          priceMinor: variant.price_minor,
          costMinor: variant.cost_minor,
          taxRateBps: variant.tax_rate_bps,
        })),
      }),
    });
    await tenantApi(DEMO_TENANT_ID, "/products/prod-mailer/status", { method: "PATCH", body: JSON.stringify({ status: "archived" }) });

    const inventory = await tenantApi<InventoryRow[]>(DEMO_TENANT_ID, "/inventory");
    const mappings = await tenantApi<SupplierVariant[]>(DEMO_TENANT_ID, "/supplier-variants");
    expect(inventory.find(row => row.variant_id === "var-mailer-s")?.product_status).toBe("archived");
    expect(inventory.find(row => row.variant_id === "var-mailer-s")?.sku).toBe("BOX-MAIL-S-PRO");
    expect(mappings.find(mapping => mapping.variant_id === "var-mailer-s")?.product_name).toBe("Recycled Mailer Box Pro");
    expect(mappings.find(mapping => mapping.variant_id === "var-mailer-s")?.sku).toBe("BOX-MAIL-S-PRO");
  });
});
