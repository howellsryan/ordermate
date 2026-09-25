import type { Role } from "../shared/types";

export type Resource = "catalogue" | "inventory" | "purchasing" | "orders" | "customers" | "reports" | "settings" | "members" | "unknown";
export type Action = "read" | "create" | "update" | "delete";

type Grant = "*" | readonly Action[];
type RolePolicy = Partial<Record<Resource, Grant>>;

const ALL: RolePolicy = {
  catalogue: "*", inventory: "*", purchasing: "*", orders: "*", customers: "*", reports: "*", settings: "*", members: "*",
};

const policies: Record<Role, RolePolicy> = {
  owner: ALL,
  admin: ALL,
  manager: {
    catalogue: "*", inventory: ["read", "update"], purchasing: "*", orders: "*", customers: "*", reports: ["read"], settings: ["read", "update"], members: ["read"],
  },
  inventory: {
    catalogue: ["read"], inventory: "*", purchasing: "*", orders: ["read"], customers: ["read"], reports: ["read"],
  },
  fulfilment: {
    catalogue: ["read"], inventory: ["read", "update"], orders: ["read", "update"], customers: ["read"], reports: ["read"],
  },
  viewer: {
    catalogue: ["read"], inventory: ["read"], purchasing: ["read"], orders: ["read"], customers: ["read"], reports: ["read"], settings: ["read"], members: ["read"],
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  const grant = policies[role]?.[resource];
  return grant === "*" || Array.isArray(grant) && grant.includes(action);
}

export function permissionForRequest(path: string, method: string): { resource: Resource; action: Action } {
  const action: Action = method === "GET" || method === "HEAD" ? "read" : method === "DELETE" ? "delete" : method === "POST" ? "create" : "update";

  if (path.startsWith("/products") || path.startsWith("/categories")) return { resource: "catalogue", action };
  if (path.startsWith("/locations")) return { resource: "inventory", action };
  if (path.startsWith("/inventory-policies")) return { resource: "purchasing", action };
  if (path.startsWith("/inventory")) return { resource: "inventory", action: method === "POST" ? "update" : action };
  if (path.startsWith("/suppliers")) return { resource: "purchasing", action };
  if (path.startsWith("/supplier-variants")) return { resource: "purchasing", action: method === "POST" ? "update" : action };
  if (path.startsWith("/replenishment")) return { resource: "purchasing", action: "read" };
  if (path.startsWith("/purchase-orders")) {
    const lifecycleAction = method === "POST" && /\/(submit|receive|cancel)$/.test(path) ? "update" : action;
    return { resource: "purchasing", action: lifecycleAction };
  }
  if (path.startsWith("/orders")) {
    const lifecycleAction = method === "POST" && /\/(confirm|fulfil|cancel|return)$/.test(path) ? "update" : action;
    return { resource: "orders", action: lifecycleAction };
  }
  if (path.startsWith("/customers")) return { resource: "customers", action };
  if (path.startsWith("/settings")) return { resource: "settings", action };
  if (path.startsWith("/audit") || path.startsWith("/dashboard") || path.startsWith("/barcode")) return { resource: "reports", action: "read" };

  return { resource: "unknown", action };
}
