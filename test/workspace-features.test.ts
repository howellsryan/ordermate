import { describe, expect, it } from "vitest";
import {
  WORKSPACE_FEATURES,
  defaultFeatureConfiguration,
  isWorkspaceFeatureKey,
  validateFeatureConfiguration,
} from "../src/shared/features";
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
