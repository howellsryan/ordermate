import { z } from "zod";
import { buildFlowActions, type FlowPlanAttentionItem } from "../shared/flow-plan";
import type { OperatingIntelligenceResponse } from "../shared/operating-intelligence";
import type {
  WorkQueueHistoryEvent,
  WorkQueueItem,
  WorkQueueResponse,
  WorkQueueSignal,
  WorkQueueStatus,
} from "../shared/work-queue";
import { migrateWorkQueueSchema } from "./work-queue-schema";

type SourceFetch = (request: Request) => Promise<Response>;

type Actor = { id: string; role: string; name: string };
type OrderRow = {
  id: string;
  number: string;
  customer_name?: string | null;
  location_name: string;
  status: string;
  fulfilment_status: string;
  priority: "low" | "normal" | "high" | "urgent";
  required_by_date?: string | null;
  line_count: number;
  created_at: string;
};
type PurchaseOrderRow = {
  id: string;
  number: string;
  supplier_name: string;
  location_name: string;
  status: string;
  line_count: number;
  expected_delivery_date?: string | null;
};
type DeliveryDiscrepancyRow = {
  id: string;
  purchase_order_number: string;
  supplier_name: string;
  location_name: string;
  issue_count: number;
};
type IntegrationExceptionRow = {
  id: string;
  connection_id: string;
  code: string;
  message: string;
  retryable: number;
  entity_type: string | null;
  external_id: string | null;
  provider: string;
  display_name: string;
};
type WorkItemRow = {
  id: string;
  source: WorkQueueSignal["source"];
  fingerprint: string;
  category: WorkQueueSignal["category"];
  severity: WorkQueueSignal["severity"];
  title: string;
  detail: string;
  next_action: string;
  page: WorkQueueSignal["page"];
  score: number;
  evidence_json: string;
  entity_type: string | null;
  entity_id: string | null;
  status: WorkQueueStatus;
  active_signal: number;
  assignee_id: string | null;
  assignee_name: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  snoozed_until: string | null;
  resolution_reason: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  updated_at: string;
};
type HistoryRow = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  metadata_json: string;
  created_at: string;
};

const snoozeSchema = z.object({ until: z.string().datetime() });
const reasonSchema = z.object({ reason: z.string().trim().min(2).max(500) });
const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WORK_SIGNALS_PER_SOURCE = 500;

function now() {
  return new Date().toISOString();
}

function actorFrom(request: Request): Actor | null {
  const id = request.headers.get("x-ordermate-actor-id")?.trim() || "";
  const role = request.headers.get("x-ordermate-actor-role")?.trim() || "";
  if (!id || !role) return null;
  return { id, role, name: request.headers.get("x-ordermate-actor-name")?.trim() || id };
}

function systemActor(): Actor {
  return { id: "operations-work-queue", role: "system", name: "Operating Layer" };
}

function parseEvidence(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function workItem(row: WorkItemRow): WorkQueueItem {
  return {
    id: row.id,
    source: row.source,
    fingerprint: row.fingerprint,
    category: row.category,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    nextAction: row.next_action,
    page: row.page,
    score: row.score,
    evidence: parseEvidence(row.evidence_json),
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    activeSignal: row.active_signal === 1,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    snoozedUntil: row.snoozed_until,
    resolutionReason: row.resolution_reason,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    clearedAt: row.cleared_at,
    updatedAt: row.updated_at,
  };
}

function signalSnapshot(signal: WorkQueueSignal) {
  return {
    category: signal.category,
    severity: signal.severity,
    title: signal.title,
    detail: signal.detail,
    next_action: signal.nextAction,
    page: signal.page,
    score: signal.score,
    evidence_json: JSON.stringify(signal.evidence),
    entity_type: signal.entityType || null,
    entity_id: signal.entityId || null,
  };
}

function signalChanged(row: WorkItemRow, signal: WorkQueueSignal) {
  const next = signalSnapshot(signal);
  return row.category !== next.category
    || row.severity !== next.severity
    || row.title !== next.title
    || row.detail !== next.detail
    || row.next_action !== next.next_action
    || row.page !== next.page
    || row.score !== next.score
    || row.evidence_json !== next.evidence_json
    || row.entity_type !== next.entity_type
    || row.entity_id !== next.entity_id;
}

function flowEntity(fingerprint: string): Pick<WorkQueueSignal, "entityType" | "entityId"> {
  const order = fingerprint.match(/^flow:order:(.+)$/);
  if (order) return { entityType: "order", entityId: order[1] };
  const po = fingerprint.match(/^flow:po:(.+)$/);
  if (po) return { entityType: "purchase_order", entityId: po[1] };
  const discrepancy = fingerprint.match(/^flow:delivery-discrepancy:(.+)$/);
  if (discrepancy) return { entityType: "delivery_discrepancy", entityId: discrepancy[1] };
  return { entityType: null, entityId: null };
}

function integrationSeverity(code: string): "critical" | "warning" {
  return new Set([
    "canonical_order_rejected",
    "canonical_cancel_rejected",
    "order_version_conflict",
    "provider_error",
    "invalid_payload",
  ]).has(code) ? "critical" : "warning";
}

function integrationNextAction(code: string) {
  if (code === "unmapped_variant" || code === "unmapped_location") return "Review the approved Shopify mappings in Settings";
  if (code === "insufficient_stock") return "Review available stock and the mapped fulfilment location";
  if (code === "multiple_fulfilment_locations") return "Review the Shopify fulfilment routing before importing this order";
  return "Review the Shopify integration exception in Settings";
}

export class WorkQueueRuntime {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly sourceFetch: SourceFetch,
  ) {
    migrateWorkQueueSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!path.startsWith("/work-queue")) return null;

    const actor = actorFrom(request);
    if (!actor) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    try {
      if (request.method === "POST" && path === "/work-queue/refresh") return await this.refresh(actor);
      if (request.method === "GET" && path === "/work-queue") return this.list(actor);

      const history = path.match(/^\/work-queue\/([^/]+)\/history$/);
      if (request.method === "GET" && history) return this.history(decodeURIComponent(history[1]));

      const action = path.match(/^\/work-queue\/([^/]+)\/(acknowledge|snooze|assign-to-me|unassign|resolve|dismiss)$/);
      if (request.method === "POST" && action) {
        return await this.mutate(decodeURIComponent(action[1]), action[2], request, actor);
      }
      return Response.json({ error: "Work queue route not found" }, { status: 404 });
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid work queue action" }, { status: 400 });
      return Response.json({ error: cause instanceof Error ? cause.message : "Unable to update the work queue" }, { status: 500 });
    }
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private async read<T>(path: string, actor: Actor, disabledFallback: T): Promise<T> {
    const headers = new Headers({
      "x-ordermate-actor-id": actor.id,
      "x-ordermate-actor-role": actor.role,
      "x-ordermate-actor-name": actor.name,
    });
    const response = await this.sourceFetch(new Request(`https://tenant.internal${path}`, { headers }));
    if (response.status === 404) return disabledFallback;
    if (!response.ok) {
      const payload = await response.json<{ error?: string }>().catch((): { error?: string } => ({}));
      throw new Error(payload.error || `Unable to refresh operational signal source ${path}`);
    }
    return response.json<T>();
  }

  private async flowSignals(actor: Actor): Promise<WorkQueueSignal[]> {
    const [orders, purchaseOrders, discrepancies, replenishment] = await Promise.all([
      this.read<OrderRow[]>("/orders", actor, []),
      this.read<PurchaseOrderRow[]>("/purchase-orders", actor, []),
      this.read<DeliveryDiscrepancyRow[]>("/delivery-discrepancies?status=open", actor, []),
      this.read<Pick<OperatingIntelligenceResponse, "suggestions">>("/replenishment", actor, { suggestions: [] }),
    ]);

    const attention: FlowPlanAttentionItem[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const order of orders) {
      if (order.status !== "confirmed") continue;
      const overdue = !!order.required_by_date && order.required_by_date < today;
      const urgent = order.priority === "urgent";
      if (!overdue && !urgent) continue;
      attention.push({
        id: `order:${order.id}`,
        severity: overdue ? "critical" : "warning",
        type: overdue ? "Required-by overdue" : "Urgent fulfilment",
        title: order.number,
        detail: `${order.customer_name || "Guest"} · ${order.location_name} · ${order.line_count} line${order.line_count === 1 ? "" : "s"} · ${order.priority} priority${order.required_by_date ? ` · required ${order.required_by_date}` : ""}`,
        page: "orders",
      });
    }
    for (const po of purchaseOrders) {
      if (po.status !== "partially_received" && po.status !== "ordered") continue;
      const overdue = !!po.expected_delivery_date && po.expected_delivery_date < today;
      if (!overdue && po.status !== "partially_received") continue;
      attention.push({
        id: `po:${po.id}`,
        severity: overdue ? "critical" : "warning",
        type: overdue ? "Overdue purchase order" : "Partial receipt",
        title: po.number,
        detail: `${po.supplier_name} · ${po.location_name} · ${po.line_count} line${po.line_count === 1 ? "" : "s"}${po.expected_delivery_date ? ` · expected ${po.expected_delivery_date}` : " · expected date not set"}`,
        page: "purchasing",
      });
    }
    for (const discrepancy of discrepancies) {
      attention.push({
        id: `delivery-discrepancy:${discrepancy.id}`,
        severity: "warning",
        type: "Open delivery discrepancy",
        title: discrepancy.purchase_order_number,
        detail: `${discrepancy.supplier_name} · ${discrepancy.issue_count} issue${discrepancy.issue_count === 1 ? "" : "s"} · ${discrepancy.location_name}`,
        page: "purchasing",
      });
    }

    return buildFlowActions(attention, replenishment).map(action => ({
      source: "flow_plan" as const,
      fingerprint: action.id,
      category: action.category,
      severity: action.severity,
      title: action.title,
      detail: action.detail,
      nextAction: action.nextAction,
      page: action.page,
      score: action.score,
      evidence: action.evidence,
      ...flowEntity(action.id),
    }));
  }

  private integrationSignals(): WorkQueueSignal[] {
    const rows = this.rows<IntegrationExceptionRow>(
      `SELECT e.id, e.connection_id, e.code, e.message, e.retryable, e.entity_type, e.external_id,
              c.provider, c.display_name
       FROM integration_exceptions e
       JOIN integration_connections c ON c.id = e.connection_id
       WHERE e.status = 'open' AND c.status != 'disconnected'
       ORDER BY e.created_at DESC`,
    );
    return rows.map(row => {
      const severity = integrationSeverity(row.code);
      return {
        source: "integration_exception" as const,
        fingerprint: `${row.connection_id}:${row.code}:${row.entity_type || "order"}:${row.external_id || row.id}`,
        category: "integration_exception" as const,
        severity,
        title: `${row.display_name || row.provider} needs attention`,
        detail: row.message,
        nextAction: integrationNextAction(row.code),
        page: "settings" as const,
        score: severity === "critical" ? 118 : 86,
        evidence: [
          `${row.provider} integration exception`,
          `Exception code ${row.code}`,
          row.retryable ? "Condition can be retried after correction" : "Automatic retry is intentionally disabled",
        ],
        entityType: row.entity_type || "integration_exception",
        entityId: row.external_id || row.id,
      };
    });
  }

  private lifecycle(itemId: string, eventType: string, actor: Actor, metadata: Record<string, unknown>, timestamp: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO work_item_events (id, work_item_id, event_type, actor_id, actor_name, actor_role, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), itemId, eventType, actor.id, actor.name, actor.role, JSON.stringify(metadata), timestamp,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'work_item', ?, ?, ?)`,
      crypto.randomUUID(), actor.id, actor.role, `work_queue.${eventType}`, itemId, JSON.stringify(metadata), timestamp,
    );
  }

  private syncSource(source: WorkQueueSignal["source"], signals: WorkQueueSignal[]) {
    if (signals.length > MAX_WORK_SIGNALS_PER_SOURCE) throw new Error(`Work queue source ${source} exceeded ${MAX_WORK_SIGNALS_PER_SOURCE} active signals`);
    const timestamp = now();
    const system = systemActor();
    const existing = this.rows<WorkItemRow>("SELECT * FROM work_items WHERE source = ?", source);
    const byFingerprint = new Map(existing.map(item => [item.fingerprint, item] as const));
    const activeFingerprints = new Set(signals.map(signal => signal.fingerprint));

    this.ctx.storage.transactionSync(() => {
      for (const signal of signals) {
        const current = byFingerprint.get(signal.fingerprint);
        const snapshot = signalSnapshot(signal);
        if (!current) {
          const id = crypto.randomUUID();
          this.ctx.storage.sql.exec(
            `INSERT INTO work_items (
               id, source, fingerprint, category, severity, title, detail, next_action, page, score,
               evidence_json, entity_type, entity_id, status, active_signal, first_seen_at, last_seen_at,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?, ?)`,
            id, source, signal.fingerprint, snapshot.category, snapshot.severity, snapshot.title, snapshot.detail,
            snapshot.next_action, snapshot.page, snapshot.score, snapshot.evidence_json, snapshot.entity_type,
            snapshot.entity_id, timestamp, timestamp, timestamp, timestamp,
          );
          this.lifecycle(id, "created", system, { source, fingerprint: signal.fingerprint, severity: signal.severity }, timestamp);
          continue;
        }

        if (current.active_signal === 0) {
          this.ctx.storage.sql.exec(
            `UPDATE work_items SET
               category = ?, severity = ?, title = ?, detail = ?, next_action = ?, page = ?, score = ?,
               evidence_json = ?, entity_type = ?, entity_id = ?, status = 'open', active_signal = 1,
               acknowledged_at = NULL, acknowledged_by = NULL, snoozed_until = NULL,
               resolution_reason = NULL, resolved_at = NULL, resolved_by = NULL,
               last_seen_at = ?, cleared_at = NULL, updated_at = ?
             WHERE id = ?`,
            snapshot.category, snapshot.severity, snapshot.title, snapshot.detail, snapshot.next_action, snapshot.page,
            snapshot.score, snapshot.evidence_json, snapshot.entity_type, snapshot.entity_id, timestamp, timestamp, current.id,
          );
          this.lifecycle(current.id, "reopened", system, { source, fingerprint: signal.fingerprint, severity: signal.severity }, timestamp);
          continue;
        }

        if (signalChanged(current, signal)) {
          this.ctx.storage.sql.exec(
            `UPDATE work_items SET category = ?, severity = ?, title = ?, detail = ?, next_action = ?, page = ?, score = ?,
               evidence_json = ?, entity_type = ?, entity_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`,
            snapshot.category, snapshot.severity, snapshot.title, snapshot.detail, snapshot.next_action, snapshot.page,
            snapshot.score, snapshot.evidence_json, snapshot.entity_type, snapshot.entity_id, timestamp, timestamp, current.id,
          );
          this.lifecycle(current.id, "signal_updated", system, { source, severity: signal.severity }, timestamp);
        }
      }

      for (const current of existing) {
        if (current.active_signal !== 1 || activeFingerprints.has(current.fingerprint)) continue;
        const automaticallyResolve = current.status === "open" || current.status === "acknowledged" || current.status === "snoozed";
        this.ctx.storage.sql.exec(
          `UPDATE work_items SET active_signal = 0, status = ?, snoozed_until = NULL,
             resolution_reason = ?, resolved_at = ?, resolved_by = ?, cleared_at = ?, updated_at = ? WHERE id = ?`,
          automaticallyResolve ? "resolved" : current.status,
          automaticallyResolve ? "Underlying condition cleared automatically" : current.resolution_reason,
          automaticallyResolve ? timestamp : current.resolved_at,
          automaticallyResolve ? system.id : current.resolved_by,
          timestamp,
          timestamp,
          current.id,
        );
        this.lifecycle(current.id, "condition_cleared", system, { source, previousStatus: current.status }, timestamp);
      }
    });
  }

  private wakeExpiredSnoozes() {
    const timestamp = now();
    const rows = this.rows<WorkItemRow>(
      "SELECT * FROM work_items WHERE active_signal = 1 AND status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?",
      timestamp,
    );
    if (!rows.length) return;
    const system = systemActor();
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        this.ctx.storage.sql.exec(
          "UPDATE work_items SET status = 'open', snoozed_until = NULL, updated_at = ? WHERE id = ?",
          timestamp,
          row.id,
        );
        this.lifecycle(row.id, "snooze_expired", system, {}, timestamp);
      }
    });
  }

  private async refresh(actor: Actor) {
    const flow = await this.flowSignals(actor);
    const integrations = this.integrationSignals();
    this.syncSource("flow_plan", flow);
    this.syncSource("integration_exception", integrations);
    this.wakeExpiredSnoozes();
    return this.list(actor);
  }

  private list(actor: Actor) {
    this.wakeExpiredSnoozes();
    const allActive = this.rows<WorkItemRow>("SELECT * FROM work_items WHERE active_signal = 1");
    const actionable = allActive
      .filter(item => item.status === "open" || item.status === "acknowledged")
      .sort((a, b) => {
        const rank = { critical: 0, warning: 1, info: 2 } as const;
        return rank[a.severity] - rank[b.severity] || b.score - a.score || a.first_seen_at.localeCompare(b.first_seen_at);
      });
    const response: WorkQueueResponse = {
      generatedAt: now(),
      checks: ["Customer promise dates", "Forecast stock risk", "Incoming supplier dates", "Receiving discrepancies", "Integration exceptions"],
      summary: {
        actionable: actionable.length,
        critical: actionable.filter(item => item.severity === "critical").length,
        acknowledged: actionable.filter(item => item.status === "acknowledged").length,
        snoozed: allActive.filter(item => item.status === "snoozed").length,
        assignedToMe: actionable.filter(item => item.assignee_id === actor.id).length,
      },
      items: actionable.slice(0, 20).map(workItem),
    };
    return Response.json(response);
  }

  private history(itemId: string) {
    if (!this.one<{ id: string }>("SELECT id FROM work_items WHERE id = ?", itemId)) {
      return Response.json({ error: "Work item not found" }, { status: 404 });
    }
    const events: WorkQueueHistoryEvent[] = this.rows<HistoryRow>(
      `SELECT id, event_type, actor_id, actor_name, actor_role, metadata_json, created_at
       FROM work_item_events WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 100`,
      itemId,
    ).map(row => ({
      id: row.id,
      type: row.event_type,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      metadata: parseMetadata(row.metadata_json),
      createdAt: row.created_at,
    }));
    return Response.json({ events });
  }

  private activeItem(itemId: string) {
    const item = this.one<WorkItemRow>("SELECT * FROM work_items WHERE id = ?", itemId);
    if (!item) return { error: Response.json({ error: "Work item not found" }, { status: 404 }) } as const;
    if (item.active_signal !== 1) return { error: Response.json({ error: "This work item is no longer active" }, { status: 409 }) } as const;
    return { item } as const;
  }

  private async mutate(itemId: string, action: string, request: Request, actor: Actor) {
    const active = this.activeItem(itemId);
    if ("error" in active) return active.error;
    const item = active.item;
    const timestamp = now();

    if (action === "assign-to-me") {
      if (item.assignee_id === actor.id && item.assignee_name === actor.name) return Response.json({ ok: true, item: workItem(item) });
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("UPDATE work_items SET assignee_id = ?, assignee_name = ?, updated_at = ? WHERE id = ?", actor.id, actor.name, timestamp, itemId);
        this.lifecycle(itemId, "assigned", actor, { assigneeId: actor.id, assigneeName: actor.name }, timestamp);
      });
      return this.itemResponse(itemId);
    }

    if (action === "unassign") {
      if (!item.assignee_id) return Response.json({ ok: true, item: workItem(item) });
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("UPDATE work_items SET assignee_id = NULL, assignee_name = NULL, updated_at = ? WHERE id = ?", timestamp, itemId);
        this.lifecycle(itemId, "unassigned", actor, { previousAssigneeId: item.assignee_id, previousAssigneeName: item.assignee_name }, timestamp);
      });
      return this.itemResponse(itemId);
    }

    if (item.status === "resolved" || item.status === "dismissed") {
      return Response.json({ error: "This work item is already closed while its signal remains active" }, { status: 409 });
    }

    if (action === "acknowledge") {
      if (item.status === "acknowledged") return Response.json({ ok: true, item: workItem(item) });
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE work_items SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, snoozed_until = NULL, updated_at = ? WHERE id = ?",
          timestamp, actor.id, timestamp, itemId,
        );
        this.lifecycle(itemId, "acknowledged", actor, {}, timestamp);
      });
      return this.itemResponse(itemId);
    }

    if (action === "snooze") {
      const input = snoozeSchema.parse(await request.json());
      const until = new Date(input.until).getTime();
      const current = Date.now();
      if (!Number.isFinite(until) || until <= current) return Response.json({ error: "Snooze time must be in the future" }, { status: 400 });
      if (until > current + MAX_SNOOZE_MS) return Response.json({ error: "Work items can be snoozed for at most 30 days" }, { status: 400 });
      const snoozedUntil = new Date(until).toISOString();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("UPDATE work_items SET status = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?", snoozedUntil, timestamp, itemId);
        this.lifecycle(itemId, "snoozed", actor, { until: snoozedUntil }, timestamp);
      });
      return this.itemResponse(itemId);
    }

    if (action === "resolve" || action === "dismiss") {
      const input = reasonSchema.parse(await request.json());
      const status: WorkQueueStatus = action === "resolve" ? "resolved" : "dismissed";
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE work_items SET status = ?, snoozed_until = NULL, resolution_reason = ?, resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?",
          status, input.reason, timestamp, actor.id, timestamp, itemId,
        );
        this.lifecycle(itemId, status, actor, { reason: input.reason }, timestamp);
      });
      return this.itemResponse(itemId);
    }

    return Response.json({ error: "Unsupported work queue action" }, { status: 404 });
  }

  private itemResponse(itemId: string) {
    const row = this.one<WorkItemRow>("SELECT * FROM work_items WHERE id = ?", itemId);
    if (!row) return Response.json({ error: "Work item not found" }, { status: 404 });
    return Response.json({ ok: true, item: workItem(row) });
  }
}
