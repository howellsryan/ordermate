import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("integration permission boundary", () => {
  it("allows connection metadata reads only to roles that need operational visibility", () => {
    expect(permissionForRequest("/integrations", "GET")).toEqual({ resource: "integrations", action: "read" });
    expect(can("owner", "integrations", "read")).toBe(true);
    expect(can("admin", "integrations", "read")).toBe(true);
    expect(can("manager", "integrations", "read")).toBe(true);
    expect(can("inventory", "integrations", "read")).toBe(false);
    expect(can("fulfilment", "integrations", "read")).toBe(false);
    expect(can("viewer", "integrations", "read")).toBe(false);
  });

  it("reserves connection mutation for owner/admin", () => {
    expect(can("owner", "integrations", "update")).toBe(true);
    expect(can("admin", "integrations", "update")).toBe(true);
    expect(can("manager", "integrations", "update")).toBe(false);
  });

  it("keeps Worker-internal credential and event routes fail-closed through the public tenant proxy", () => {
    for (const path of [
      "/__integrations/credentials/connection-id",
      "/__integrations/events/receive",
      "/__integrations/connections/connection-id/status",
    ]) {
      const permission = permissionForRequest(path, path.includes("credentials") ? "GET" : "POST");
      expect(permission.resource).toBe("unknown");
      expect(can("owner", permission.resource, permission.action)).toBe(false);
      expect(can("admin", permission.resource, permission.action)).toBe(false);
    }
  });
});
