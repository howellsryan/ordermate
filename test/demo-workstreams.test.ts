import { describe, expect, it } from "vitest";
import { DEMO_PROFILES } from "../src/client/demo-profiles";
import { DEMO_WORKSTREAMS } from "../src/client/demo-workstreams";

describe("vertical demo workstreams", () => {
  it("defines an explicit researched workstream for every demo profile", () => {
    for (const profile of DEMO_PROFILES) {
      const workstream = DEMO_WORKSTREAMS[profile.key];
      expect(workstream.profile).toBe(profile.key);
      expect(workstream.steps.length).toBeGreaterThanOrEqual(5);
      expect(new Set(workstream.steps.map(step => step.id)).size).toBe(workstream.steps.length);
    }
  });

  it("keeps cafe recipe depletion and waste outside the ordinary order model", () => {
    const cafe = DEMO_PROFILES.find(profile => profile.key === "cafe")!;
    expect(cafe.modules.orders).toBe(false);
    expect(cafe.modules.inventory).toBe(true);
    expect(cafe.modules.purchasing).toBe(true);

    const recipe = DEMO_WORKSTREAMS.cafe.steps.find(step => step.id === "recipe-sale")!;
    const waste = DEMO_WORKSTREAMS.cafe.steps.find(step => step.id === "waste")!;
    expect(recipe).toMatchObject({ kind: "vertical_prototype" });
    expect(recipe.target).toBeUndefined();
    expect(waste).toMatchObject({ kind: "vertical_prototype" });
    expect(waste.target).toBeUndefined();

    expect(DEMO_WORKSTREAMS.cafe.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "opening-count", kind: "live_core", target: "stocktake" }),
      expect.objectContaining({ id: "buy", kind: "live_core", target: "purchasing" }),
      expect.objectContaining({ id: "receive", kind: "live_core", target: "purchasing" }),
    ]));
  });

  it("does not represent pure dropshipping as merchant warehouse stock or fulfilment", () => {
    const dropship = DEMO_PROFILES.find(profile => profile.key === "dropship")!;
    expect(dropship.modules).toMatchObject({ orders: false, inventory: false, purchasing: false, warehouse: false });

    const physicalTargets = new Set(["orders", "warehouse", "inventory", "purchasing"]);
    expect(DEMO_WORKSTREAMS.dropship.steps.some(step => step.target && physicalTargets.has(step.target))).toBe(false);
    for (const step of DEMO_WORKSTREAMS.dropship.steps.filter(step => step.id !== "customer")) {
      expect(step.kind, step.id).toBe("vertical_prototype");
    }
    expect(DEMO_WORKSTREAMS.dropship.steps.find(step => step.id === "dispatch")?.detail).toContain("supplier");
  });

  it("uses the first-class service module for electrician and salon financial completion", () => {
    for (const key of ["electrician", "salon"] as const) {
      const profile = DEMO_PROFILES.find(item => item.key === key)!;
      expect(profile.modules).toMatchObject({ crm: true, service: true, orders: false });
      expect(DEMO_WORKSTREAMS[key].steps.some(step => step.kind === "live_core" && step.target === "service" && /invoice|payment/i.test(`${step.title} ${step.detail}`))).toBe(true);
    }
  });
});
