import { TenantStore as RuntimeTenantStore } from "./tenant-store-runtime";
import type { TenantEnv } from "./tenant-store";

const CURRENT_TENANT_SCHEMA_VERSION = 9;
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
type TableInfoRow = { name: string };
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

function tableHasColumn(storage: SqlStorage, table: string, column: string) {
  return storage.sql.exec<TableInfoRow>(`PRAGMA table_info(${table})`).toArray().some(row => row.name === column);
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

  if (current < 3) {
    storage.transactionSync(() => {
      if (!tableHasColumn(storage, "purchase_orders", "expected_delivery_date")) {
        sql.exec("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT");
      }
      sql.exec("CREATE INDEX IF NOT EXISTS purchase_orders_expected_delivery_idx ON purchase_orders(expected_delivery_date)");
      recordMigration(storage, 3);
    });
    current = 3;
  }

  if (current < 4) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS delivery_discrepancies (
          id TEXT PRIMARY KEY,
          purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
          proposal_key TEXT NOT NULL UNIQUE,
          proposal_event_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
          issue_count INTEGER NOT NULL CHECK(issue_count > 0),
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT,
          resolution_code TEXT CHECK(resolution_code IS NULL OR resolution_code IN ('supplier_follow_up','accepted_variance','corrected_document','other')),
          resolution_note TEXT
        );
        CREATE INDEX IF NOT EXISTS delivery_discrepancies_po_status_idx
          ON delivery_discrepancies(purchase_order_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS delivery_discrepancies_status_idx
          ON delivery_discrepancies(status, created_at DESC);
      `);
      recordMigration(storage, 4);
    });
    current = 4;
  }

  if (current < 5) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS saved_views (
          id TEXT PRIMARY KEY,
          owner_actor_id TEXT NOT NULL,
          page TEXT NOT NULL CHECK(page IN ('inventory','purchasing')),
          name TEXT NOT NULL COLLATE NOCASE,
          config_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(owner_actor_id, page, name)
        );
        CREATE INDEX IF NOT EXISTS saved_views_owner_page_idx
          ON saved_views(owner_actor_id, page, updated_at DESC);
      `);
      recordMigration(storage, 5);
    });
    current = 5;
  }

  if (current < 6) {
    storage.transactionSync(() => {
      if (!tableHasColumn(storage, "orders", "required_by_date")) {
        sql.exec("ALTER TABLE orders ADD COLUMN required_by_date TEXT");
      }
      if (!tableHasColumn(storage, "orders", "priority")) {
        sql.exec("ALTER TABLE orders ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'))");
      }
      sql.exec("CREATE INDEX IF NOT EXISTS orders_open_priority_due_idx ON orders(status, fulfilment_status, required_by_date, priority)");
      recordMigration(storage, 6);
    });
    current = 6;
  }

  if (current < 7) {
    storage.transactionSync(() => {
      if (!tableHasColumn(storage, "supplier_variants", "minimum_order_quantity")) {
        sql.exec("ALTER TABLE supplier_variants ADD COLUMN minimum_order_quantity INTEGER CHECK(minimum_order_quantity IS NULL OR minimum_order_quantity > 0)");
      }
      if (!tableHasColumn(storage, "supplier_variants", "order_multiple")) {
        sql.exec("ALTER TABLE supplier_variants ADD COLUMN order_multiple INTEGER CHECK(order_multiple IS NULL OR order_multiple > 0)");
      }
      recordMigration(storage, 7);
    });
    current = 7;
  }

  if (current < 8) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS workspace_modules (
          module_key TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS crm_contacts (
          id TEXT PRIMARY KEY,
          lifecycle_stage TEXT NOT NULL DEFAULT 'prospect' CHECK(lifecycle_stage IN ('prospect','customer')),
          name TEXT NOT NULL,
          email TEXT,
          mobile TEXT,
          address_json TEXT,
          notes TEXT,
          source TEXT,
          converted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS crm_contacts_stage_name_idx ON crm_contacts(lifecycle_stage, name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS crm_contacts_email_idx ON crm_contacts(email COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS service_cases (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL UNIQUE,
          contact_id TEXT NOT NULL REFERENCES crm_contacts(id),
          title TEXT NOT NULL,
          summary TEXT,
          source TEXT,
          site_address_json TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','won','closed','cancelled')),
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_cases_contact_idx ON service_cases(contact_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS service_cases_status_idx ON service_cases(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS service_requests (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          number TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','qualified','converted','declined','cancelled')),
          details TEXT NOT NULL,
          requested_for TEXT,
          qualified_at TEXT,
          converted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_requests_case_idx ON service_requests(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS service_quotes (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          number TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected','expired','superseded','cancelled')),
          currency TEXT NOT NULL,
          notes TEXT,
          subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_minor >= 0),
          tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
          total_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_minor >= 0),
          customer_name_snapshot TEXT,
          customer_email_snapshot TEXT,
          customer_mobile_snapshot TEXT,
          customer_address_json_snapshot TEXT,
          sent_at TEXT,
          accepted_at TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_quotes_case_idx ON service_quotes(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS service_quotes_status_idx ON service_quotes(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS service_quote_lines (
          id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL REFERENCES service_quotes(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL CHECK(line_type IN ('service','material','other')),
          variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
          description_snapshot TEXT NOT NULL,
          quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0),
          unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
          tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_bps >= 0),
          net_minor INTEGER NOT NULL CHECK(net_minor >= 0),
          tax_minor INTEGER NOT NULL CHECK(tax_minor >= 0),
          gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0)
        );
        CREATE INDEX IF NOT EXISTS service_quote_lines_quote_idx ON service_quote_lines(quote_id);

        CREATE TABLE IF NOT EXISTS service_jobs (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
          quote_id TEXT REFERENCES service_quotes(id) ON DELETE SET NULL,
          number TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','in_progress','completed','cancelled')),
          title TEXT NOT NULL,
          site_address_json TEXT,
          notes TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_jobs_case_idx ON service_jobs(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS service_jobs_status_idx ON service_jobs(status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS service_visits (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','travelling','on_site','completed','cancelled','no_show')),
          scheduled_start TEXT NOT NULL,
          scheduled_end TEXT,
          assigned_actor_id TEXT,
          notes TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_visits_job_idx ON service_visits(job_id, scheduled_start);
        CREATE INDEX IF NOT EXISTS service_visits_schedule_idx ON service_visits(status, scheduled_start);

        CREATE TABLE IF NOT EXISTS service_material_usage (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES service_jobs(id),
          visit_id TEXT REFERENCES service_visits(id) ON DELETE SET NULL,
          variant_id TEXT NOT NULL REFERENCES product_variants(id),
          location_id TEXT NOT NULL REFERENCES locations(id),
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          sku_snapshot TEXT NOT NULL,
          description_snapshot TEXT NOT NULL,
          unit_cost_minor_snapshot INTEGER NOT NULL CHECK(unit_cost_minor_snapshot >= 0),
          movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id),
          actor_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_material_usage_job_idx ON service_material_usage(job_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS service_invoices (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES service_cases(id),
          job_id TEXT REFERENCES service_jobs(id) ON DELETE SET NULL,
          number TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','partially_paid','paid','void')),
          currency TEXT NOT NULL,
          supply_date TEXT,
          issue_date TEXT,
          due_date TEXT,
          notes TEXT,
          subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_minor >= 0),
          tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
          total_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_minor >= 0),
          business_name_snapshot TEXT,
          business_address_json_snapshot TEXT,
          business_contact_snapshot TEXT,
          customer_name_snapshot TEXT,
          customer_email_snapshot TEXT,
          customer_mobile_snapshot TEXT,
          customer_address_json_snapshot TEXT,
          issued_at TEXT,
          voided_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_invoices_case_idx ON service_invoices(case_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS service_invoices_status_due_idx ON service_invoices(status, due_date);

        CREATE TABLE IF NOT EXISTS service_invoice_lines (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES service_invoices(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL CHECK(line_type IN ('service','material','other')),
          description_snapshot TEXT NOT NULL,
          quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0),
          unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
          tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_bps >= 0),
          net_minor INTEGER NOT NULL CHECK(net_minor >= 0),
          tax_minor INTEGER NOT NULL CHECK(tax_minor >= 0),
          gross_minor INTEGER NOT NULL CHECK(gross_minor >= 0)
        );
        CREATE INDEX IF NOT EXISTS service_invoice_lines_invoice_idx ON service_invoice_lines(invoice_id);

        CREATE TABLE IF NOT EXISTS service_payments (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL REFERENCES service_invoices(id),
          amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
          method TEXT,
          reference TEXT,
          paid_at TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS service_payments_invoice_idx ON service_payments(invoice_id, paid_at DESC);
      `);

      if (!tableHasColumn(storage, "customers", "crm_contact_id")) {
        sql.exec("ALTER TABLE customers ADD COLUMN crm_contact_id TEXT REFERENCES crm_contacts(id)");
      }
      sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS customers_crm_contact_idx ON customers(crm_contact_id) WHERE crm_contact_id IS NOT NULL");

      const migrationTime = new Date().toISOString();
      for (const moduleKey of ["crm", "orders", "inventory", "purchasing", "warehouse", "reports"]) {
        sql.exec(
          "INSERT INTO workspace_modules (module_key, enabled, updated_at, updated_by) VALUES (?, 1, ?, 'schema-v8') ON CONFLICT(module_key) DO NOTHING",
          moduleKey,
          migrationTime,
        );
      }
      sql.exec(
        "INSERT INTO workspace_modules (module_key, enabled, updated_at, updated_by) VALUES ('service', 0, ?, 'schema-v8') ON CONFLICT(module_key) DO NOTHING",
        migrationTime,
      );

      sql.exec(`
        INSERT OR IGNORE INTO crm_contacts (
          id, lifecycle_stage, name, email, mobile, address_json, notes, source,
          converted_at, created_at, updated_at
        )
        SELECT id, 'customer', name, email, phone, address_json, notes, 'legacy_customer',
               created_at, created_at, updated_at
        FROM customers
      `);
      sql.exec("UPDATE customers SET crm_contact_id = id WHERE crm_contact_id IS NULL AND EXISTS (SELECT 1 FROM crm_contacts c WHERE c.id = customers.id)");

      recordMigration(storage, 8);
    });
    current = 8;
  }

  if (current < 9) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS business_profile (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          address_json TEXT,
          email TEXT,
          phone TEXT,
          vat_number TEXT,
          company_number TEXT,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL
        )
      `);
      const migrationTime = new Date().toISOString();
      sql.exec(
        "INSERT INTO business_profile (id, updated_at, updated_by) VALUES (1, ?, 'schema-v9') ON CONFLICT(id) DO NOTHING",
        migrationTime,
      );
      recordMigration(storage, 9);
    });
    current = 9;
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
