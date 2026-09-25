PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace_invite (
  id TEXT PRIMARY KEY NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdBy TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  createdAt INTEGER NOT NULL,
  acceptedAt INTEGER
);

CREATE INDEX IF NOT EXISTS workspace_invite_org_idx ON workspace_invite(organizationId, acceptedAt, expiresAt);
CREATE INDEX IF NOT EXISTS workspace_invite_email_idx ON workspace_invite(email, acceptedAt, expiresAt);
