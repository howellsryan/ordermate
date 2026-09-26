import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDemoProfileData } from "./demo-profile-data";
import { chooseDemoProfile, type DemoProfileKey } from "./demo-profiles";
import { resetDemoData } from "./demo-store";

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

function seededProfile(profile: DemoProfileKey) {
  chooseDemoProfile(profile);
  resetDemoData();
  applyDemoProfileData(profile);
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  expect(raw).toBeTruthy();
  return JSON.parse(raw!) as Record<string, any>;
}

describe("profile-specific guest demo data", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
  });

  it.each(["retail", "electrician", "salon", "cafe"] as const)("removes ecommerce-only add-ons and Northstar team branding from %s", profile => {
    const state = seededProfile(profile);
    expect(state.modifiers).toEqual([]);
    expect(state.products.every((product: Record<string, any>) => Array.isArray(product.modifiers) && product.modifiers.length === 0)).toBe(true);
    expect(state.orders.flatMap((order: Record<string, any>) => order.lines || []).every((line: Record<string, any>) => Array.isArray(line.modifiers) && line.modifiers.length === 0)).toBe(true);
    expect(JSON.stringify(state)).not.toContain("Custom carton label");
    expect(JSON.stringify(state)).not.toContain("Priority handling");
    expect((state.members || []).some((member: Record<string, any>) => String(member.email || "").includes("northstar.example"))).toBe(false);
  });

  it.each(["electrician", "salon", "cafe"] as const)("does not retain commerce-order history when Orders is disabled for %s", profile => {
    const state = seededProfile(profile);
    expect(state.orders).toEqual([]);
    expect((state.audit || []).some((event: Record<string, any>) => String(event.action || "").startsWith("order.") || event.entity_type === "order")).toBe(false);
    expect(state.inventory.every((row: Record<string, any>) => Number(row.reserved || 0) === 0 && Number(row.available || 0) === Number(row.on_hand || 0))).toBe(true);
  });

  it("keeps the pure dropship profile free of merchant-owned commerce, purchasing and inventory seed data", () => {
    const state = seededProfile("dropship");
    expect(state.orders).toEqual([]);
    expect(state.customers).toEqual([]);
    expect(state.products).toEqual([]);
    expect(state.modifiers).toEqual([]);
    expect(state.locations).toEqual([]);
    expect(state.inventory).toEqual([]);
    expect(state.movements).toEqual([]);
    expect(state.purchaseOrders).toEqual([]);
    expect(state.supplierVariants).toEqual([]);
    expect(state.inventoryPolicies).toEqual([]);
    expect(state.suppliers).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it("rewrites supplier SKU display values away from the packaging seed", () => {
    const state = seededProfile("electrician");
    expect(state.supplierVariants).not.toHaveLength(0);
    expect(state.supplierVariants.map((row: Record<string, any>) => row.supplier_sku)).toEqual(
      state.supplierVariants.map((row: Record<string, any>) => row.sku),
    );
    expect(JSON.stringify(state.supplierVariants)).not.toContain("MP-MAIL");
    expect(JSON.stringify(state.supplierVariants)).not.toContain("AW-GRIP");
  });

  it("normalizes a selected profile once and preserves later browser-demo edits across reloads", () => {
    const state = seededProfile("electrician");
    state.orders.push({ id: "ord-custom", number: "ORD-CUSTOM", lines: [] });
    state.modifiers.push({ id: "mod-custom", name: "Customer supplied fitting", price_delta_minor: 0 });
    state.products[0].modifiers.push({ id: "mod-custom", name: "Customer supplied fitting", price_delta_minor: 0 });
    window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));

    applyDemoProfileData("electrician");

    const reloaded = JSON.parse(window.localStorage.getItem(DEMO_DATA_KEY)!) as Record<string, any>;
    expect(reloaded.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ord-custom" })]));
    expect(reloaded.modifiers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "mod-custom" })]));
    expect(reloaded.products[0].modifiers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "mod-custom" })]));
  });
});
