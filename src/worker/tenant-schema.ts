export const TENANT_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenant_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_name TEXT NOT NULL DEFAULT 'My business',
  currency TEXT NOT NULL DEFAULT 'GBP',
  prices_include_tax INTEGER NOT NULL DEFAULT 1,
  default_tax_rate_bps INTEGER NOT NULL DEFAULT 2000,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1 CHECK(next_value > 0)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  price_minor INTEGER NOT NULL CHECK(price_minor >= 0),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_bps >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS variants_barcode_idx ON product_variants(barcode);

CREATE TABLE IF NOT EXISTS variant_option_values (
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_name TEXT NOT NULL,
  option_value TEXT NOT NULL,
  PRIMARY KEY(variant_id, option_name)
);

CREATE TABLE IF NOT EXISTS modifiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_delta_minor INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_modifiers (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_id TEXT NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  PRIMARY KEY(product_id, modifier_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_levels (
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(variant_id, location_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  quantity_delta INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_movements_variant_idx ON inventory_movements(variant_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_reference_idx ON inventory_movements(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_variants (
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  last_cost_minor INTEGER,
  lead_time_days INTEGER,
  PRIMARY KEY(supplier_id, variant_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ordered','partially_received','received','cancelled')),
  currency TEXT NOT NULL,
  notes TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  ordered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  sku_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL CHECK(quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK(quantity_received >= 0 AND quantity_received <= quantity_ordered),
  unit_cost_minor INTEGER NOT NULL CHECK(unit_cost_minor >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS po_lines_po_idx ON purchase_order_lines(purchase_order_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','completed','cancelled')),
  fulfilment_status TEXT NOT NULL DEFAULT 'unfulfilled' CHECK(fulfilment_status IN ('unfulfilled','partially_fulfilled','fulfilled','partially_returned','returned')),
  currency TEXT NOT NULL,
  notes TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  quantity_fulfilled INTEGER NOT NULL DEFAULT 0 CHECK(quantity_fulfilled >= 0 AND quantity_fulfilled <= quantity),
  quantity_returned INTEGER NOT NULL DEFAULT 0 CHECK(quantity_returned >= 0 AND quantity_returned <= quantity_fulfilled),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines(order_id);

CREATE TABLE IF NOT EXISTS order_line_modifiers (
  id TEXT PRIMARY KEY,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  modifier_id TEXT REFERENCES modifiers(id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price_delta_minor INTEGER NOT NULL,
  net_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS order_line_modifiers_line_idx ON order_line_modifiers(order_line_id);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL CHECK(status IN ('active','consumed','released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reservations_order_idx ON inventory_reservations(order_id, status);

CREATE TABLE IF NOT EXISTS fulfilments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fulfilment_lines (
  fulfilment_id TEXT NOT NULL REFERENCES fulfilments(id) ON DELETE CASCADE,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(fulfilment_id, order_line_id)
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS return_lines (
  return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  order_line_id TEXT NOT NULL REFERENCES order_lines(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  restocked INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(return_id, order_line_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at DESC);
`;
