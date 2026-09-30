import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CURRENT_INTEGRATION_SCHEMA_VERSION, migrateIntegrationSchema } from "../src/worker/integration-schema";

describe("integration schema migrations", () => {
  it("creates the provider-neutral integration tables idempotently", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      expect(migrateIntegrationSchema(state.storage)).toBe(CURRENT_INTEGRATION_SCHEMA_VERSION);
      expect(migrateIntegrationSchema(state.storage)).toBe(CURRENT_INTEGRATION_SCHEMA_VERSION);

      const tables = new Set(state.storage.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).toArray().map(row => row.name));
      for (const table of [
        "integration_connections",
        "integration_credentials",
        "integration_entity_links",
        "integration_events",
        "integration_exceptions",
        "integration_external_entities",
        "integration_sync_checkpoints",
        "integration_order_state",
        "integration_outbound_jobs",
        "integration_reconciliation",
        "integration_fulfilment_links",
        "integration_fulfilment_tracking",
        "integration_return_cases",
      ]) expect(tables.has(table), table).toBe(true);

      const versions = state.storage.sql.exec<{ id: number }>(
        "SELECT id FROM _integration_schema_migrations ORDER BY id",
      ).toArray().map(row => row.id);
      expect(versions).toEqual(Array.from({ length: CURRENT_INTEGRATION_SCHEMA_VERSION }, (_, index) => index + 1));

      const orderColumns = new Set(state.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(integration_order_state)",
      ).toArray().map(row => row.name));
      expect(orderColumns.has("observed_external_updated_at")).toBe(true);
      expect(orderColumns.has("observed_proposal_json")).toBe(true);

      const jobColumns = new Set(state.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(integration_outbound_jobs)",
      ).toArray().map(row => row.name));
      for (const column of ["generation", "lease_token", "lease_expires_at"]) expect(jobColumns.has(column), column).toBe(true);

      const uniqueMappingIndex = state.storage.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'integration_entity_links_one_to_one_idx'",
      ).toArray();
      expect(uniqueMappingIndex).toHaveLength(1);

      const orderStateIndex = state.storage.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'integration_order_state_local_idx'",
      ).toArray();
      expect(orderStateIndex).toHaveLength(1);
    });
  });

  it("fails closed when integration storage is newer than the runtime", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      migrateIntegrationSchema(state.storage);
      state.storage.sql.exec(
        "INSERT INTO _integration_schema_migrations (id, applied_at) VALUES (?, ?)",
        CURRENT_INTEGRATION_SCHEMA_VERSION + 1,
        "2026-09-27T15:00:00.000Z",
      );
      expect(() => migrateIntegrationSchema(state.storage)).toThrow(
        `Integration schema version ${CURRENT_INTEGRATION_SCHEMA_VERSION + 1} is newer than runtime version ${CURRENT_INTEGRATION_SCHEMA_VERSION}`,
      );
    });
  });
});
