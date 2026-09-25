import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("tenant route permission classification", () => {
  it("treats creating a location as inventory create, not inventory update", () => {
    const permission = permissionForRequest("/locations", "POST");
    expect(permission).toEqual({ resource: "inventory", action: "create" });
    expect(can("fulfilment", permission.resource, permission.action)).toBe(false);
    expect(can("inventory", permission.resource, permission.action)).toBe(true);
  });

  it("keeps stock adjustments and transfers as inventory updates", () => {
    for (const path of ["/inventory/adjust", "/inventory/transfer"]) {
      const permission = permissionForRequest(path, "POST");
      expect(permission).toEqual({ resource: "inventory", action: "update" });
      expect(can("fulfilment", permission.resource, permission.action)).toBe(true);
    }
  });

  it("uses a dedicated permission boundary for reviewed cycle counts", () => {
    const permission = permissionForRequest("/inventory/stocktake", "POST");
    expect(permission).toEqual({ resource: "stocktake", action: "create" });
    expect(can("owner", permission.resource, permission.action)).toBe(true);
    expect(can("admin", permission.resource, permission.action)).toBe(true);
    expect(can("manager", permission.resource, permission.action)).toBe(true);
    expect(can("inventory", permission.resource, permission.action)).toBe(true);
    expect(can("fulfilment", permission.resource, permission.action)).toBe(false);
    expect(can("viewer", permission.resource, permission.action)).toBe(false);
  });

  it("classifies catalogue import preview and commit as catalogue creation", () => {
    for (const path of ["/imports/catalogue/preview", "/imports/catalogue/commit"]) {
      const permission = permissionForRequest(path, "POST");
      expect(permission).toEqual({ resource: "catalogue", action: "create" });
      expect(can("owner", permission.resource, permission.action)).toBe(true);
      expect(can("manager", permission.resource, permission.action)).toBe(true);
      expect(can("inventory", permission.resource, permission.action)).toBe(false);
      expect(can("fulfilment", permission.resource, permission.action)).toBe(false);
      expect(can("viewer", permission.resource, permission.action)).toBe(false);
    }
  });

  it("classifies order and purchase-order lifecycle actions as updates", () => {
    expect(permissionForRequest("/orders/123/confirm", "POST")).toEqual({ resource: "orders", action: "update" });
    expect(permissionForRequest("/orders/123/fulfil", "POST")).toEqual({ resource: "orders", action: "update" });
    expect(permissionForRequest("/purchase-orders/123/receive", "POST")).toEqual({ resource: "purchasing", action: "update" });
    expect(permissionForRequest("/purchase-orders/123/cancel", "POST")).toEqual({ resource: "purchasing", action: "update" });
    expect(permissionForRequest("/purchase-orders/123/expected-delivery", "PATCH")).toEqual({ resource: "purchasing", action: "update" });
    expect(can("inventory", "purchasing", "update")).toBe(true);
    expect(can("fulfilment", "purchasing", "update")).toBe(false);
    expect(can("viewer", "purchasing", "update")).toBe(false);
  });

  it("classifies delivery discrepancy history/resolution as purchasing but keeps the internal create route fail-closed", () => {
    expect(permissionForRequest("/delivery-discrepancies", "GET")).toEqual({ resource: "purchasing", action: "read" });
    expect(permissionForRequest("/delivery-discrepancies/discrepancy-1", "PATCH")).toEqual({ resource: "purchasing", action: "update" });
    expect(can("inventory", "purchasing", "update")).toBe(true);
    expect(can("viewer", "purchasing", "read")).toBe(true);
    expect(can("viewer", "purchasing", "update")).toBe(false);
    expect(can("fulfilment", "purchasing", "read")).toBe(false);

    const internal = permissionForRequest("/internal/delivery-discrepancies", "POST");
    expect(internal.resource).toBe("unknown");
    expect(can("owner", internal.resource, internal.action)).toBe(false);
  });

  it("classifies supplier mappings and replenishment as purchasing operations", () => {
    expect(permissionForRequest("/supplier-variants", "GET")).toEqual({ resource: "purchasing", action: "read" });
    expect(permissionForRequest("/supplier-variants", "POST")).toEqual({ resource: "purchasing", action: "update" });
    expect(permissionForRequest("/supplier-variants/supplier/variant", "DELETE")).toEqual({ resource: "purchasing", action: "delete" });
    expect(permissionForRequest("/replenishment", "GET")).toEqual({ resource: "purchasing", action: "read" });

    expect(can("inventory", "purchasing", "update")).toBe(true);
    expect(can("viewer", "purchasing", "read")).toBe(true);
    expect(can("viewer", "purchasing", "update")).toBe(false);
    expect(can("fulfilment", "purchasing", "read")).toBe(false);
  });

  it("allows every role to read dashboard and audit reporting without granting commercial settings", () => {
    for (const role of ["owner", "admin", "manager", "inventory", "fulfilment", "viewer"] as const) {
      expect(can(role, "reports", "read")).toBe(true);
    }
    expect(can("fulfilment", "settings", "read")).toBe(false);
    expect(can("inventory", "settings", "read")).toBe(false);
  });

  it("keeps fulfilment isolated from purchasing data", () => {
    expect(can("fulfilment", "purchasing", "read")).toBe(false);
    expect(can("inventory", "purchasing", "read")).toBe(true);
    expect(can("viewer", "purchasing", "read")).toBe(true);
  });

  it("fails closed for unknown tenant routes", () => {
    const permission = permissionForRequest("/future-unclassified-endpoint", "GET");
    expect(permission.resource).toBe("unknown");
    expect(can("owner", permission.resource, permission.action)).toBe(false);
    expect(can("viewer", permission.resource, permission.action)).toBe(false);
  });
});
