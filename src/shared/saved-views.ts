export type SavedViewPage = "inventory" | "purchasing";

export type InventorySavedViewConfig = {
  query: string;
  locationId: string | null;
  stock: "all" | "low" | "out" | "tracked" | "untracked";
};

export type PurchasingSavedViewConfig = {
  query: string;
  supplierId: string | null;
  status: "all" | "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  due: "all" | "overdue" | "due_7_days" | "no_date";
};

export type SavedViewConfig = InventorySavedViewConfig | PurchasingSavedViewConfig;

export type SavedViewRecord = {
  id: string;
  owner_actor_id: string;
  page: SavedViewPage;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
};

export type SavedView = Omit<SavedViewRecord, "config_json"> & {
  config: SavedViewConfig;
};
