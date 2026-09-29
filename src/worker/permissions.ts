import type { Role } from "../shared/types";

export type Resource = "catalogue" | "inventory" | "stocktake" | "purchasing" | "orders" | "order_planning" | "customers" | "crm" | "service" | "modules" | "features" | "integrations" | "work_queue" | "reports" | "analytics" | "settings" | "members" | "preferences" | "unknown";
export type Action = "read" | "create" | "update" | "delete";

type Grant = "*" | readonly Action[];
type RolePolicy = Partial<Record<Resource, Grant>>;

const ALL: RolePolicy = {
  catalogue: "*", inventory: "*", stocktake: "*", purchasing: "*", orders: "*", order_planning: "*", customers: "*", crm: "*", service: "*", modules: "*", features: "*", integrations: "*", work_queue: "*", reports: "*", analytics: "*", settings: "*", members: "*", preferences: "*",
};

const policies: Record<Role, RolePolicy> = {
  owner: ALL,
  admin: ALL,
  manager: {
    catalogue: "*", inventory: ["read", "update"], stocktake: "*", purchasing: "*", orders: "*", order_planning: "*", customers: "*", crm: "*", service: "*", modules: ["read"], features: ["read"], integrations: ["read"], work_queue: "*", reports: ["read"], analytics: ["read"], settings: ["read", "update"], members: ["read"], preferences: "*",
  },
  inventory: {
    catalogue: ["read"], inventory: "*", stocktake: "*", purchasing: "*", orders: ["read"], customers: ["read"], crm: ["read"], service: ["read"], modules: ["read"], features: ["read"], work_queue: ["read", "update"], reports: ["read"], analytics: ["read"], preferences: "*",
  },
  fulfilment: {
    catalogue: ["read"], inventory: ["read", "update"], orders: ["read", "update"], customers: ["read"], crm: ["read"], service: ["read", "update"], modules: ["read"], features: ["read"], work_queue: ["read", "update"], reports: ["read"], preferences: "*",
  },
  viewer: {
    catalogue: ["read"], inventory: ["read"], purchasing: ["read"], orders: ["read"], customers: ["read"], crm: ["read"], service: ["read"], modules: ["read"], features: ["read"], reports: ["read"], analytics: ["read"], settings: ["read"], members: ["read"], preferences: "*",
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  const grant = policies[role]?.[resource];
  return grant === "*" || Array.isArray(grant) && grant.includes(action);
}

export function permissionForRequest(path: string, method: string): { resource: Resource; action: Action } {
  const action: Action = method === "GET" || method === "HEAD" ? "read" : method === "DELETE" ? "delete" : method === "POST" ? "create" : "update";

  if (path.startsWith("/modules")) return { resource: "modules", action };
  if (path.startsWith("/features")) return { resource: "features", action };
  if (path.startsWith("/integrations")) return { resource: "integrations", action };
  if (path.startsWith("/work-queue")) {
    if (method === "GET" || method === "HEAD" || path === "/work-queue/refresh") return { resource: "work_queue", action: "read" };
    return { resource: "work_queue", action: "update" };
  }
  if (path.startsWith("/onboarding")) return { resource: "settings", action: "read" };
  if (path.startsWith("/business-profile")) return { resource: "settings", action };
  if (path.startsWith("/crm/contacts")) {
    const lifecycleAction = method === "POST" && /\/convert$/.test(path) ? "update" : action;
    return { resource: "crm", action: lifecycleAction };
  }
  if (path.startsWith("/service")) {
    const lifecycleAction = method === "POST" && /\/(qualify|convert-to-quote|convert-to-job|send|accept|reject|create-job|start|complete|materials|issue|payments|void)$/.test(path) ? "update" : action;
    return { resource: "service", action: lifecycleAction };
  }
  if (path.startsWith("/saved-views")) return { resource: "preferences", action };
  if (path.startsWith("/imports/catalogue")) return { resource: "catalogue", action: "create" };
  if (path.startsWith("/products") || path.startsWith("/categories")) return { resource: "catalogue", action };
  if (path.startsWith("/locations")) return { resource: "inventory", action };
  if (path === "/inventory/stocktake") return { resource: "stocktake", action: "create" };
  if (path.startsWith("/inventory-policies")) return { resource: "purchasing", action };
  if (path.startsWith("/inventory")) return { resource: "inventory", action: method === "POST" ? "update" : action };
  if (path.startsWith("/suppliers")) return { resource: "purchasing", action };
  if (path.startsWith("/supplier-variants")) return { resource: "purchasing", action: method === "POST" ? "update" : action };
  if (path.startsWith("/delivery-discrepancies")) return { resource: "purchasing", action };
  if (path.startsWith("/replenishment")) return { resource: "purchasing", action: "read" };
  if (path.startsWith("/purchase-orders")) {
    const lifecycleAction = method === "POST" && /\/(submit|receive|cancel)$/.test(path) ? "update" : action;
    return { resource: "purchasing", action: lifecycleAction };
  }
  if (/^\/orders\/[^/]+\/planning$/.test(path)) return { resource: "order_planning", action: "update" };
  if (path.startsWith("/orders")) {
    const lifecycleAction = method === "POST" && /\/(confirm|fulfil|cancel|return)$/.test(path) ? "update" : action;
    return { resource: "orders", action: lifecycleAction };
  }
  if (path.startsWith("/customers")) return { resource: "customers", action };
  if (path.startsWith("/settings")) return { resource: "settings", action };
  if (path.startsWith("/reports")) return { resource: "analytics", action: "read" };
  if (path.startsWith("/audit") || path.startsWith("/dashboard") || path.startsWith("/barcode")) return { resource: "reports", action: "read" };

  return { resource: "unknown", action };
}
