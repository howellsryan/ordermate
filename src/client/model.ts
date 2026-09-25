export type ProductModifier = {
  id: string;
  name: string;
  price_delta_minor: number;
};

export type ProductVariant = {
  id: string;
  product_id?: string;
  name: string;
  sku: string;
  barcode?: string | null;
  price_minor: number;
  cost_minor: number;
  tax_rate_bps: number;
  active?: number;
  options: Record<string, string>;
};

export type Product = {
  id: string;
  name: string;
  description?: string | null;
  category_name?: string | null;
  status: string;
  variants: ProductVariant[];
  modifiers: ProductModifier[];
};

export type Location = {
  id: string;
  name: string;
  code: string;
};

export type InventoryRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode?: string | null;
  location_id: string;
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  incoming: number;
};

export type Supplier = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type Customer = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  supplier_name: string;
  location_name: string;
  status: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: string;
  line_count: number;
  created_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  variant_id: string;
  sku_snapshot: string;
  description_snapshot: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_minor: number;
  tax_rate_bps: number;
};

export type PurchaseOrderDetail = PurchaseOrder & {
  location_id: string;
  supplier_id: string;
  lines: PurchaseOrderLine[];
};

export type Order = {
  id: string;
  number: string;
  customer_name?: string | null;
  location_name: string;
  status: string;
  fulfilment_status: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  currency: string;
  line_count: number;
  created_at: string;
};

export type OrderLineModifier = {
  id: string;
  name_snapshot: string;
  quantity: number;
  unit_price_delta_minor: number;
};

export type OrderLine = {
  id: string;
  variant_id: string;
  product_name_snapshot: string;
  variant_name_snapshot: string;
  sku_snapshot: string;
  quantity: number;
  quantity_fulfilled: number;
  quantity_returned: number;
  unit_price_minor: number;
  tax_rate_bps: number;
  modifiers: OrderLineModifier[];
};

export type OrderDetail = Order & {
  location_id: string;
  customer_id?: string | null;
  lines: OrderLine[];
};

export type AuditEvent = {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  metadata_json?: string | null;
  created_at: string;
};
