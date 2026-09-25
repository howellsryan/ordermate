import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("operations analytics permissions", () => {
  it("protects commercial operations reports separately from broad audit reporting", () => {
    expect(permissionForRequest("/reports/operations", "GET")).toEqual({ resource: "analytics", action: "read" });
    expect(permissionForRequest("/audit", "GET")).toEqual({ resource: "reports", action: "read" });

    for (const role of ["owner", "admin", "manager", "inventory", "viewer"] as const) {
      expect(can(role, "analytics", "read")).toBe(true);
    }
    expect(can("fulfilment", "analytics", "read")).toBe(false);
    expect(can("fulfilment", "reports", "read")).toBe(true);
  });
});
