import { TenantStore as RuntimeTenantStore } from "./tenant-store-runtime";
import type { TenantEnv } from "./tenant-store";

const CURRENT_TENANT_SCHEMA_VERSION = 2;
const V1_REQUIRED_TABLES = [
  "tenant_settings",
  "sequences",
  "categories",
  "products",
  "product_variants",
  "variant_option_values",
  "modifiers",
  "product_modifiers",
  "locations",
  "inventory_levels",
  "inventory_movements",
  "suppliers",
  "supplier_variants",
  "purchase_orders",
  "purchase_order_lines",
  "customers",
  "orders",
  "order_lines",
  "order_line_modifiers",
  "inventory_reservations",
  "fulfilments",
  "fulfilment_lines",
  "returns",
  "return_lines",
  "audit_events",
] as const;

type MigrationRow = { version: number };
type TableRow = { name: string };
type SqlStorage = DurableObjectState["storage"];

function assertV1Baseline(storage: SqlStorage) {
  const present = new Set(
    storage.sql
      .exec<TableRow>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map(row => row.name),
  );
  const missing = V1_REQUIRED_TABLES.filter(table => !present.has(table));
  if (missing.length) {
    throw new Error(`Tenant v1 schema bootstrap is incomplete; missing: ${missing.join(", ")}`);
  }
}

function recordMigration(storage: SqlStorage, id: number) {
  storage.sql.exec(
    "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (?, ?)",
    id,
    new Date().toISOString(),
  );
}

export function migrateTenantSchema(storage: SqlStorage) {
  const sql = storage.sql;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  let current = sql.exec<MigrationRow>(
    "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
  ).toArray()[0]?.version ?? 0;

  if (current > CURRENT_TENANT_SCHEMA_VERSION) {
    throw new Error(`Tenant schema version ${current} is newer than runtime version ${CURRENT_TENANT_SCHEMA_VERSION}`);
  }

  if (current < 1) {
    assertV1Baseline(storage);
    storage.transactionSync(() => recordMigration(storage, 1));
    current = 1;
  }

  if (current < 2) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE inventory_policies (
          variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
          location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
          reorder_point INTEGER NOT NULL CHECK(reorder_point >= 0),
          target_stock INTEGER NOT NULL CHECK(target_stock >= reorder_point),
          preferred_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          PRIMARY KEY(variant_id, location_id)
        );
        CREATE INDEX inventory_policies_supplier_idx ON inventory_policies(preferred_supplier_id);
      `);
      recordMigration(storage, 2);
    });
    current = 2;
  }

  if (current !== CURRENT_TENANT_SCHEMA_VERSION) {
    throw new Error(`Tenant schema migration stopped at ${current}; expected ${CURRENT_TENANT_SCHEMA_VERSION}`);
  }

  return current;
}

/**
 * Final versioned storage layer for the existing TenantStore Durable Object.
 * Durable Object class identity remains `TenantStore`; migrations evolve the
 * embedded SQLite database in place rather than creating/replacing namespaces.
 */
export class TenantStore extends RuntimeTenantStore {
  protected readonly versionedCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.versionedCtx = ctx;

    ctx.blockConcurrencyWhile(async () => {
      migrateTenantSchema(ctx.storage);
    });
  }
}

export { CURRENT_TENANT_SCHEMA_VERSION, V1_REQUIRED_TABLES };
