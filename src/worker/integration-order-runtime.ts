import { z } from "zod";
import {
  canonicalIntegrationOrderJson,
  integrationOrderProposalSchema,
  type IntegrationOrderProposal,
  type MappedIntegrationOrder,
} from "../shared/integration-order-contract";
import { integrationInternalHeaders } from "./integration-runtime";
import { migrateIntegrationSchema } from "./integration-schema";

const processSchema = z.object({
  eventId: z.string().uuid(),
  proposal: integrationOrderProposalSchema,
});

const INTERNAL_ENTRIES = Object.entries(integrationInternalHeaders);

type CanonicalOrderFetch = (request: Request) => Promise<Response>;
type CanonicalOrderPayload = Record<string, unknown> & { error?: string; created?: boolean };
type EventRow = {
  id: string;
  connection_id: string;
  topic: string;
  status: "received" | "processing" | "applied" | "ignored" | "failed";
  attempts: number;
};
type ConnectionRow = { id: string; provider: string; status: string };
type StateRow = {
  connection_id: string;
  external_order_id: string;
  local_order_id: string | null;
  applied_external_updated_at: string | null;
  applied_proposal_json: string | null;
  observed_external_updated_at: string | null;
  observed_proposal_json: string | null;
  last_event_id: string | null;
  status: "pending" | "active" | "cancelled" | "blocked";
};
type LinkRow = { external_id: string; local_entity_type: string; local_entity_id: string };

type BlockInput = {
  eventId: string;
  connectionId: string;
  externalOrderId: string;
  localOrderId?: string | null;
  code: string;
  message: string;
  retryable?: boolean;
  deliveryRetry?: boolean;
  entityType?: string;
  externalId?: string;
};

function now() {
  return new Date().toISOString();
}

function internalRequest(request: Request) {
  return INTERNAL_ENTRIES.every(([key, value]) => request.headers.get(key) === value);
}

function internalHeaders() {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [key, value] of INTERNAL_ENTRIES) headers.set(key, value);
  headers.set("x-ordermate-actor-id", "integration-order-processor");
  headers.set("x-ordermate-actor-role", "integration");
  return headers;
}

function parseTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Turns provider-neutral order proposals into reviewed canonical mutations.
 * The runtime owns idempotency/mappings/exceptions; the canonical order service
 * remains the only component allowed to write Orders and reservations.
 */
export class IntegrationOrderRuntime {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly canonicalOrderFetch: CanonicalOrderFetch,
  ) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    const publicExceptions = path.match(/^\/integrations\/([^/]+)\/exceptions$/);
    if (request.method === "GET" && publicExceptions) {
      return this.listExceptions(decodeURIComponent(publicExceptions[1]));
    }

    if (path !== "/__integrations/orders/process") return null;
    if (!internalRequest(request)) return Response.json({ error: "Internal integration order route" }, { status: 404 });
    if (request.method !== "POST") return Response.json({ error: "Internal integration order route not found" }, { status: 404 });
    return this.process(request);
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private state(connectionId: string, externalOrderId: string) {
    return this.one<StateRow>(
      `SELECT connection_id, external_order_id, local_order_id,
              applied_external_updated_at, applied_proposal_json,
              observed_external_updated_at, observed_proposal_json,
              last_event_id, status
       FROM integration_order_state WHERE connection_id = ? AND external_order_id = ?`,
      connectionId,
      externalOrderId,
    ) || null;
  }

  private listExceptions(connectionId: string) {
    if (!this.one<{ id: string }>("SELECT id FROM integration_connections WHERE id = ?", connectionId)) {
      return Response.json({ error: "Integration connection not found" }, { status: 404 });
    }
    const exceptions = this.rows<{
      id: string;
      event_id: string | null;
      code: string;
      message: string;
      retryable: number;
      status: string;
      entity_type: string | null;
      external_id: string | null;
      created_at: string;
      resolved_at: string | null;
      resolved_by: string | null;
    }>(
      `SELECT id, event_id, code, message, retryable, status, entity_type, external_id,
              created_at, resolved_at, resolved_by
       FROM integration_exceptions WHERE connection_id = ?
       ORDER BY status = 'open' DESC, created_at DESC LIMIT 250`,
      connectionId,
    ).map(row => ({
      id: row.id,
      eventId: row.event_id,
      code: row.code,
      message: row.message,
      retryable: !!row.retryable,
      status: row.status,
      entityType: row.entity_type,
      externalId: row.external_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
    }));
    return Response.json({ exceptions });
  }

  private beginEvent(eventId: string) {
    this.ctx.storage.sql.exec(
      `UPDATE integration_events
       SET status = 'processing', attempts = attempts + 1, error = NULL, processed_at = NULL
       WHERE id = ?`,
      eventId,
    );
  }

  private completeEvent(eventId: string, status: "applied" | "ignored", error: string | null = null) {
    const timestamp = now();
    this.ctx.storage.sql.exec(
      "UPDATE integration_events SET status = ?, processed_at = ?, error = ? WHERE id = ?",
      status,
      timestamp,
      error,
      eventId,
    );
  }

  private deterministicExceptionId(input: BlockInput) {
    return `${input.eventId}:${input.code}:${input.entityType || "order"}:${input.externalId || input.externalOrderId}`;
  }

  private block(input: BlockInput) {
    const timestamp = now();
    const exceptionId = this.deterministicExceptionId(input);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_exceptions (
           id, connection_id, event_id, code, message, retryable, status,
           entity_type, external_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           message = excluded.message, retryable = excluded.retryable, status = 'open',
           resolved_at = NULL, resolved_by = NULL`,
        exceptionId,
        input.connectionId,
        input.eventId,
        input.code,
        input.message,
        input.retryable === false ? 0 : 1,
        input.entityType || "order",
        input.externalId || input.externalOrderId,
        timestamp,
      );
      this.ctx.storage.sql.exec(
        "UPDATE integration_events SET status = 'failed', processed_at = ?, error = ? WHERE id = ?",
        timestamp,
        input.message,
        input.eventId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_order_state (
           connection_id, external_order_id, local_order_id, last_event_id, status, updated_at
         ) VALUES (?, ?, ?, ?, 'blocked', ?)
         ON CONFLICT(connection_id, external_order_id) DO UPDATE SET
           local_order_id = COALESCE(integration_order_state.local_order_id, excluded.local_order_id),
           last_event_id = excluded.last_event_id, status = 'blocked', updated_at = excluded.updated_at`,
        input.connectionId,
        input.externalOrderId,
        input.localOrderId || null,
        input.eventId,
        timestamp,
      );
    });
    return Response.json({
      outcome: "blocked",
      retryDelivery: input.deliveryRetry ?? false,
      eventId: input.eventId,
      exceptionId,
      error: input.message,
    });
  }

  private observeProposal(eventId: string, proposal: IntegrationOrderProposal, proposalJson: string, existing: StateRow | null) {
    const timestamp = now();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_order_state (
         connection_id, external_order_id, local_order_id,
         observed_external_updated_at, observed_proposal_json,
         last_event_id, status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(connection_id, external_order_id) DO UPDATE SET
         observed_external_updated_at = excluded.observed_external_updated_at,
         observed_proposal_json = excluded.observed_proposal_json,
         last_event_id = excluded.last_event_id,
         updated_at = excluded.updated_at`,
      proposal.connectionId,
      proposal.externalOrderId,
      existing?.local_order_id || null,
      proposal.externalUpdatedAt,
      proposalJson,
      eventId,
      timestamp,
    );
  }

  private resolveOrderExceptions(connectionId: string, proposal: IntegrationOrderProposal) {
    const timestamp = now();
    const externalIds = new Set<string>([
      proposal.externalOrderId,
      ...(proposal.locationExternalId ? [proposal.locationExternalId] : []),
      ...proposal.locationExternalIds,
      ...proposal.lines.map(line => line.externalVariantId),
    ]);
    for (const externalId of externalIds) {
      this.ctx.storage.sql.exec(
        `UPDATE integration_exceptions
         SET status = 'resolved', resolved_at = ?, resolved_by = 'integration-order-processor'
         WHERE connection_id = ? AND status = 'open' AND external_id = ?`,
        timestamp,
        connectionId,
        externalId,
      );
    }
  }

  private variantLinks(connectionId: string) {
    return new Map(this.rows<LinkRow>(
      `SELECT external_id, local_entity_type, local_entity_id
       FROM integration_entity_links WHERE connection_id = ? AND entity_type = 'variant'`,
      connectionId,
    ).map(link => [link.external_id, link] as const));
  }

  private locationLink(connectionId: string, externalId: string) {
    return this.one<LinkRow>(
      `SELECT external_id, local_entity_type, local_entity_id
       FROM integration_entity_links
       WHERE connection_id = ? AND entity_type = 'location' AND external_id = ?`,
      connectionId,
      externalId,
    ) || null;
  }

  private mapActiveProposal(eventId: string, proposal: IntegrationOrderProposal, localOrderId: string | null): MappedIntegrationOrder | Response {
    const routedLocations = proposal.locationExternalIds.length
      ? Array.from(new Set(proposal.locationExternalIds))
      : proposal.locationExternalId ? [proposal.locationExternalId] : [];
    if (routedLocations.length > 1) {
      return this.block({
        eventId,
        connectionId: proposal.connectionId,
        externalOrderId: proposal.externalOrderId,
        localOrderId,
        code: "multiple_fulfilment_locations",
        message: "Shopify order is split across multiple fulfilment locations; Operating Layer currently requires one location per order",
        retryable: false,
      });
    }
    const externalLocationId = proposal.locationExternalId || routedLocations[0] || null;
    if (!externalLocationId) {
      return this.block({ eventId, connectionId: proposal.connectionId, externalOrderId: proposal.externalOrderId, localOrderId, code: "missing_fulfilment_location", message: "Shopify order does not currently resolve to one fulfilment location" });
    }
    const location = this.locationLink(proposal.connectionId, externalLocationId);
    if (!location || location.local_entity_type !== "location") {
      return this.block({
        eventId,
        connectionId: proposal.connectionId,
        externalOrderId: proposal.externalOrderId,
        localOrderId,
        code: "unmapped_location",
        message: `Shopify fulfilment location ${externalLocationId} is not approved against an Operating Layer location`,
        entityType: "location",
        externalId: externalLocationId,
      });
    }

    const variants = this.variantLinks(proposal.connectionId);
    const mappedLines = [] as MappedIntegrationOrder["lines"];
    for (const line of proposal.lines) {
      const link = variants.get(line.externalVariantId);
      if (!link || link.local_entity_type !== "product_variant") {
        return this.block({
          eventId,
          connectionId: proposal.connectionId,
          externalOrderId: proposal.externalOrderId,
          localOrderId,
          code: "unmapped_variant",
          message: `Shopify variant ${line.externalVariantId} on ${proposal.externalOrderName} is not approved against an Operating Layer variant`,
          entityType: "variant",
          externalId: line.externalVariantId,
        });
      }
      mappedLines.push({ ...line, variantId: link.local_entity_id });
    }
    return {
      ...proposal,
      locationExternalId: externalLocationId,
      locationId: location.local_entity_id,
      lines: mappedLines,
    };
  }

  private reserveLocalOrderId(eventId: string, proposal: IntegrationOrderProposal, existing: StateRow | null) {
    if (existing?.local_order_id) return existing.local_order_id;
    const localOrderId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO integration_order_state (
         connection_id, external_order_id, local_order_id, last_event_id, status, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(connection_id, external_order_id) DO UPDATE SET
         local_order_id = COALESCE(integration_order_state.local_order_id, excluded.local_order_id),
         last_event_id = excluded.last_event_id, status = 'pending', updated_at = excluded.updated_at`,
      proposal.connectionId,
      proposal.externalOrderId,
      localOrderId,
      eventId,
      now(),
    );
    return this.state(proposal.connectionId, proposal.externalOrderId)?.local_order_id || localOrderId;
  }

  private async canonical(path: string, body?: unknown) {
    const response = await this.canonicalOrderFetch(new Request(`https://tenant.internal${path}`, {
      method: "POST",
      headers: internalHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const payload = await response.json<CanonicalOrderPayload>().catch((): CanonicalOrderPayload => ({}));
    return { response, payload };
  }

  private async process(request: Request) {
    let input: z.infer<typeof processSchema>;
    try {
      input = processSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid integration order proposal" }, { status: 400 });
      throw cause;
    }

    const event = this.one<EventRow>(
      "SELECT id, connection_id, topic, status, attempts FROM integration_events WHERE id = ?",
      input.eventId,
    );
    if (!event) return Response.json({ error: "Integration event not found" }, { status: 404 });
    if (event.connection_id !== input.proposal.connectionId) return Response.json({ error: "Order proposal does not match its event connection" }, { status: 409 });
    if (event.status === "applied" || event.status === "ignored") {
      return Response.json({ outcome: event.status, retryDelivery: false, duplicate: true, eventId: event.id });
    }

    const connection = this.one<ConnectionRow>(
      "SELECT id, provider, status FROM integration_connections WHERE id = ?",
      input.proposal.connectionId,
    );
    if (!connection) return Response.json({ error: "Integration connection not found" }, { status: 404 });
    if (connection.provider !== input.proposal.provider) return Response.json({ error: "Order proposal provider does not match its connection" }, { status: 409 });
    if (connection.status !== "active") return Response.json({ error: "Integration connection is not active" }, { status: 409 });

    this.beginEvent(event.id);
    const proposal = input.proposal;
    const proposalJson = canonicalIntegrationOrderJson(proposal);
    const existing = this.state(proposal.connectionId, proposal.externalOrderId);
    const appliedAt = parseTimestamp(existing?.applied_external_updated_at || null);
    const observedAt = parseTimestamp(existing?.observed_external_updated_at || existing?.applied_external_updated_at || null);
    const proposedAt = parseTimestamp(proposal.externalUpdatedAt);
    if (proposedAt === null) return Response.json({ error: "Integration order version is invalid" }, { status: 400 });

    if (observedAt !== null && proposedAt < observedAt) {
      this.completeEvent(event.id, "ignored", "Older external order version than the latest observed Shopify state");
      return Response.json({ outcome: "ignored", reason: "out_of_order", retryDelivery: false, eventId: event.id });
    }
    if (observedAt !== null && proposedAt === observedAt) {
      const observedJson = existing?.observed_proposal_json || existing?.applied_proposal_json;
      if (observedJson && observedJson !== proposalJson) {
        return this.block({
          eventId: event.id,
          connectionId: proposal.connectionId,
          externalOrderId: proposal.externalOrderId,
          localOrderId: existing?.local_order_id,
          code: "order_version_conflict",
          message: "Two different Shopify order states have the same external update timestamp; automatic ordering is unsafe",
          retryable: false,
        });
      }
      if (appliedAt === proposedAt && existing?.applied_proposal_json === proposalJson && (existing.status === "active" || existing.status === "cancelled")) {
        this.completeEvent(event.id, "ignored", "External order version already applied");
        return Response.json({ outcome: "ignored", reason: "already_applied", retryDelivery: false, eventId: event.id });
      }
    }

    this.observeProposal(event.id, proposal, proposalJson, existing);

    if (proposal.block) {
      return this.block({
        eventId: event.id,
        connectionId: proposal.connectionId,
        externalOrderId: proposal.externalOrderId,
        localOrderId: existing?.local_order_id,
        code: proposal.block.code,
        message: proposal.block.message,
        retryable: proposal.block.retryable,
        deliveryRetry: proposal.block.retryDelivery,
      });
    }

    if (proposal.state === "cancelled") {
      if (existing?.local_order_id) {
        const { response, payload } = await this.canonical(`/__orders/${encodeURIComponent(existing.local_order_id)}/cancel-external`);
        if (!response.ok) {
          const message = payload.error || "Canonical order cancellation was rejected";
          if (response.status >= 500) {
            this.ctx.storage.sql.exec("UPDATE integration_events SET status = 'failed', processed_at = ?, error = ? WHERE id = ?", now(), message, event.id);
            return Response.json({ error: message, retryDelivery: true }, { status: 503 });
          }
          return this.block({ eventId: event.id, connectionId: proposal.connectionId, externalOrderId: proposal.externalOrderId, localOrderId: existing.local_order_id, code: "canonical_cancel_rejected", message });
        }
      }
      const timestamp = now();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          `INSERT INTO integration_order_state (
             connection_id, external_order_id, local_order_id,
             applied_external_updated_at, applied_proposal_json,
             observed_external_updated_at, observed_proposal_json,
             last_event_id, status, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cancelled', ?)
           ON CONFLICT(connection_id, external_order_id) DO UPDATE SET
             local_order_id = COALESCE(integration_order_state.local_order_id, excluded.local_order_id),
             applied_external_updated_at = excluded.applied_external_updated_at,
             applied_proposal_json = excluded.applied_proposal_json,
             observed_external_updated_at = excluded.observed_external_updated_at,
             observed_proposal_json = excluded.observed_proposal_json,
             last_event_id = excluded.last_event_id, status = 'cancelled', updated_at = excluded.updated_at`,
          proposal.connectionId,
          proposal.externalOrderId,
          existing?.local_order_id || null,
          proposal.externalUpdatedAt,
          proposalJson,
          proposal.externalUpdatedAt,
          proposalJson,
          event.id,
          timestamp,
        );
        this.completeEvent(event.id, "applied");
      });
      this.resolveOrderExceptions(proposal.connectionId, proposal);
      return Response.json({ outcome: "applied", action: existing?.local_order_id ? "cancelled" : "recorded_cancelled", retryDelivery: false, eventId: event.id });
    }

    const mapped = this.mapActiveProposal(event.id, proposal, existing?.local_order_id || null);
    if (mapped instanceof Response) return mapped;
    const localOrderId = this.reserveLocalOrderId(event.id, proposal, existing);
    const { response, payload } = await this.canonical("/__orders/import-external", {
      orderId: localOrderId,
      source: proposal.provider,
      externalReference: proposal.externalOrderName,
      locationId: mapped.locationId,
      currency: proposal.currency,
      subtotalMinor: proposal.subtotalMinor,
      taxMinor: proposal.taxMinor,
      totalMinor: proposal.totalMinor,
      nonMerchandiseMinor: proposal.nonMerchandiseMinor,
      lines: mapped.lines,
    });
    if (!response.ok) {
      const message = payload.error || "Canonical external order import was rejected";
      if (response.status >= 500) {
        this.ctx.storage.sql.exec("UPDATE integration_events SET status = 'failed', processed_at = ?, error = ? WHERE id = ?", now(), message, event.id);
        return Response.json({ error: message, retryDelivery: true }, { status: 503 });
      }
      return this.block({
        eventId: event.id,
        connectionId: proposal.connectionId,
        externalOrderId: proposal.externalOrderId,
        localOrderId,
        code: response.status === 409 && message.includes("Insufficient available stock") ? "insufficient_stock" : "canonical_order_rejected",
        message,
      });
    }

    const timestamp = now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO integration_entity_links (
           provider, connection_id, entity_type, external_id, local_entity_type, local_entity_id,
           external_updated_at, last_synced_at
         ) VALUES (?, ?, 'order', ?, 'order', ?, ?, ?)
         ON CONFLICT(provider, connection_id, entity_type, external_id) DO UPDATE SET
           local_entity_type = excluded.local_entity_type, local_entity_id = excluded.local_entity_id,
           external_updated_at = excluded.external_updated_at, last_synced_at = excluded.last_synced_at`,
        proposal.provider,
        proposal.connectionId,
        proposal.externalOrderId,
        localOrderId,
        proposal.externalUpdatedAt,
        timestamp,
      );
      this.ctx.storage.sql.exec(
        `UPDATE integration_order_state
         SET local_order_id = ?, applied_external_updated_at = ?, applied_proposal_json = ?,
             observed_external_updated_at = ?, observed_proposal_json = ?,
             last_event_id = ?, status = 'active', updated_at = ?
         WHERE connection_id = ? AND external_order_id = ?`,
        localOrderId,
        proposal.externalUpdatedAt,
        proposalJson,
        proposal.externalUpdatedAt,
        proposalJson,
        event.id,
        timestamp,
        proposal.connectionId,
        proposal.externalOrderId,
      );
      this.completeEvent(event.id, "applied");
    });
    this.resolveOrderExceptions(proposal.connectionId, proposal);
    return Response.json({ outcome: "applied", action: payload.created ? "created" : "updated", localOrderId, retryDelivery: false, eventId: event.id });
  }
}
