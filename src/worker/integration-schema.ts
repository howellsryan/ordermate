const CURRENT_INTEGRATION_SCHEMA_VERSION = 2;

type MigrationRow = { version: number };
type SqlStorage = DurableObjectState["storage"];

export function migrateIntegrationSchema(storage: SqlStorage) {
  const sql = storage.sql;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _integration_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  let current = sql.exec<MigrationRow>(
    "SELECT COALESCE(MAX(id), 0) AS version FROM _integration_schema_migrations",
  ).toArray()[0]?.version ?? 0;
  if (current > CURRENT_INTEGRATION_SCHEMA_VERSION) {
    throw new Error(`Integration schema version ${current} is newer than runtime version ${CURRENT_INTEGRATION_SCHEMA_VERSION}`);
  }

  if (current < 1) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS integration_connections (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL CHECK(provider IN ('shopify','xero','quickbooks')),
          external_account_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('draft','connecting','active','paused','attention_required','disconnected')),
          capabilities_json TEXT NOT NULL DEFAULT '[]',
          last_event_at TEXT,
          last_success_at TEXT,
          last_error_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(provider, external_account_id)
        );
        CREATE INDEX IF NOT EXISTS integration_connections_status_idx
          ON integration_connections(provider, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS integration_credentials (
          connection_id TEXT PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
          encrypted_payload_json TEXT NOT NULL,
          key_version TEXT NOT NULL,
          scopes_json TEXT NOT NULL,
          access_token_expires_at TEXT NOT NULL,
          refresh_token_expires_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS integration_entity_links (
          provider TEXT NOT NULL CHECK(provider IN ('shopify','xero','quickbooks')),
          connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          external_id TEXT NOT NULL,
          local_entity_type TEXT NOT NULL,
          local_entity_id TEXT NOT NULL,
          external_updated_at TEXT,
          last_synced_at TEXT NOT NULL,
          PRIMARY KEY(provider, connection_id, entity_type, external_id)
        );
        CREATE INDEX IF NOT EXISTS integration_entity_links_local_idx
          ON integration_entity_links(connection_id, local_entity_type, local_entity_id);

        CREATE TABLE IF NOT EXISTS integration_events (
          id TEXT PRIMARY KEY,
          event_key TEXT NOT NULL UNIQUE,
          connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          provider_event_id TEXT NOT NULL,
          provider_action_id TEXT,
          topic TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','applied','ignored','failed')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
          api_version TEXT,
          occurred_at TEXT,
          received_at TEXT NOT NULL,
          processed_at TEXT,
          payload_json TEXT NOT NULL,
          error TEXT,
          UNIQUE(connection_id, provider_event_id)
        );
        CREATE INDEX IF NOT EXISTS integration_events_status_idx
          ON integration_events(connection_id, status, received_at);
        CREATE INDEX IF NOT EXISTS integration_events_action_idx
          ON integration_events(connection_id, provider_action_id) WHERE provider_action_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS integration_exceptions (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          event_id TEXT REFERENCES integration_events(id) ON DELETE SET NULL,
          code TEXT NOT NULL,
          message TEXT NOT NULL,
          retryable INTEGER NOT NULL CHECK(retryable IN (0, 1)),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
          entity_type TEXT,
          external_id TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT
        );
        CREATE INDEX IF NOT EXISTS integration_exceptions_open_idx
          ON integration_exceptions(connection_id, status, created_at DESC);
      `);
      sql.exec(
        "INSERT INTO _integration_schema_migrations (id, applied_at) VALUES (1, ?)",
        new Date().toISOString(),
      );
    });
    current = 1;
  }

  if (current < 2) {
    storage.transactionSync(() => {
      sql.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS integration_entity_links_one_to_one_idx
          ON integration_entity_links(connection_id, entity_type, local_entity_type, local_entity_id);

        CREATE TABLE IF NOT EXISTS integration_external_entities (
          connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('variant','location')),
          external_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          external_updated_at TEXT,
          match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK(match_status IN ('mapped','suggested','ambiguous','unmatched')),
          suggested_local_entity_type TEXT,
          suggested_local_entity_id TEXT,
          suggestion_reason TEXT,
          discovered_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(connection_id, entity_type, external_id)
        );
        CREATE INDEX IF NOT EXISTS integration_external_entities_status_idx
          ON integration_external_entities(connection_id, entity_type, match_status, display_name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS integration_sync_checkpoints (
          connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
          resource TEXT NOT NULL CHECK(resource IN ('catalogue','locations')),
          status TEXT NOT NULL CHECK(status IN ('idle','running','completed','failed')),
          item_count INTEGER NOT NULL DEFAULT 0 CHECK(item_count >= 0),
          started_at TEXT,
          completed_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(connection_id, resource)
        );
        CREATE INDEX IF NOT EXISTS integration_sync_checkpoints_status_idx
          ON integration_sync_checkpoints(connection_id, status, updated_at DESC);
      `);
      sql.exec(
        "INSERT INTO _integration_schema_migrations (id, applied_at) VALUES (2, ?)",
        new Date().toISOString(),
      );
    });
    current = 2;
  }

  if (current !== CURRENT_INTEGRATION_SCHEMA_VERSION) {
    throw new Error(`Integration schema migration stopped at ${current}; expected ${CURRENT_INTEGRATION_SCHEMA_VERSION}`);
  }
  return current;
}

export { CURRENT_INTEGRATION_SCHEMA_VERSION };
