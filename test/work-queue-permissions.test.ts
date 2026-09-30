import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("operations work queue permissions", () => {
  it("treats refresh as a derived read and lifecycle actions as controlled updates", () => {
    expect(permissionForRequest("/work-queue", "GET")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/refresh", "POST")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/frontline?category=stock_risk", "GET")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/metrics?days=30", "GET")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/item-1/acknowledge", "POST")).toEqual({ resource: "work_queue", action: "update" });
    expect(permissionForRequest("/work-queue/item-1/resolve", "POST")).toEqual({ resource: "work_queue", action: "update" });
    expect(permissionForRequest("/work-queue/item-1/assign", "POST")).toEqual({ resource: "work_queue", action: "update" });
    expect(permissionForRequest("/work-queue/item-1/schedule", "POST")).toEqual({ resource: "work_queue", action: "update" });
  });

  it("lets frontline operational roles own their server-scoped queue while keeping viewers out", () => {
    for (const role of ["owner", "admin", "manager", "inventory", "fulfilment"] as const) {
      expect(can(role, "work_queue", "read")).toBe(true);
      expect(can(role, "work_queue", "update")).toBe(true);
    }
    expect(can("viewer", "work_queue", "read")).toBe(false);
    expect(can("viewer", "work_queue", "update")).toBe(false);
  });

  it("keeps onboarding health read-only at the settings boundary", () => {
    expect(permissionForRequest("/onboarding/health", "GET")).toEqual({ resource: "settings", action: "read" });
  });
});
