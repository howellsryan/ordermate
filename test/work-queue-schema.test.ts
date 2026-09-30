import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CURRENT_WORK_QUEUE_SCHEMA_VERSION, migrateWorkQueueSchema } from "../src/worker/work-queue-schema";

describe("work queue schema migrations", () => {
  it("creates durable work and history tables idempotently", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      expect(migrateWorkQueueSchema(state.storage)).toBe(CURRENT_WORK_QUEUE_SCHEMA_VERSION);
      expect(migrateWorkQueueSchema(state.storage)).toBe(CURRENT_WORK_QUEUE_SCHEMA_VERSION);

      const tables = new Set(state.storage.sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).toArray().map(row => row.name));
      expect(tables.has("work_items")).toBe(true);
      expect(tables.has("work_item_events")).toBe(true);

      const versions = state.storage.sql.exec<{ id: number }>(
        "SELECT id FROM _work_queue_schema_migrations ORDER BY id",
      ).toArray().map(row => row.id);
      expect(versions).toEqual(Array.from({ length: CURRENT_WORK_QUEUE_SCHEMA_VERSION }, (_, index) => index + 1));

      const columns = new Set(state.storage.sql.exec<{ name: string }>(
        "PRAGMA table_info(work_items)",
      ).toArray().map(row => row.name));
      for (const column of ["team_id", "team_name", "due_at", "escalation_at", "escalated_at"]) {
        expect(columns.has(column), column).toBe(true);
      }

      const unique = state.storage.sql.exec<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'work_items'",
      ).toArray()[0]?.sql || "";
      expect(unique).toContain("UNIQUE(source, fingerprint)");
    });
  });

  it("fails closed when work queue storage is newer than the runtime", async () => {
    const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    await runInDurableObject(stub, async (_instance, state) => {
      migrateWorkQueueSchema(state.storage);
      state.storage.sql.exec(
        "INSERT INTO _work_queue_schema_migrations (id, applied_at) VALUES (?, ?)",
        CURRENT_WORK_QUEUE_SCHEMA_VERSION + 1,
        "2026-09-29T18:00:00.000Z",
      );
      expect(() => migrateWorkQueueSchema(state.storage)).toThrow(
        `Work queue schema version ${CURRENT_WORK_QUEUE_SCHEMA_VERSION + 1} is newer than runtime version ${CURRENT_WORK_QUEUE_SCHEMA_VERSION}`,
      );
    });
  });
});
