PRAGMA foreign_keys = OFF;

CREATE TABLE integration_oauth_states_v2 (
  state_hash TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('shopify','xero','quickbooks')),
  tenant_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  external_account_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

INSERT INTO integration_oauth_states_v2 (
  state_hash, provider, tenant_id, external_account_id, created_by,
  expires_at, created_at, consumed_at
)
SELECT state_hash, provider, tenant_id, external_account_id, created_by,
       expires_at, created_at, consumed_at
FROM integration_oauth_states;

DROP TABLE integration_oauth_states;
ALTER TABLE integration_oauth_states_v2 RENAME TO integration_oauth_states;

CREATE INDEX integration_oauth_states_expiry_idx
  ON integration_oauth_states(expires_at, consumed_at);
CREATE INDEX integration_oauth_states_tenant_idx
  ON integration_oauth_states(tenant_id, provider, created_at DESC);

PRAGMA foreign_keys = ON;
