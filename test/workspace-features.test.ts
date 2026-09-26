import { describe, expect, it } from "vitest";
import {
  WORKSPACE_FEATURES,
  defaultFeatureConfiguration,
  effectiveWorkspaceFeatures,
  isWorkspaceFeatureKey,
  validateFeatureConfiguration,
} from "../src/shared/features";
import { WORKSPACE_MODULE_KEYS, type WorkspaceModuleKey } from "../src/shared/modules";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("workspace feature flags", () => {
  it("keeps existing behaviour enabled by default", () => {
    const defaults = defaultFeatureConfiguration();
    expect(WORKSPACE_FEATURES.length).toBeGreaterThan(0);
    expect(WORKSPACE_FEATURES.every(feature => defaults[feature.key])).toBe(true);
    expect(defaults.operating_intelligence).toBe(true);
    expect(defaults.operations_copilot).toBe(true);
    expect(defaults.wave_picking).toBe(true);
  });

  it("recognises only declared feature keys", () => {
    expect(isWorkspaceFeatureKey("flow_plan")).toBe(true);
    expect(isWorkspaceFeatureKey("made_up_feature")).toBe(false);
  });

  it("remembers child preferences while a parent feature is temporarily off", () => {
    const config = defaultFeatureConfiguration();
    config.operating_intelligence = false;
    expect(config.flow_plan).toBe(true);
    expect(config.smart_buy_batches).toBe(true);
    expect(validateFeatureConfiguration(config)).toEqual([]);
  });

  it("only activates features when their required modules and parent features are active", () => {
    const config = defaultFeatureConfiguration();
    const allModules = new Set<WorkspaceModuleKey>(WORKSPACE_MODULE_KEYS);
    let effective = effectiveWorkspaceFeatures(config, allModules);
    expect(effective.has("operating_intelligence")).toBe(true);
    expect(effective.has("flow_plan")).toBe(true);
    expect(effective.has("wave_picking")).toBe(true);

    const withoutInventory = new Set(allModules);
    withoutInventory.delete("inventory");
    effective = effectiveWorkspaceFeatures(config, withoutInventory);
    expect(effective.has("operating_intelligence")).toBe(false);
    expect(effective.has("flow_plan")).toBe(false);
    expect(effective.has("inventory_history")).toBe(false);
    expect(effective.has("saved_views")).toBe(true);

    const withoutOrders = new Set(allModules);
    withoutOrders.delete("orders");
    effective = effectiveWorkspaceFeatures(config, withoutOrders);
    expect(effective.has("wave_picking")).toBe(false);

    config.operating_intelligence = false;
    effective = effectiveWorkspaceFeatures(config, allModules);
    expect(effective.has("flow_plan")).toBe(false);
    expect(effective.has("smart_buy_batches")).toBe(false);
    expect(effective.has("operations_copilot")).toBe(true);
  });

  it("allows everyone to read feature configuration but only owners and admins to change it", () => {
    expect(permissionForRequest("/features", "GET")).toEqual({ resource: "features", action: "read" });
    expect(permissionForRequest("/features/flow_plan", "PATCH")).toEqual({ resource: "features", action: "update" });
    expect(can("owner", "features", "update")).toBe(true);
    expect(can("admin", "features", "update")).toBe(true);
    expect(can("manager", "features", "update")).toBe(false);
    expect(can("inventory", "features", "read")).toBe(true);
    expect(can("viewer", "features", "read")).toBe(true);
  });
});
