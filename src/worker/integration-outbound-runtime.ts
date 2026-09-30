import { z } from "zod";
import type {
  IntegrationOperationalHealth,
  IntegrationOutboundJob,
  IntegrationReconciliation,
  IntegrationReturnCase,
  OutboundJobStatus,
  OutboundOperation,
  ReconciliationStatus,
  ReturnDisposition,
} from "../shared/integration-operations";
import type { IntegrationOrderProposal } from "../shared/integration-order-contract";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { migrateIntegrationSchema } from "./integration-schema";
import { missingShopifyScopes, refreshShopifyOfflineToken, shopifyScopes, tokenExpiryIso } from "./shopify-auth";

export type IntegrationOutboundEnv = {
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_SCOPES?: string;
  SHOPIFY_API_VERSION?: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY?: string;
  INTEGRATION_TOKEN_KEY_VERSION?: string;
};

type CanonicalFetch = (request: Request) => Promise<Response>;
type Actor = { id: string; role: string; name: string };
type ConnectionRow = {
  id: string;
  provider: "shopify" | "xero" | "quickbooks";
  external_account_id: string;
  display_name: string;
  status: string;
  capabilities_json: string;
};
type CredentialRow = {
  encrypted_payload_json: string;
  scopes_json: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
};
type ShopifySecrets = { accessToken: string; refreshToken: string };
type JobRow = {
  id: string;
  connection_id: string;
  operation: OutboundOperation;
  coalescing_key: string;
  entity_type: string;
  entity_id: string;
  desired_json: string;
  status: OutboundJobStatus;
  attempts: number;
  generation: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string;
  provider_request_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
type ReconciliationRow = {
  connection_id: string;
  entity_type: string;
  entity_id: string;
  direction: "outbound" | "inbound";
  status: ReconciliationStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  updated_at: string;
};
type ReturnCaseRow = {
  id: string;
  connection_id: string;
  external_return_id: string;
  external_order_id: string | null;
  local_order_id: string | null;
  refund_observed: number;
  provider_status: string | null;
  disposition: ReturnDisposition;
  payload_json: string;
  restocked_at: string | null;
  created_at: string;
  updated_at: string;
};
type InventoryCandidateRow = {
  connection_id: string;
  local_variant_id: string;
  local_location_id: string;
  external_variant_id: string;
  external_location_id: string;
  variant_payload_json: string;
  on_hand: number;
  reserved: number;
};
type FulfilmentRow = { id: string; order_id: string; created_at: string };
type FulfilmentLineRow = { order_line_id: string; quantity: number };
type LocalOrderLineRow = { id: string; variant_id: string };
type OrderStateRow = { external_order_id: string; applied_proposal_json: string | null };
type FulfilmentLinkRow = { external_fulfilment_id: string | null; external_order_id: string };
type TrackingRow = {
  company: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  notify_customer: number;
};
type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
    };
  };
};

type InventoryDesired = {
  localVariantId: string;
  localLocationId: string;
  externalVariantId: string;
  inventoryItemId: string;
  externalLocationId: string;
  available: number;
};
type FulfilmentDesired = { localOrderId: string; localFulfilmentId: string; externalOrderId: string };
type TrackingDesired = { localFulfilmentId: string; externalFulfilmentId: string };

const trackingSchema = z.object({
  company: z.string().trim().max(120).nullable().optional(),
  trackingNumber: z.string().trim().max(255).nullable().optional(),
  trackingUrl: z.string().url().max(1000).nullable().optional(),
  notifyCustomer: z.boolean().default(false),
}).refine(value => !!(value.trackingNumber || value.trackingUrl), "Tracking number or URL is required");

const dispositionSchema = z.object({
  disposition: z.enum(["restock", "quarantine", "scrap", "return_to_vendor", "no_restock"]),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({ lineId: z.string().trim().min(1), quantity: z.number().int().positive() })).max(500).optional(),
});

const returnObservationSchema = z.object({
  connectionId: z.string().uuid(),
  topic: z.string().trim().min(1).max(120),
  payloadJson: z.string().max(2_000_000),
});

const INVENTORY_MUTATION_PATHS = [
  /^\/inventory(?:\/|$)/,
  /^\/purchase-orders\/[^/]+\/receive$/,
  /^\/orders\/[^/]+\/(confirm|cancel|fulfil|return)$/,
  /^\/service\/jobs\/[^/]+\/materials$/,
];
const MAX_JOBS_PER_ALARM = 25;
const JOB_LEASE_MS = 2 * 60_000;
const SHOPIFY_REQUEST_TIMEOUT_MS = 30_000;
const MAX_AUTOMATIC_ATTEMPTS = 8;
const BASE_RETRY_MS = 2_000;

class ProviderError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null = null, readonly ambiguous = false) {
    super(message);
  }
}

function now() {
  return new Date().toISOString();
}

function actorFrom(request: Request): Actor {
  return {
    id: request.headers.get("x-ordermate-actor-id")?.trim() || "integration-system",
    role: request.headers.get("x-ordermate-actor-role")?.trim() || "integration",
    name: request.headers.get("x-ordermate-actor-name")?.trim() || "Integration system",
  };
}

function parseJson<T>(value: string): T | null {
  try { return JSON.parse(value) as T; } catch { return null; }
}

function job(row: JobRow): IntegrationOutboundJob {
  return {
    id: row.id,
    connectionId: row.connection_id,
    operation: row.operation,
    coalescingKey: row.coalescing_key,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    providerRequestId: row.provider_request_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function reconciliation(row: ReconciliationRow): IntegrationReconciliation {
  return {
    connectionId: row.connection_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    direction: row.direction,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function returnCase(row: ReturnCaseRow): IntegrationReturnCase {
  return {
    id: row.id,
    connectionId: row.connection_id,
    externalReturnId: row.external_return_id,
    externalOrderId: row.external_order_id,
    localOrderId: row.local_order_id,
    refundObserved: row.refund_observed === 1,
    providerStatus: row.provider_status,
    disposition: row.disposition,
    restockedAt: row.restocked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function retryDelay(attempt: number) {
  const capped = Math.min(attempt, 8);
  return Math.min(15 * 60_000, BASE_RETRY_MS * 2 ** Math.max(0, capped - 1)) + Math.floor(Math.random() * 750);
}

function shopifyOrderGid(value: unknown) {
  if (typeof value === "string" && value.startsWith("gid://shopify/Order/")) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return `gid://shopify/Order/${value}`;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return `gid://shopify/Order/${value}`;
  return null;
}

function shopifyReturnIdentity(topic: string, payload: Record<string, unknown>) {
  const rawId = payload.admin_graphql_api_id ?? payload.id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : crypto.randomUUID();
  return `${topic.startsWith("refunds/") ? "refund" : "return"}:${id}`;
}

export class IntegrationOutboundRuntime {
  private processing: Promise<void> | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: IntegrationOutboundEnv,
    private readonly canonicalFetch: CanonicalFetch,
  ) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "POST" && path === "/__integrations/returns/observe") {
      if (request.headers.get("x-operating-layer-internal-integration") !== "integration-v1") return Response.json({ error: "Internal integration route" }, { status: 404 });
      return this.observeReturn(request);
    }

    const operations = path.match(/^\/integrations\/([^/]+)\/operations$/);
    if (request.method === "GET" && operations) return this.operations(decodeURIComponent(operations[1]));

    const reconcileInventory = path.match(/^\/integrations\/([^/]+)\/inventory\/reconcile$/);
    if (request.method === "POST" && reconcileInventory) {
      const connectionId = decodeURIComponent(reconcileInventory[1]);
      const count = this.enqueueInventorySweep(actorFrom(request), connectionId, "manual_reconciliation");
      await this.armAlarm(0);
      return Response.json({ ok: true, queued: count });
    }

    const drain = path.match(/^\/integrations\/([^/]+)\/outbound\/drain$/);
    if (request.method === "POST" && drain) {
      const connectionId = decodeURIComponent(drain[1]);
      await this.processDue(connectionId);
      return this.operations(connectionId);
    }

    const tracking = path.match(/^\/integrations\/([^/]+)\/fulfilments\/([^/]+)\/tracking$/);
    if (request.method === "POST" && tracking) {
      return this.setTracking(decodeURIComponent(tracking[1]), decodeURIComponent(tracking[2]), request);
    }

    const disposition = path.match(/^\/integrations\/([^/]+)\/returns\/([^/]+)\/disposition$/);
    if (request.method === "POST" && disposition) {
      return this.setDisposition(decodeURIComponent(disposition[1]), decodeURIComponent(disposition[2]), request);
    }

    return null;
  }

  async afterCanonicalMutation(request: Request, response: Response) {
    if (!response.ok || !["POST", "PATCH", "PUT", "DELETE"].includes(request.method.toUpperCase())) return response;
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    if (!INVENTORY_MUTATION_PATHS.some(pattern => pattern.test(path))) return response;

    const actor = actorFrom(request);
    this.enqueueInventorySweep(actor, null, path);
    const fulfil = path.match(/^\/orders\/([^/]+)\/fulfil$/);
    if (fulfil) this.enqueueLatestFulfilment(decodeURIComponent(fulfil[1]), actor);
    await this.armAlarm(250);
    return response;
  }

  async alarm() {
    await this.processDue();
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private connection(connectionId: string) {
    return this.one<ConnectionRow>(
      "SELECT id, provider, external_account_id, display_name, status, capabilities_json FROM integration_connections WHERE id = ?",
      connectionId,
    ) || null;
  }

  private audit(actor: Actor, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}) {
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), actor.id, actor.role, action, entityType, entityId, JSON.stringify(metadata), now(),
    );
  }

  private exception(connectionId: string, code: string, message: string, entityType: string, externalId: string, retryable: boolean) {
    const id = `outbound:${connectionId}:${code}:${entityType}:${externalId}`;
    const timestamp = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_exceptions (
         id, connection_id, code, message, retryable, status, entity_type, external_id, created_at
       ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET message = excluded.message, retryable = excluded.retryable,
         status = 'open', resolved_at = NULL, resolved_by = NULL`,
      id, connectionId, code, message, retryable ? 1 : 0, entityType, externalId, timestamp,
    );
  }

  private resolveException(connectionId: string, entityType: string, externalId: string) {
    this.ctx.storage.sql.exec(
      `UPDATE integration_exceptions SET status = 'resolved', resolved_at = ?, resolved_by = 'integration-outbound'
       WHERE connection_id = ? AND status = 'open' AND entity_type = ? AND external_id = ? AND id LIKE 'outbound:%'`,
      now(), connectionId, entityType, externalId,
    );
  }

  private upsertJob(input: {
    connectionId: string;
    operation: OutboundOperation;
    coalescingKey: string;
    entityType: string;
    entityId: string;
    desired: unknown;
  }) {
    const timestamp = now();
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_outbound_jobs (
         id, connection_id, operation, coalescing_key, entity_type, entity_id,
         desired_json, status, attempts, next_attempt_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
       ON CONFLICT(connection_id, coalescing_key) DO UPDATE SET
         operation = excluded.operation,
         entity_type = excluded.entity_type,
         entity_id = excluded.entity_id,
         desired_json = excluded.desired_json,
         generation = CASE WHEN integration_outbound_jobs.status = 'running'
           AND integration_outbound_jobs.desired_json = excluded.desired_json
           THEN integration_outbound_jobs.generation ELSE integration_outbound_jobs.generation + 1 END,
         status = CASE WHEN integration_outbound_jobs.status = 'running' THEN 'running' ELSE 'pending' END,
         attempts = CASE WHEN integration_outbound_jobs.status = 'running'
           AND integration_outbound_jobs.desired_json = excluded.desired_json
           THEN integration_outbound_jobs.attempts ELSE 0 END,
         next_attempt_at = excluded.next_attempt_at,
         provider_request_id = NULL,
         last_error = NULL,
         completed_at = NULL,
         updated_at = excluded.updated_at
       WHERE NOT (integration_outbound_jobs.operation = 'fulfilment_publish' AND integration_outbound_jobs.status = 'failed')`,
      id, input.connectionId, input.operation, input.coalescingKey, input.entityType, input.entityId,
      JSON.stringify(input.desired), timestamp, timestamp, timestamp,
    );
  }

  private inventoryCandidates(connectionId?: string | null) {
    const bindings: unknown[] = [];
    let connectionFilter = "";
    if (connectionId) {
      connectionFilter = " AND c.id = ?";
      bindings.push(connectionId);
    }
    return this.rows<InventoryCandidateRow>(
      `SELECT c.id AS connection_id,
              v.local_entity_id AS local_variant_id,
              l.local_entity_id AS local_location_id,
              v.external_id AS external_variant_id,
              l.external_id AS external_location_id,
              COALESCE(ve.payload_json, '{}') AS variant_payload_json,
              COALESCE(il.on_hand, 0) AS on_hand,
              COALESCE(il.reserved, 0) AS reserved
       FROM integration_connections c
       JOIN integration_entity_links v
         ON v.connection_id = c.id AND v.provider = 'shopify'
        AND v.entity_type = 'variant' AND v.local_entity_type = 'product_variant'
       JOIN integration_entity_links l
         ON l.connection_id = c.id AND l.provider = 'shopify'
        AND l.entity_type = 'location' AND l.local_entity_type = 'location'
       LEFT JOIN integration_external_entities ve
         ON ve.connection_id = c.id AND ve.entity_type = 'variant' AND ve.external_id = v.external_id
       LEFT JOIN inventory_levels il
         ON il.variant_id = v.local_entity_id AND il.location_id = l.local_entity_id
       WHERE c.provider = 'shopify' AND c.status = 'active'${connectionFilter}
       ORDER BY c.id, v.local_entity_id, l.local_entity_id`,
      ...bindings,
    );
  }

  private enqueueInventorySweep(actor: Actor, connectionId: string | null, trigger: string) {
    const candidates = this.inventoryCandidates(connectionId);
    let queued = 0;
    this.ctx.storage.transactionSync(() => {
      for (const candidate of candidates) {
        const payload = parseJson<Record<string, unknown>>(candidate.variant_payload_json) || {};
        const inventoryItemId = typeof payload.inventoryItemId === "string" ? payload.inventoryItemId : null;
        if (!inventoryItemId) {
          this.exception(candidate.connection_id, "missing_inventory_item_identity", "Shopify variant mapping predates inventory publishing metadata. Run catalogue sync again before inventory can be published.", "variant", candidate.external_variant_id, true);
          continue;
        }
        const available = Math.max(0, candidate.on_hand - candidate.reserved);
        const desired: InventoryDesired = {
          localVariantId: candidate.local_variant_id,
          localLocationId: candidate.local_location_id,
          externalVariantId: candidate.external_variant_id,
          inventoryItemId,
          externalLocationId: candidate.external_location_id,
          available,
        };
        this.upsertJob({
          connectionId: candidate.connection_id,
          operation: "inventory_publish",
          coalescingKey: `inventory:${candidate.local_variant_id}:${candidate.local_location_id}`,
          entityType: "inventory_level",
          entityId: `${candidate.local_variant_id}:${candidate.local_location_id}`,
          desired,
        });
        this.upsertReconciliation(candidate.connection_id, "inventory_level", desired.localVariantId + ":" + desired.localLocationId, "pending", null, null, null);
        queued += 1;
      }
      if (queued) this.audit(actor, "integration.inventory_publish_queued", "integration_connection", connectionId, { trigger, queued });
    });
    return queued;
  }

  private enqueueLatestFulfilment(orderId: string, actor: Actor) {
    const fulfilment = this.one<FulfilmentRow>(
      "SELECT id, order_id, created_at FROM fulfilments WHERE order_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      orderId,
    );
    if (!fulfilment) return 0;
    const states = this.rows<{ connection_id: string; external_order_id: string }>(
      `SELECT s.connection_id, s.external_order_id
       FROM integration_order_state s JOIN integration_connections c ON c.id = s.connection_id
       WHERE s.local_order_id = ? AND s.status = 'active' AND c.provider = 'shopify' AND c.status = 'active'`,
      orderId,
    );
    for (const state of states) {
      const desired: FulfilmentDesired = { localOrderId: orderId, localFulfilmentId: fulfilment.id, externalOrderId: state.external_order_id };
      this.upsertJob({
        connectionId: state.connection_id,
        operation: "fulfilment_publish",
        coalescingKey: `fulfilment:${fulfilment.id}`,
        entityType: "fulfilment",
        entityId: fulfilment.id,
        desired,
      });
      this.upsertReconciliation(state.connection_id, "fulfilment", fulfilment.id, "pending", null, null, null);
      this.audit(actor, "integration.fulfilment_publish_queued", "fulfilment", fulfilment.id, { connectionId: state.connection_id });
    }
    return states.length;
  }

  private async armAlarm(delayMs: number) {
    const due = Date.now() + Math.max(0, delayMs);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > due) await this.ctx.storage.setAlarm(due);
  }

  private operations(connectionId: string) {
    if (!this.connection(connectionId)) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    const jobs = this.rows<JobRow>(
      `SELECT * FROM integration_outbound_jobs WHERE connection_id = ? ORDER BY updated_at DESC LIMIT 100`,
      connectionId,
    ).map(job);
    const reconciliations = this.rows<ReconciliationRow>(
      `SELECT * FROM integration_reconciliation WHERE connection_id = ? ORDER BY updated_at DESC LIMIT 250`,
      connectionId,
    ).map(reconciliation);
    const returns = this.rows<ReturnCaseRow>(
      `SELECT * FROM integration_return_cases WHERE connection_id = ? ORDER BY updated_at DESC LIMIT 100`,
      connectionId,
    ).map(returnCase);
    const oldest = this.one<{ value: string | null }>(
      `SELECT MIN(created_at) AS value FROM integration_outbound_jobs
       WHERE connection_id = ? AND status IN ('pending','running','retry_wait')`,
      connectionId,
    )?.value || null;
    const health: IntegrationOperationalHealth = {
      pendingOutbound: jobs.filter(item => item.status === "pending" || item.status === "running").length,
      retryingOutbound: jobs.filter(item => item.status === "retry_wait").length,
      failedOutbound: jobs.filter(item => item.status === "failed").length,
      reconciliationDrift: reconciliations.filter(item => item.status === "drift" || item.status === "error").length,
      pendingReturns: returns.filter(item => item.disposition === "pending").length,
      oldestPendingAt: oldest,
    };
    return Response.json({ health, jobs, reconciliations, returns });
  }

  private upsertReconciliation(
    connectionId: string,
    entityType: string,
    entityId: string,
    status: ReconciliationStatus,
    desiredHash: string | null,
    observedHash: string | null,
    error: string | null,
  ) {
    const timestamp = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_reconciliation (
         connection_id, entity_type, entity_id, direction, desired_hash, observed_hash,
         status, last_checked_at, last_success_at, last_error, updated_at
       ) VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, entity_type, entity_id, direction) DO UPDATE SET
         desired_hash = COALESCE(excluded.desired_hash, integration_reconciliation.desired_hash),
         observed_hash = COALESCE(excluded.observed_hash, integration_reconciliation.observed_hash),
         status = excluded.status,
         last_checked_at = CASE WHEN excluded.status = 'pending' THEN integration_reconciliation.last_checked_at ELSE excluded.last_checked_at END,
         last_success_at = CASE WHEN excluded.status = 'in_sync' THEN excluded.last_success_at ELSE integration_reconciliation.last_success_at END,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      connectionId, entityType, entityId, desiredHash, observedHash, status,
      status === "pending" ? null : timestamp,
      status === "in_sync" ? timestamp : null,
      error,
      timestamp,
    );
  }

  private async usableShopify(connection: ConnectionRow) {
    if (!this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || !this.env.INTEGRATION_TOKEN_KEY_VERSION) throw new ProviderError("Integration token encryption is not configured");
    if (!this.env.SHOPIFY_CLIENT_ID || !this.env.SHOPIFY_CLIENT_SECRET || !this.env.SHOPIFY_API_VERSION) throw new ProviderError("Shopify outbound publishing is not configured");
    const credential = this.one<CredentialRow>(
      `SELECT encrypted_payload_json, scopes_json, access_token_expires_at, refresh_token_expires_at
       FROM integration_credentials WHERE connection_id = ?`,
      connection.id,
    );
    if (!credential) throw new ProviderError("Shopify credentials are unavailable; reconnect the store");
    const envelope = parseJson<EncryptedCredentialEnvelope>(credential.encrypted_payload_json);
    if (!envelope) throw new ProviderError("Shopify credential envelope is invalid");
    let secrets = await decryptCredentialPayload<ShopifySecrets>(
      envelope,
      this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
      this.env.INTEGRATION_TOKEN_KEY_VERSION,
    );
    const expiresAt = new Date(credential.access_token_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
      if (!secrets.refreshToken) throw new ProviderError("Shopify refresh token is unavailable; reconnect the store");
      const tokens = await refreshShopifyOfflineToken({
        shop: connection.external_account_id,
        clientId: this.env.SHOPIFY_CLIENT_ID,
        clientSecret: this.env.SHOPIFY_CLIENT_SECRET,
        refreshToken: secrets.refreshToken,
      });
      const missing = missingShopifyScopes(shopifyScopes(this.env.SHOPIFY_SCOPES || ""), tokens.scope);
      if (missing.length) throw new ProviderError(`Shopify no longer grants required scopes: ${missing.join(", ")}`);
      const rotated = await encryptCredentialPayload(
        { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        this.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
        this.env.INTEGRATION_TOKEN_KEY_VERSION,
      );
      const issuedAt = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE integration_credentials SET encrypted_payload_json = ?, key_version = ?, scopes_json = ?,
         access_token_expires_at = ?, refresh_token_expires_at = ?, updated_at = ? WHERE connection_id = ?`,
        JSON.stringify(rotated), rotated.keyVersion, JSON.stringify(tokens.scope),
        tokenExpiryIso(tokens.expiresIn, issuedAt), tokenExpiryIso(tokens.refreshTokenExpiresIn, issuedAt), now(), connection.id,
      );
      secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }
    return { accessToken: secrets.accessToken, apiVersion: this.env.SHOPIFY_API_VERSION };
  }

  private async shopifyGraphql<T>(connection: ConnectionRow, query: string, variables: Record<string, unknown>, unsafeCreate = false) {
    const auth = await this.usableShopify(connection);
    let response: Response;
    try {
      response = await fetch(`https://${connection.external_account_id}/admin/api/${auth.apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": auth.accessToken },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(SHOPIFY_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError("Shopify request outcome is unknown after a network failure; review before replaying a fulfilment", null, unsafeCreate);
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after") || "1");
      throw new ProviderError("Shopify rate limit reached", Number.isFinite(seconds) ? Math.max(1_000, seconds * 1_000) : 2_000);
    }
    if (!response.ok) {
      throw new ProviderError(`Shopify Admin API request failed (${response.status})`, response.status >= 500 ? retryDelay(1) : null, unsafeCreate && response.status >= 500);
    }
    let envelope: ShopifyGraphqlEnvelope<T>;
    try {
      envelope = await response.json<ShopifyGraphqlEnvelope<T>>();
    } catch {
      throw new ProviderError("Shopify response could not be decoded; the mutation outcome is unknown", null, unsafeCreate);
    }
    const throttled = envelope.errors?.some(error => error.extensions?.code === "THROTTLED");
    if (throttled) {
      const throttle = envelope.extensions?.cost?.throttleStatus;
      const restoreRate = throttle?.restoreRate || 50;
      const currentlyAvailable = throttle?.currentlyAvailable || 0;
      const requested = envelope.extensions?.cost?.requestedQueryCost || 50;
      const waitMs = Math.ceil(Math.max(1, requested - currentlyAvailable) / restoreRate * 1000);
      throw new ProviderError("Shopify GraphQL cost throttle reached", Math.max(1_000, waitMs));
    }
    if (envelope.errors?.length) {
      throw new ProviderError(envelope.errors.map(error => error.message).filter(Boolean).join("; ") || "Shopify GraphQL request failed", null, unsafeCreate);
    }
    if (!envelope.data) throw new ProviderError("Shopify GraphQL response did not include data", null, unsafeCreate);
    return { data: envelope.data, throttle: envelope.extensions?.cost?.throttleStatus || null };
  }

  private async processInventory(jobRow: JobRow, connection: ConnectionRow) {
    const desired = parseJson<InventoryDesired>(jobRow.desired_json);
    if (!desired) throw new ProviderError("Inventory outbound job payload is invalid");
    const desiredHash = await sha256(JSON.stringify({ available: desired.available }));
    const query = `#graphql
      query OperatingLayerInventoryObserved($inventoryItemId: ID!, $locationId: ID!) {
        inventoryItem(id: $inventoryItemId) {
          inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
        }
      }
    `;
    const observedResponse = await this.shopifyGraphql<{
      inventoryItem: { inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null } | null;
    }>(connection, query, { inventoryItemId: desired.inventoryItemId, locationId: desired.externalLocationId });
    const observed = observedResponse.data.inventoryItem?.inventoryLevel?.quantities.find(quantity => quantity.name === "available")?.quantity;
    if (observed === undefined) throw new ProviderError("Shopify inventory level is not active at the mapped location");
    const observedHash = await sha256(JSON.stringify({ available: observed }));
    if (observed === desired.available) {
      this.upsertReconciliation(connection.id, "inventory_level", jobRow.entity_id, "in_sync", desiredHash, observedHash, null);
      return { providerRequestId: null };
    }

    this.upsertReconciliation(connection.id, "inventory_level", jobRow.entity_id, "drift", desiredHash, observedHash, null);
    const mutation = `#graphql
      mutation OperatingLayerInventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
          userErrors { code field message }
        }
      }
    `;
    const result = await this.shopifyGraphql<{
      inventorySetQuantities: {
        inventoryAdjustmentGroup: { changes: Array<{ name: string; delta: number; quantityAfterChange: number }> } | null;
        userErrors: Array<{ code?: string | null; message: string }>;
      };
    }>(connection, mutation, {
      // The same key always denotes the same generation AND compare-and-set payload.
      idempotencyKey: await sha256(JSON.stringify({
        jobId: jobRow.id, generation: jobRow.generation, desired, changeFromQuantity: observed,
      })),
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: `ordermate://inventory/${encodeURIComponent(jobRow.entity_id)}`,
        quantities: [{
          inventoryItemId: desired.inventoryItemId,
          locationId: desired.externalLocationId,
          quantity: desired.available,
          changeFromQuantity: observed,
        }],
      },
    });
    const errors = result.data.inventorySetQuantities.userErrors;
    if (errors.length) {
      const stale = errors.some(error => error.code === "CHANGE_FROM_QUANTITY_STALE");
      throw new ProviderError(errors.map(error => error.message).join("; "), stale ? 1_000 : null);
    }
    const after = result.data.inventorySetQuantities.inventoryAdjustmentGroup?.changes.find(change => change.name === "available")?.quantityAfterChange ?? desired.available;
    const afterHash = await sha256(JSON.stringify({ available: after }));
    this.upsertReconciliation(connection.id, "inventory_level", jobRow.entity_id, after === desired.available ? "in_sync" : "drift", desiredHash, afterHash, null);
    this.resolveException(connection.id, "variant", desired.externalVariantId);
    return { providerRequestId: jobRow.id };
  }

  private localToExternalOrderLines(connectionId: string, localOrderId: string, proposal: IntegrationOrderProposal) {
    const localLines = this.rows<LocalOrderLineRow>("SELECT id, variant_id FROM order_lines WHERE order_id = ? ORDER BY rowid", localOrderId);
    if (localLines.length !== proposal.lines.length) throw new ProviderError("Canonical order lines no longer match the imported Shopify order; fulfilment requires operator review");
    const variantLinks = new Map(this.rows<{ external_id: string; local_entity_id: string }>(
      `SELECT external_id, local_entity_id FROM integration_entity_links
       WHERE connection_id = ? AND entity_type = 'variant' AND local_entity_type = 'product_variant'`,
      connectionId,
    ).map(row => [row.external_id, row.local_entity_id] as const));
    const map = new Map<string, string>();
    for (let index = 0; index < localLines.length; index += 1) {
      const external = proposal.lines[index];
      const local = localLines[index];
      if (!external || !local || variantLinks.get(external.externalVariantId) !== local.variant_id) {
        throw new ProviderError("Canonical order line identity differs from the imported Shopify order; fulfilment was not published automatically");
      }
      map.set(local.id, external.externalLineId);
    }
    return map;
  }

  private async processFulfilment(jobRow: JobRow, connection: ConnectionRow) {
    const desired = parseJson<FulfilmentDesired>(jobRow.desired_json);
    if (!desired) throw new ProviderError("Fulfilment outbound job payload is invalid");
    const existing = this.one<FulfilmentLinkRow>(
      "SELECT external_fulfilment_id, external_order_id FROM integration_fulfilment_links WHERE connection_id = ? AND local_fulfilment_id = ?",
      connection.id, desired.localFulfilmentId,
    );
    if (existing?.external_fulfilment_id) {
      this.upsertReconciliation(connection.id, "fulfilment", desired.localFulfilmentId, "in_sync", await sha256(jobRow.desired_json), await sha256(existing.external_fulfilment_id), null);
      return { providerRequestId: existing.external_fulfilment_id };
    }
    const state = this.one<OrderStateRow>(
      `SELECT external_order_id, applied_proposal_json FROM integration_order_state
       WHERE connection_id = ? AND local_order_id = ? AND status = 'active'`,
      connection.id, desired.localOrderId,
    );
    const proposal = state?.applied_proposal_json ? parseJson<IntegrationOrderProposal>(state.applied_proposal_json) : null;
    if (!state || !proposal) throw new ProviderError("Shopify order reconciliation state is unavailable for this fulfilment");
    const lineIdentity = this.localToExternalOrderLines(connection.id, desired.localOrderId, proposal);
    const fulfilled = this.rows<FulfilmentLineRow>(
      "SELECT order_line_id, quantity FROM fulfilment_lines WHERE fulfilment_id = ? ORDER BY rowid",
      desired.localFulfilmentId,
    );
    if (!fulfilled.length) throw new ProviderError("Canonical fulfilment has no lines");
    const desiredByExternalLine = new Map<string, number>();
    for (const line of fulfilled) {
      const externalLineId = lineIdentity.get(line.order_line_id);
      if (!externalLineId) throw new ProviderError("A canonical fulfilment line cannot be mapped back to its Shopify order line");
      desiredByExternalLine.set(externalLineId, (desiredByExternalLine.get(externalLineId) || 0) + line.quantity);
    }

    const query = `#graphql
      query OperatingLayerFulfilmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 50) {
            nodes {
              id
              status
              lineItems(first: 250) {
                nodes { id remainingQuantity lineItem { id } }
              }
            }
          }
        }
      }
    `;
    const observed = await this.shopifyGraphql<{
      order: { fulfillmentOrders: { nodes: Array<{ id: string; status: string; lineItems: { nodes: Array<{ id: string; remainingQuantity: number; lineItem: { id: string } | null }> } }> } } | null;
    }>(connection, query, { id: desired.externalOrderId });
    if (!observed.data.order) throw new ProviderError("Shopify order is no longer available for fulfilment publishing");
    const lineItemsByFulfillmentOrder: Array<{ fulfillmentOrderId: string; fulfillmentOrderLineItems: Array<{ id: string; quantity: number }> }> = [];
    const remaining = new Map(desiredByExternalLine);
    for (const fulfilmentOrder of observed.data.order.fulfillmentOrders.nodes) {
      if (["CLOSED", "CANCELLED"].includes(fulfilmentOrder.status)) continue;
      const items: Array<{ id: string; quantity: number }> = [];
      for (const item of fulfilmentOrder.lineItems.nodes) {
        const externalLineId = item.lineItem?.id;
        if (!externalLineId) continue;
        const wanted = remaining.get(externalLineId) || 0;
        if (!wanted) continue;
        const quantity = Math.min(wanted, item.remainingQuantity);
        if (quantity > 0) {
          items.push({ id: item.id, quantity });
          remaining.set(externalLineId, wanted - quantity);
        }
      }
      if (items.length) lineItemsByFulfillmentOrder.push({ fulfillmentOrderId: fulfilmentOrder.id, fulfillmentOrderLineItems: items });
    }
    if ([...remaining.values()].some(quantity => quantity > 0)) {
      throw new ProviderError("Shopify no longer has enough fulfillable quantity for this canonical fulfilment; reconciliation is required");
    }

    const tracking = this.one<TrackingRow>(
      `SELECT company, tracking_number, tracking_url, notify_customer FROM integration_fulfilment_tracking
       WHERE connection_id = ? AND local_fulfilment_id = ?`,
      connection.id, desired.localFulfilmentId,
    );
    const mutation = `#graphql
      mutation OperatingLayerFulfilmentCreate($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) {
          fulfillment { id status trackingInfo(first: 10) { company number url } }
          userErrors { field message }
        }
      }
    `;
    const variables: Record<string, unknown> = {
      fulfillment: {
        lineItemsByFulfillmentOrder,
        notifyCustomer: tracking?.notify_customer === 1,
        ...(tracking && (tracking.tracking_number || tracking.tracking_url) ? {
          trackingInfo: {
            ...(tracking.company ? { company: tracking.company } : {}),
            ...(tracking.tracking_number ? { number: tracking.tracking_number } : {}),
            ...(tracking.tracking_url ? { url: tracking.tracking_url } : {}),
          },
        } : {}),
      },
    };
    const result = await this.shopifyGraphql<{
      fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
    }>(connection, mutation, variables, true);
    if (!result.data.fulfillmentCreate || !Array.isArray(result.data.fulfillmentCreate.userErrors)) {
      throw new ProviderError("Shopify fulfilment response was incomplete; reconcile before replaying", null, true);
    }
    if (result.data.fulfillmentCreate.userErrors.length) {
      throw new ProviderError(result.data.fulfillmentCreate.userErrors.map(error => error.message).join("; "));
    }
    const externalFulfilmentId = result.data.fulfillmentCreate.fulfillment?.id;
    if (!externalFulfilmentId) throw new ProviderError("Shopify did not return the created fulfilment identity", null, true);
    const timestamp = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_fulfilment_links (
         connection_id, local_fulfilment_id, external_fulfilment_id, external_order_id, published_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, local_fulfilment_id) DO UPDATE SET
         external_fulfilment_id = excluded.external_fulfilment_id,
         external_order_id = excluded.external_order_id,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at`,
      connection.id, desired.localFulfilmentId, externalFulfilmentId, desired.externalOrderId, timestamp, timestamp,
    );
    this.upsertReconciliation(connection.id, "fulfilment", desired.localFulfilmentId, "in_sync", await sha256(jobRow.desired_json), await sha256(externalFulfilmentId), null);
    return { providerRequestId: externalFulfilmentId };
  }

  private async processTracking(jobRow: JobRow, connection: ConnectionRow) {
    const desired = parseJson<TrackingDesired>(jobRow.desired_json);
    if (!desired) throw new ProviderError("Tracking outbound job payload is invalid");
    const tracking = this.one<TrackingRow>(
      `SELECT company, tracking_number, tracking_url, notify_customer FROM integration_fulfilment_tracking
       WHERE connection_id = ? AND local_fulfilment_id = ?`,
      connection.id, desired.localFulfilmentId,
    );
    if (!tracking || (!tracking.tracking_number && !tracking.tracking_url)) throw new ProviderError("Tracking details are unavailable");
    const mutation = `#graphql
      mutation OperatingLayerTrackingUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
        fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
          fulfillment { id trackingInfo(first: 10) { company number url } }
          userErrors { field message }
        }
      }
    `;
    const result = await this.shopifyGraphql<{
      fulfillmentTrackingInfoUpdate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
    }>(connection, mutation, {
      fulfillmentId: desired.externalFulfilmentId,
      notifyCustomer: tracking.notify_customer === 1,
      trackingInfoInput: {
        ...(tracking.company ? { company: tracking.company } : {}),
        ...(tracking.tracking_number ? { number: tracking.tracking_number } : {}),
        ...(tracking.tracking_url ? { url: tracking.tracking_url } : {}),
      },
    });
    if (result.data.fulfillmentTrackingInfoUpdate.userErrors.length) {
      throw new ProviderError(result.data.fulfillmentTrackingInfoUpdate.userErrors.map(error => error.message).join("; "));
    }
    const desiredHash = await sha256(JSON.stringify(tracking));
    this.upsertReconciliation(connection.id, "tracking", desired.localFulfilmentId, "in_sync", desiredHash, desiredHash, null);
    return { providerRequestId: desired.externalFulfilmentId };
  }

  private async processJob(jobRow: JobRow) {
    const connection = this.connection(jobRow.connection_id);
    if (!connection || connection.status !== "active") throw new ProviderError("Integration connection is not active");
    if (connection.provider !== "shopify") throw new ProviderError(`Outbound operation ${jobRow.operation} is not implemented for ${connection.provider}`);
    if (jobRow.operation === "inventory_publish") return this.processInventory(jobRow, connection);
    if (jobRow.operation === "fulfilment_publish") return this.processFulfilment(jobRow, connection);
    if (jobRow.operation === "tracking_publish") return this.processTracking(jobRow, connection);
    throw new ProviderError(`Unsupported Shopify outbound operation ${jobRow.operation}`);
  }

  async processDue(connectionId?: string) {
    // Alarms and manual drains share one publisher per tenant object.
    if (this.processing) return this.processing;
    const processing = this.drainDue(connectionId);
    this.processing = processing;
    try {
      await processing;
    } finally {
      if (this.processing === processing) this.processing = null;
    }
  }

  private recoverExpiredJobs() {
    const timestamp = now();
    const expired = this.rows<JobRow>(
      "SELECT * FROM integration_outbound_jobs WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
      timestamp,
    );
    for (const row of expired) {
      const linked = row.operation === "fulfilment_publish" && this.one<FulfilmentLinkRow>(
        "SELECT external_fulfilment_id, external_order_id FROM integration_fulfilment_links WHERE connection_id = ? AND local_fulfilment_id = ?",
        row.connection_id, row.entity_id,
      )?.external_fulfilment_id;
      const ambiguous = row.operation === "fulfilment_publish" && !linked;
      const error = ambiguous ? "Fulfilment publisher was interrupted; reconcile Shopify before replaying this canonical fulfilment" : null;
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE integration_outbound_jobs SET status = ?, lease_token = NULL, lease_expires_at = NULL, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'",
          ambiguous ? "failed" : "pending", timestamp, error, timestamp, row.id,
        );
        if (ambiguous) {
          this.upsertReconciliation(row.connection_id, row.entity_type, row.entity_id, "error", null, null, error);
          this.exception(row.connection_id, "outbound_publish_failed", error!, row.entity_type, row.entity_id, false);
        }
        this.audit({ id: "integration-outbound", role: "system", name: "Integration publisher" },
          "integration.outbound_lease_recovered", row.entity_type, row.entity_id, { connectionId: row.connection_id, ambiguous });
      });
    }
  }

  private async scheduleNextAlarm() {
    const next = this.one<{ value: string | null }>(
      `SELECT MIN(due_at) AS value FROM (
         SELECT next_attempt_at AS due_at FROM integration_outbound_jobs WHERE status IN ('pending','retry_wait')
         UNION ALL
         SELECT COALESCE(lease_expires_at, ?) AS due_at FROM integration_outbound_jobs WHERE status = 'running'
       )`,
      now(),
    )?.value;
    if (next) await this.armAlarm(Math.max(250, new Date(next).getTime() - Date.now()));
  }

  private releaseNewerGeneration(running: JobRow) {
    const released = this.ctx.storage.sql.exec(
      `UPDATE integration_outbound_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_token = ? AND generation != ?`,
      now(), running.id, running.lease_token, running.generation,
    );
    if (released.rowsWritten) {
      this.upsertReconciliation(running.connection_id, running.entity_type, running.entity_id, "pending", null, null, null);
    }
    return released.rowsWritten > 0;
  }

  private async drainDue(connectionId?: string) {
    this.recoverExpiredJobs();
    const timestamp = now();
    const bindings: unknown[] = [timestamp];
    let filter = "";
    if (connectionId) {
      filter = " AND connection_id = ?";
      bindings.push(connectionId);
    }
    const due = this.rows<JobRow>(
      `SELECT * FROM integration_outbound_jobs
       WHERE status IN ('pending','retry_wait') AND next_attempt_at <= ?${filter}
       ORDER BY next_attempt_at, created_at LIMIT ${MAX_JOBS_PER_ALARM}`,
      ...bindings,
    );
    try {
      for (const current of due) {
        const startedAt = now();
        const token = crypto.randomUUID();
        const leaseExpiresAt = new Date(Date.now() + JOB_LEASE_MS).toISOString();
        const claimed = this.ctx.storage.sql.exec(
          `UPDATE integration_outbound_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?,
             lease_token = ?, lease_expires_at = ?
           WHERE id = ? AND status IN ('pending','retry_wait') AND generation = ?`,
          startedAt, token, leaseExpiresAt, current.id, current.generation,
        );
        if (!claimed.rowsWritten) continue;
        const running = this.one<JobRow>("SELECT * FROM integration_outbound_jobs WHERE id = ?", current.id);
        if (!running) continue;
        // Persist a wake-up before any provider I/O so a runtime reset cannot strand the claim.
        await this.scheduleNextAlarm();
        try {
          const result = await this.processJob(running);
          if (this.releaseNewerGeneration(running)) continue;
          const completedAt = now();
          const completed = this.ctx.storage.sql.exec(
            `UPDATE integration_outbound_jobs SET status = 'succeeded', provider_request_id = ?, last_error = NULL,
             completed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
             WHERE id = ? AND status = 'running' AND lease_token = ? AND generation = ?`,
            result.providerRequestId, completedAt, completedAt, running.id, token, running.generation,
          );
          if (!completed.rowsWritten) continue;
          this.resolveException(running.connection_id, running.entity_type, running.entity_id);
          this.ctx.storage.sql.exec(
            "UPDATE integration_connections SET last_success_at = ?, last_error_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
            completedAt, completedAt, running.connection_id,
          );
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : "Outbound integration operation failed";
          const provider = cause instanceof ProviderError ? cause : null;
          // Never release an uncertain fulfilment create to a new automatic generation.
          if (!provider?.ambiguous && this.releaseNewerGeneration(running)) continue;
          const retryable = !provider?.ambiguous && running.attempts < MAX_AUTOMATIC_ATTEMPTS;
          const delay = provider?.retryAfterMs ?? retryDelay(running.attempts);
          const nextAttemptAt = new Date(Date.now() + delay).toISOString();
          const status: OutboundJobStatus = retryable ? "retry_wait" : "failed";
          const failed = this.ctx.storage.sql.exec(
            `UPDATE integration_outbound_jobs SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?,
             lease_token = NULL, lease_expires_at = NULL
             WHERE id = ? AND status = 'running' AND lease_token = ?`,
            status, nextAttemptAt, error.slice(0, 2000), now(), running.id, token,
          );
          if (!failed.rowsWritten) continue;
          this.ctx.storage.sql.exec(
            "UPDATE integration_connections SET last_error_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
            now(), error.slice(0, 1000), now(), running.connection_id,
          );
          this.upsertReconciliation(running.connection_id, running.entity_type, running.entity_id, "error", null, null, error.slice(0, 1000));
          if (status === "failed") {
            this.exception(running.connection_id, "outbound_publish_failed", error.slice(0, 1800), running.entity_type, running.entity_id, !provider?.ambiguous);
          }
        }
      }
    } finally {
      await this.scheduleNextAlarm();
    }
  }

  private async setTracking(connectionId: string, fulfilmentId: string, request: Request) {
    if (!this.connection(connectionId)) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    if (!this.one<{ id: string }>("SELECT id FROM fulfilments WHERE id = ?", fulfilmentId)) return Response.json({ error: "Fulfilment not found" }, { status: 404 });
    const input = trackingSchema.parse(await request.json());
    const timestamp = now();
    const actor = actorFrom(request);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_fulfilment_tracking (
           connection_id, local_fulfilment_id, company, tracking_number, tracking_url, notify_customer, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, local_fulfilment_id) DO UPDATE SET
           company = excluded.company, tracking_number = excluded.tracking_number,
           tracking_url = excluded.tracking_url, notify_customer = excluded.notify_customer, updated_at = excluded.updated_at`,
        connectionId, fulfilmentId, input.company || null, input.trackingNumber || null, input.trackingUrl || null, input.notifyCustomer ? 1 : 0, timestamp,
      );
      const link = this.one<FulfilmentLinkRow>(
        "SELECT external_fulfilment_id, external_order_id FROM integration_fulfilment_links WHERE connection_id = ? AND local_fulfilment_id = ?",
        connectionId, fulfilmentId,
      );
      if (link?.external_fulfilment_id) {
        const desired: TrackingDesired = { localFulfilmentId: fulfilmentId, externalFulfilmentId: link.external_fulfilment_id };
        this.upsertJob({ connectionId, operation: "tracking_publish", coalescingKey: `tracking:${fulfilmentId}`, entityType: "tracking", entityId: fulfilmentId, desired });
        this.upsertReconciliation(connectionId, "tracking", fulfilmentId, "pending", null, null, null);
      } else {
        const fulfilment = this.one<{ order_id: string }>("SELECT order_id FROM fulfilments WHERE id = ?", fulfilmentId);
        const state = fulfilment ? this.one<{ external_order_id: string }>(
          "SELECT external_order_id FROM integration_order_state WHERE connection_id = ? AND local_order_id = ? AND status = 'active'",
          connectionId, fulfilment.order_id,
        ) : null;
        if (!fulfilment || !state) throw new Error("Fulfilment is not linked to an active imported order");
        const desired: FulfilmentDesired = { localOrderId: fulfilment.order_id, localFulfilmentId: fulfilmentId, externalOrderId: state.external_order_id };
        this.upsertJob({ connectionId, operation: "fulfilment_publish", coalescingKey: `fulfilment:${fulfilmentId}`, entityType: "fulfilment", entityId: fulfilmentId, desired });
      }
      this.audit(actor, "integration.fulfilment_tracking_updated", "fulfilment", fulfilmentId, { connectionId, notifyCustomer: input.notifyCustomer });
    });
    await this.armAlarm(0);
    return Response.json({ ok: true });
  }

  private async observeReturn(request: Request) {
    const input = returnObservationSchema.parse(await request.json());
    const connection = this.connection(input.connectionId);
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    if (connection.provider !== "shopify") return Response.json({ error: "Return observation provider mismatch" }, { status: 409 });
    const payload = parseJson<Record<string, unknown>>(input.payloadJson) || {};
    const externalReturnId = shopifyReturnIdentity(input.topic, payload);
    const order = payload.order && typeof payload.order === "object" && !Array.isArray(payload.order) ? payload.order as Record<string, unknown> : null;
    const externalOrderId = shopifyOrderGid(payload.order_id) || shopifyOrderGid(order?.admin_graphql_api_id) || shopifyOrderGid(order?.id);
    const state = externalOrderId ? this.one<{ local_order_id: string | null }>(
      "SELECT local_order_id FROM integration_order_state WHERE connection_id = ? AND external_order_id = ?",
      input.connectionId, externalOrderId,
    ) : null;
    const timestamp = now();
    const refundObserved = input.topic === "refunds/create" ? 1 : 0;
    const providerStatus = typeof payload.status === "string" ? payload.status : input.topic.split("/")[1] || null;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_return_cases (
           id, connection_id, external_return_id, external_order_id, local_order_id,
           refund_observed, provider_status, disposition, payload_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(connection_id, external_return_id) DO UPDATE SET
           external_order_id = COALESCE(excluded.external_order_id, integration_return_cases.external_order_id),
           local_order_id = COALESCE(excluded.local_order_id, integration_return_cases.local_order_id),
           refund_observed = MAX(integration_return_cases.refund_observed, excluded.refund_observed),
           provider_status = COALESCE(excluded.provider_status, integration_return_cases.provider_status),
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        crypto.randomUUID(), input.connectionId, externalReturnId, externalOrderId, state?.local_order_id || null,
        refundObserved, providerStatus, input.payloadJson, timestamp, timestamp,
      );
      this.audit({ id: `integration:shopify:${connection.external_account_id}`, role: "integration", name: "Shopify" },
        "integration.return_observed", "integration_return", externalReturnId,
        { topic: input.topic, refundObserved: !!refundObserved, externalOrderId, automaticRestock: false });
    });
    return Response.json({ ok: true, externalReturnId, localOrderId: state?.local_order_id || null });
  }

  private async setDisposition(connectionId: string, caseId: string, request: Request) {
    const input = dispositionSchema.parse(await request.json());
    const row = this.one<ReturnCaseRow>("SELECT * FROM integration_return_cases WHERE id = ? AND connection_id = ?", caseId, connectionId);
    if (!row) return Response.json({ error: "Return case not found" }, { status: 404 });
    if (row.disposition !== "pending") return Response.json({ error: "Return case already has a final disposition" }, { status: 409 });
    const actor = actorFrom(request);
    const timestamp = now();

    if (input.disposition === "restock") {
      if (!row.local_order_id) return Response.json({ error: "This Shopify return is not linked to a canonical order" }, { status: 409 });
      if (!input.lines?.length) return Response.json({ error: "Explicit canonical line quantities are required before a return can be restocked" }, { status: 400 });
      const headers = new Headers({
        "Content-Type": "application/json",
        "x-ordermate-actor-id": actor.id,
        "x-ordermate-actor-role": actor.role,
        "x-ordermate-actor-name": actor.name,
      });
      const response = await this.canonicalFetch(new Request(`https://tenant.internal/orders/${encodeURIComponent(row.local_order_id)}/return`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          notes: input.notes || `Shopify RMA ${row.external_return_id}`,
          lines: input.lines.map(line => ({ lineId: line.lineId, quantity: line.quantity, restock: true })),
        }),
      }));
      if (!response.ok) {
        const payload = await response.json<{ error?: string }>().catch((): { error?: string } => ({}));
        return Response.json({ error: payload.error || "Canonical return rejected the requested restock" }, { status: response.status });
      }
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE integration_return_cases SET disposition = ?, restocked_at = ?, updated_at = ? WHERE id = ?`,
        input.disposition, input.disposition === "restock" ? timestamp : null, timestamp, caseId,
      );
      this.audit(actor, "integration.return_disposition_set", "integration_return", caseId, {
        connectionId,
        disposition: input.disposition,
        refundObserved: !!row.refund_observed,
        restockPerformed: input.disposition === "restock",
      });
    });
    if (input.disposition === "restock") {
      this.enqueueInventorySweep(actor, connectionId, "return_restock");
      await this.armAlarm(250);
    }
    return Response.json({ ok: true, case: returnCase(this.one<ReturnCaseRow>("SELECT * FROM integration_return_cases WHERE id = ?", caseId)!) });
  }
}
