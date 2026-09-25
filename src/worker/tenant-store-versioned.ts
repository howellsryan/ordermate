import { TenantStore as RuntimeTenantStore } from "./tenant-store-runtime";
import type { TenantEnv } from "./tenant-store";

const CURRENT_TENANT_SCHEMA_VERSION = 1;

type MigrationRow = { version: number };

/**
 * Final exported TenantStore class.
 *
 * Core v1 bootstrap remains responsible for creating the initial idempotent
 * schema. This layer records that baseline and is the only place future v2+
 * schema migrations may be added. Durable Object class identity remains
 * `TenantStore`; this does not create or move a namespace.
 */
export class TenantStore extends RuntimeTenantStore {
  private readonly versionedCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.versionedCtx = ctx;

    ctx.blockConcurrencyWhile(async () => {
      this.runSchemaMigrations();
    });
  }

  private runSchemaMigrations() {
    const sql = this.versionedCtx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    const current = sql.exec<MigrationRow>(
      "SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations",
    ).toArray()[0]?.version ?? 0;

    if (current > CURRENT_TENANT_SCHEMA_VERSION) {
      throw new Error(`Tenant schema version ${current} is newer than runtime version ${CURRENT_TENANT_SCHEMA_VERSION}`);
    }

    if (current < 1) {
      // The superclass has already applied the idempotent v1 bootstrap before
      // requests are admitted. Existing pre-migration-tracker tenants and new
      // tenants therefore share the same baseline and can be marked v1 safely.
      this.versionedCtx.storage.transactionSync(() => {
        sql.exec(
          "INSERT OR IGNORE INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)",
          new Date().toISOString(),
        );
      });
    }

    // Future schema changes belong here, in monotonically increasing blocks:
    // if (current < 2) transactionSync(() => { ...; INSERT migration id 2; });
    // Never mutate the tenant schema elsewhere without adding the migration.
  }
}

export { CURRENT_TENANT_SCHEMA_VERSION };
