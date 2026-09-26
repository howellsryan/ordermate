import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { TENANT_SCHEMA } from "../src/worker/tenant-schema";
import { CURRENT_TENANT_SCHEMA_VERSION, migrateTenantSchema } from "../src/worker/tenant-store-versioned";

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

describe("tenant schema migrations", () => {
  it("migrates a populated v1 tenant through v9 without losing baseline data", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      const sql = state.storage.sql;
      const tables = sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).toArray();

      sql.exec("PRAGMA foreign_keys = OFF");
      for (const { name } of tables) sql.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`);
      sql.exec(TENANT_SCHEMA);

      sql.exec(
        "INSERT INTO products (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
        "product-v1",
        "Preserved product",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
      sql.exec(
        "INSERT INTO customers (id, name, email, phone, address_json, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        "customer-v1",
        "Preserved Customer",
        "customer@example.test",
        "07123456789",
        JSON.stringify({ line1: "1 Test Street", city: "Nottingham", postcode: "NG1 1AA" }),
        "Existing commerce customer",
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
      );

      expect(migrateTenantSchema(state.storage)).toBe(CURRENT_TENANT_SCHEMA_VERSION);

      const versions = sql.exec<{ id: number }>(
        "SELECT id FROM _sql_schema_migrations ORDER BY id",
      ).toArray().map(row => row.id);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      const orderColumns = sql.exec<{ name: string }>("PRAGMA table_info(orders)").toArray().map(row => row.name);
      expect(orderColumns).toEqual(expect.arrayContaining(["required_by_date", "priority"]));

      const purchaseOrderColumns = sql.exec<{ name: string }>("PRAGMA table_info(purchase_orders)").toArray().map(row => row.name);
      expect(purchaseOrderColumns).toContain("expected_delivery_date");

      const supplierVariantColumns = sql.exec<{ name: string }>("PRAGMA table_info(supplier_variants)").toArray().map(row => row.name);
      expect(supplierVariantColumns).toEqual(expect.arrayContaining(["minimum_order_quantity", "order_multiple"]));

      const customerColumns = sql.exec<{ name: string }>("PRAGMA table_info(customers)").toArray().map(row => row.name);
      expect(customerColumns).toContain("crm_contact_id");

      const addedTables = new Set(sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).toArray().map(row => row.name));
      for (const table of [
        "inventory_policies",
        "delivery_discrepancies",
        "saved_views",
        "workspace_modules",
        "crm_contacts",
        "service_cases",
        "service_requests",
        "service_quotes",
        "service_quote_lines",
        "service_jobs",
        "service_visits",
        "service_material_usage",
        "service_invoices",
        "service_invoice_lines",
        "service_payments",
        "business_profile",
      ]) expect(addedTables.has(table), table).toBe(true);

      const preserved = sql.exec<{ name: string }>("SELECT name FROM products WHERE id = ?", "product-v1").toArray()[0];
      expect(preserved?.name).toBe("Preserved product");

      const contact = sql.exec<{ lifecycle_stage: string; name: string; mobile: string | null }>(
        "SELECT lifecycle_stage, name, mobile FROM crm_contacts WHERE id = ?",
        "customer-v1",
      ).toArray()[0];
      expect(contact).toMatchObject({ lifecycle_stage: "customer", name: "Preserved Customer", mobile: "07123456789" });
      const linked = sql.exec<{ crm_contact_id: string | null }>("SELECT crm_contact_id FROM customers WHERE id = ?", "customer-v1").toArray()[0];
      expect(linked?.crm_contact_id).toBe("customer-v1");

      const modules = Object.fromEntries(sql.exec<{ module_key: string; enabled: number }>("SELECT module_key, enabled FROM workspace_modules").toArray().map(row => [row.module_key, row.enabled]));
      expect(modules).toMatchObject({ crm: 1, service: 0, orders: 1, inventory: 1, purchasing: 1, warehouse: 1, reports: 1 });

      const businessProfile = sql.exec<{ id: number; address_json: string | null; updated_by: string }>(
        "SELECT id, address_json, updated_by FROM business_profile WHERE id = 1",
      ).toArray()[0];
      expect(businessProfile).toMatchObject({ id: 1, address_json: null, updated_by: "schema-v9" });
    });
  });

  it("fails closed when tenant storage is newer than the runtime", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (?, ?)",
        CURRENT_TENANT_SCHEMA_VERSION + 1,
        "2026-09-25T00:00:00.000Z",
      );

      expect(() => migrateTenantSchema(state.storage)).toThrow(
        `Tenant schema version ${CURRENT_TENANT_SCHEMA_VERSION + 1} is newer than runtime version ${CURRENT_TENANT_SCHEMA_VERSION}`,
      );
    });
  });
});
