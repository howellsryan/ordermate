PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS integration_routes (
  provider TEXT NOT NULL CHECK(provider IN ('shopify','xero','quickbooks')),
  external_account_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'connecting' CHECK(status IN ('connecting','active','attention_required','disconnected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS integration_routes_tenant_idx
  ON integration_routes(tenant_id, provider, status);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider = 'shopify'),
  tenant_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  external_account_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS integration_oauth_states_expiry_idx
  ON integration_oauth_states(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS integration_oauth_states_tenant_idx
  ON integration_oauth_states(tenant_id, provider, created_at DESC);
