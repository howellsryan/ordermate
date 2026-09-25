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

  it("classifies order and purchase-order lifecycle actions as updates", () => {
    expect(permissionForRequest("/orders/123/confirm", "POST")).toEqual({ resource: "orders", action: "update" });
    expect(permissionForRequest("/orders/123/fulfil", "POST")).toEqual({ resource: "orders", action: "update" });
    expect(permissionForRequest("/purchase-orders/123/receive", "POST")).toEqual({ resource: "purchasing", action: "update" });
  });

  it("fails closed for unknown tenant routes", () => {
    const permission = permissionForRequest("/future-unclassified-endpoint", "GET");
    expect(permission.resource).toBe("unknown");
    expect(can("owner", permission.resource, permission.action)).toBe(false);
    expect(can("viewer", permission.resource, permission.action)).toBe(false);
  });
});
