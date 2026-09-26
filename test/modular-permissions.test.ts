import { describe, expect, it } from "vitest";
import { can, permissionForRequest } from "../src/worker/permissions";

describe("modular CRM and service permissions", () => {
  it("treats business invoice identity as workspace settings", () => {
    expect(permissionForRequest("/business-profile", "GET")).toEqual({ resource: "settings", action: "read" });
    expect(permissionForRequest("/business-profile", "PATCH")).toEqual({ resource: "settings", action: "update" });
    expect(can("manager", "settings", "update")).toBe(true);
    expect(can("viewer", "settings", "update")).toBe(false);
  });

  it("allows only owners and admins to change workspace module configuration", () => {
    expect(permissionForRequest("/modules", "GET")).toEqual({ resource: "modules", action: "read" });
    expect(permissionForRequest("/modules/service", "PATCH")).toEqual({ resource: "modules", action: "update" });
    expect(can("owner", "modules", "update")).toBe(true);
    expect(can("admin", "modules", "update")).toBe(true);
    expect(can("manager", "modules", "update")).toBe(false);
    expect(can("viewer", "modules", "update")).toBe(false);
  });

  it("classifies CRM conversion and service lifecycle transitions as updates", () => {
    expect(permissionForRequest("/crm/contacts/contact-1/convert", "POST")).toEqual({ resource: "crm", action: "update" });
    expect(permissionForRequest("/service/requests/request-1/qualify", "POST")).toEqual({ resource: "service", action: "update" });
    expect(permissionForRequest("/service/invoices/invoice-1/issue", "POST")).toEqual({ resource: "service", action: "update" });
    expect(permissionForRequest("/service/invoices/invoice-1/payments", "POST")).toEqual({ resource: "service", action: "update" });
    expect(can("manager", "crm", "update")).toBe(true);
    expect(can("manager", "service", "update")).toBe(true);
    expect(can("viewer", "service", "update")).toBe(false);
  });
});
