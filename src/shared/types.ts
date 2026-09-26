export type Role = "owner" | "admin" | "manager" | "inventory" | "fulfilment" | "viewer";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: Role;
};

export type SessionPayload = {
  user: { id: string; name: string; email: string; image?: string | null };
  organizations: OrganizationSummary[];
};

export type DashboardSummary = {
  ordersOpen: number;
  ordersAwaitingFulfilment: number;
  purchaseOrdersOpen: number;
  lowStockVariants: number;
  inventoryValueMinor: number;
  currency: string;
};
