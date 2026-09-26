import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { TENANT_SCHEMA } from "../src/worker/tenant-schema";
import { CURRENT_TENANT_SCHEMA_VERSION, migrateTenantSchema } from "../src/worker/tenant-store-versioned";

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

describe("tenant schema migrations", () => {
  it("migrates a populated v1 tenant through v6 without losing baseline data", async () => {
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

      expect(migrateTenantSchema(state.storage)).toBe(CURRENT_TENANT_SCHEMA_VERSION);

      const versions = sql.exec<{ id: number }>(
        "SELECT id FROM _sql_schema_migrations ORDER BY id",
      ).toArray().map(row => row.id);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6]);

      const orderColumns = sql.exec<{ name: string }>("PRAGMA table_info(orders)").toArray().map(row => row.name);
      expect(orderColumns).toEqual(expect.arrayContaining(["required_by_date", "priority"]));

      const purchaseOrderColumns = sql.exec<{ name: string }>("PRAGMA table_info(purchase_orders)").toArray().map(row => row.name);
      expect(purchaseOrderColumns).toContain("expected_delivery_date");

      const addedTables = new Set(sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).toArray().map(row => row.name));
      expect(addedTables.has("inventory_policies")).toBe(true);
      expect(addedTables.has("delivery_discrepancies")).toBe(true);
      expect(addedTables.has("saved_views")).toBe(true);

      const preserved = sql.exec<{ name: string }>("SELECT name FROM products WHERE id = ?", "product-v1").toArray()[0];
      expect(preserved?.name).toBe("Preserved product");
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
