import { z } from "zod";
import {
  INTEGRATION_PROVIDERS,
  integrationEventKey,
  type IntegrationConnectionStatus,
  type IntegrationProvider,
} from "../shared/integration-contract";
import { migrateIntegrationSchema } from "./integration-schema";

const INTERNAL_HEADER = "x-operating-layer-internal-integration";
const INTERNAL_VALUE = "integration-v1";

const credentialEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("A256GCM"),
  keyVersion: z.string().trim().min(1).max(80),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

const connectionUpsertSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(INTEGRATION_PROVIDERS),
  externalAccountId: z.string().trim().min(1).max(255),
  displayName: z.string().trim().min(1).max(255),
  status: z.enum(["draft", "connecting", "active", "paused", "attention_required", "disconnected"]),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(40),
  credential: z.object({
    envelope: credentialEnvelopeSchema,
    scopes: z.array(z.string().trim().min(1).max(120)).max(100),
    accessTokenExpiresAt: z.string().datetime(),
    refreshTokenExpiresAt: z.string().datetime(),
  }),
});

const connectionStatusSchema = z.object({
  status: z.enum(["active", "paused", "attention_required", "disconnected"]),
  error: z.string().trim().max(1000).nullable().optional(),
});

const eventReceiptSchema = z.object({
  connectionId: z.string().uuid(),
  provider: z.enum(INTEGRATION_PROVIDERS),
  providerEventId: z.string().trim().min(1).max(255),
  providerActionId: z.string().trim().max(255).nullable().optional(),
  topic: z.string().trim().min(1).max(255),
  externalAccountId: z.string().trim().min(1).max(255),
  occurredAt: z.string().datetime().nullable().optional(),
  apiVersion: z.string().trim().max(80).nullable().optional(),
  payloadJson: z.string().max(2_000_000),
});

type ConnectionRow = {
  id: string;
  provider: IntegrationProvider;
  external_account_id: string;
  display_name: string;
  status: IntegrationConnectionStatus;
  capabilities_json: string;
  last_event_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type CredentialRow = {
  connection_id: string;
  encrypted_payload_json: string;
  key_version: string;
  scopes_json: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  updated_at: string;
};

type EventRow = { id: string; event_key: string; status: string };

function now() {
  return new Date().toISOString();
}

function actor(request: Request) {
  return {
    id: request.headers.get("x-ordermate-actor-id") || "integration-system",
    role: request.headers.get("x-ordermate-actor-role") || "integration",
  };
}

function safeJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class IntegrationRuntime {
  constructor(private readonly ctx: DurableObjectState) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/integrations") {
      return Response.json({ connections: this.listConnections() });
    }

    const connection = path.match(/^\/integrations\/([^/]+)$/);
    if (request.method === "GET" && connection) {
      const record = this.getConnection(decodeURIComponent(connection[1]));
      return record ? Response.json(record) : Response.json({ error: "Integration connection not found" }, { status: 404 });
    }

    if (!path.startsWith("/__integrations/")) return null;
    if (request.headers.get(INTERNAL_HEADER) !== INTERNAL_VALUE) {
      return Response.json({ error: "Internal integration route" }, { status: 404 });
    }

    if (request.method === "POST" && path === "/__integrations/connections/upsert") {
      return this.upsertConnection(request);
    }

    const credentials = path.match(/^\/__integrations\/credentials\/([^/]+)$/);
    if (request.method === "GET" && credentials) {
      return this.readCredential(decodeURIComponent(credentials[1]));
    }

    const status = path.match(/^\/__integrations\/connections\/([^/]+)\/status$/);
    if (request.method === "POST" && status) {
      return this.updateConnectionStatus(decodeURIComponent(status[1]), request);
    }

    if (request.method === "POST" && path === "/__integrations/events/receive") {
      return this.receiveEvent(request);
    }

    return Response.json({ error: "Internal integration route not found" }, { status: 404 });
  }

  private listConnections() {
    return this.ctx.storage.sql.exec<ConnectionRow>(
      `SELECT id, provider, external_account_id, display_name, status, capabilities_json,
              last_event_at, last_success_at, last_error_at, last_error, created_at, updated_at
       FROM integration_connections
       ORDER BY provider, display_name COLLATE NOCASE`,
    ).toArray().map(row => ({
      id: row.id,
      provider: row.provider,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      status: row.status,
      capabilities: safeJsonArray(row.capabilities_json),
      lastEventAt: row.last_event_at,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getConnection(connectionId: string) {
    return this.listConnections().find(connection => connection.id === connectionId) || null;
  }

  private async upsertConnection(request: Request) {
    let input: z.infer<typeof connectionUpsertSchema>;
    try {
      input = connectionUpsertSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration connection" }, { status: 400 });
      throw cause;
    }

    const timestamp = now();
    const requestActor = actor(request);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_connections (
           id, provider, external_account_id, display_name, status, capabilities_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           external_account_id = excluded.external_account_id,
           display_name = excluded.display_name,
           status = excluded.status,
           capabilities_json = excluded.capabilities_json,
           last_error_at = NULL,
           last_error = NULL,
           updated_at = excluded.updated_at`,
        input.id,
        input.provider,
        input.externalAccountId,
        input.displayName,
        input.status,
        JSON.stringify(input.capabilities),
        timestamp,
        timestamp,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_credentials (
           connection_id, encrypted_payload_json, key_version, scopes_json,
           access_token_expires_at, refresh_token_expires_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           encrypted_payload_json = excluded.encrypted_payload_json,
           key_version = excluded.key_version,
           scopes_json = excluded.scopes_json,
           access_token_expires_at = excluded.access_token_expires_at,
           refresh_token_expires_at = excluded.refresh_token_expires_at,
           updated_at = excluded.updated_at`,
        input.id,
        JSON.stringify(input.credential.envelope),
        input.credential.envelope.keyVersion,
        JSON.stringify(input.credential.scopes),
        input.credential.accessTokenExpiresAt,
        input.credential.refreshTokenExpiresAt,
        timestamp,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, ?, ?, 'integration.connection_upserted', 'integration_connection', ?, ?, ?)`,
        crypto.randomUUID(),
        requestActor.id,
        requestActor.role,
        input.id,
        JSON.stringify({ provider: input.provider, externalAccountId: input.externalAccountId, status: input.status, scopes: input.credential.scopes }),
        timestamp,
      );
    });
    return Response.json({ ok: true, connection: this.getConnection(input.id) });
  }

  private readCredential(connectionId: string) {
    const connection = this.getConnection(connectionId);
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    const credential = this.ctx.storage.sql.exec<CredentialRow>(
      `SELECT connection_id, encrypted_payload_json, key_version, scopes_json,
              access_token_expires_at, refresh_token_expires_at, updated_at
       FROM integration_credentials WHERE connection_id = ?`,
      connectionId,
    ).toArray()[0];
    if (!credential) return Response.json({ error: "Integration credentials not found" }, { status: 404 });
    return Response.json({
      connection,
      credential: {
        envelope: JSON.parse(credential.encrypted_payload_json),
        keyVersion: credential.key_version,
        scopes: safeJsonArray(credential.scopes_json),
        accessTokenExpiresAt: credential.access_token_expires_at,
        refreshTokenExpiresAt: credential.refresh_token_expires_at,
        updatedAt: credential.updated_at,
      },
    });
  }

  private async updateConnectionStatus(connectionId: string, request: Request) {
    let input: z.infer<typeof connectionStatusSchema>;
    try {
      input = connectionStatusSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid connection status" }, { status: 400 });
      throw cause;
    }
    if (!this.getConnection(connectionId)) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    const timestamp = now();
    const requestActor = actor(request);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE integration_connections
         SET status = ?, last_error_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
        input.status,
        input.error ? timestamp : null,
        input.error ?? null,
        timestamp,
        connectionId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, ?, ?, 'integration.status_updated', 'integration_connection', ?, ?, ?)`,
        crypto.randomUUID(),
        requestActor.id,
        requestActor.role,
        connectionId,
        JSON.stringify({ status: input.status, error: input.error ?? null }),
        timestamp,
      );
    });
    return Response.json({ ok: true, connection: this.getConnection(connectionId) });
  }

  private async receiveEvent(request: Request) {
    let input: z.infer<typeof eventReceiptSchema>;
    try {
      input = eventReceiptSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration event" }, { status: 400 });
      throw cause;
    }

    const connection = this.ctx.storage.sql.exec<{ id: string; provider: string; external_account_id: string }>(
      "SELECT id, provider, external_account_id FROM integration_connections WHERE id = ?",
      input.connectionId,
    ).toArray()[0];
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    if (connection.provider !== input.provider || connection.external_account_id !== input.externalAccountId) {
      return Response.json({ error: "Integration event does not match its connection" }, { status: 409 });
    }

    const key = integrationEventKey({
      provider: input.provider,
      connectionId: input.connectionId,
      providerEventId: input.providerEventId,
      topic: input.topic,
    });
    let result: { id: string; duplicate: boolean } | null = null;
    const receivedAt = now();
    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<EventRow>(
        "SELECT id, event_key, status FROM integration_events WHERE event_key = ?",
        key,
      ).toArray()[0];
      if (existing) {
        result = { id: existing.id, duplicate: true };
        return;
      }
      const eventId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_events (
           id, event_key, connection_id, provider_event_id, provider_action_id, topic,
           status, api_version, occurred_at, received_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`,
        eventId,
        key,
        input.connectionId,
        input.providerEventId,
        input.providerActionId ?? null,
        input.topic,
        input.apiVersion ?? null,
        input.occurredAt ?? null,
        receivedAt,
        input.payloadJson,
      );
      this.ctx.storage.sql.exec(
        "UPDATE integration_connections SET last_event_at = ?, updated_at = ? WHERE id = ?",
        receivedAt,
        receivedAt,
        input.connectionId,
      );
      result = { id: eventId, duplicate: false };
    });

    return Response.json(result, { status: result?.duplicate ? 200 : 202 });
  }
}

export const integrationInternalHeaders = {
  [INTERNAL_HEADER]: INTERNAL_VALUE,
} as const;
