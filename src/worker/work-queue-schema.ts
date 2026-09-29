const CURRENT_WORK_QUEUE_SCHEMA_VERSION = 1;

type MigrationRow = { version: number };
type SqlStorage = DurableObjectState["storage"];

export function migrateWorkQueueSchema(storage: SqlStorage) {
  const sql = storage.sql;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _work_queue_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  let current = sql.exec<MigrationRow>(
    "SELECT COALESCE(MAX(id), 0) AS version FROM _work_queue_schema_migrations",
  ).toArray()[0]?.version ?? 0;
  if (current > CURRENT_WORK_QUEUE_SCHEMA_VERSION) {
    throw new Error(`Work queue schema version ${current} is newer than runtime version ${CURRENT_WORK_QUEUE_SCHEMA_VERSION}`);
  }

  if (current < 1) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS work_items (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          category TEXT NOT NULL CHECK(category IN ('customer_promise','stock_risk','supply_risk','receiving_exception','integration_exception')),
          severity TEXT NOT NULL CHECK(severity IN ('critical','warning','info')),
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          next_action TEXT NOT NULL,
          page TEXT NOT NULL,
          score INTEGER NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          entity_type TEXT,
          entity_id TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','snoozed','resolved','dismissed')),
          active_signal INTEGER NOT NULL DEFAULT 1 CHECK(active_signal IN (0,1)),
          assignee_id TEXT,
          assignee_name TEXT,
          acknowledged_at TEXT,
          acknowledged_by TEXT,
          snoozed_until TEXT,
          resolution_reason TEXT,
          resolved_at TEXT,
          resolved_by TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          cleared_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(source, fingerprint)
        );
        CREATE INDEX IF NOT EXISTS work_items_actionable_idx
          ON work_items(active_signal, status, severity, score DESC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS work_items_assignee_idx
          ON work_items(assignee_id, active_signal, status, updated_at DESC)
          WHERE assignee_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS work_item_events (
          id TEXT PRIMARY KEY,
          work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          actor_id TEXT,
          actor_name TEXT,
          actor_role TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_item_events_item_idx
          ON work_item_events(work_item_id, created_at DESC);
      `);
      sql.exec(
        "INSERT INTO _work_queue_schema_migrations (id, applied_at) VALUES (1, ?)",
        new Date().toISOString(),
      );
    });
    current = 1;
  }

  if (current !== CURRENT_WORK_QUEUE_SCHEMA_VERSION) {
    throw new Error(`Work queue schema migration stopped at ${current}; expected ${CURRENT_WORK_QUEUE_SCHEMA_VERSION}`);
  }
  return current;
}

export { CURRENT_WORK_QUEUE_SCHEMA_VERSION };
