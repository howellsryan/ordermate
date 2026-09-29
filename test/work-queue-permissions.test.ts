import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("operations work queue permissions", () => {
  it("treats refresh as a derived read and lifecycle actions as controlled updates", () => {
    expect(permissionForRequest("/work-queue", "GET")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/refresh", "POST")).toEqual({ resource: "work_queue", action: "read" });
    expect(permissionForRequest("/work-queue/item-1/acknowledge", "POST")).toEqual({ resource: "work_queue", action: "update" });
    expect(permissionForRequest("/work-queue/item-1/resolve", "POST")).toEqual({ resource: "work_queue", action: "update" });
  });

  it("keeps the cross-domain persistent queue within management roles for the first release", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      expect(can(role, "work_queue", "read")).toBe(true);
      expect(can(role, "work_queue", "update")).toBe(true);
    }
    for (const role of ["inventory", "fulfilment", "viewer"] as const) {
      expect(can(role, "work_queue", "read")).toBe(false);
      expect(can(role, "work_queue", "update")).toBe(false);
    }
  });
});
