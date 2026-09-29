import { z } from "zod";
import {
  WORK_QUEUE_CATEGORIES,
  type FrontlineWorkQueueResponse,
  type WorkQueueCategory,
  type WorkQueueItem,
  type WorkQueueMetrics,
  type WorkQueueResolutionMetric,
  type WorkQueueStatus,
} from "../shared/work-queue";
import { migrateWorkQueueSchema } from "./work-queue-schema";

type Actor = { id: string; role: string; name: string };
type Row = {
  id: string;
  source: "flow_plan" | "integration_exception";
  fingerprint: string;
  category: WorkQueueCategory;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  next_action: string;
  page: WorkQueueItem["page"];
  score: number;
  evidence_json: string;
  entity_type: string | null;
  entity_id: string | null;
  status: WorkQueueStatus;
  active_signal: number;
  assignee_id: string | null;
  assignee_name: string | null;
  team_id: string | null;
  team_name: string | null;
  due_at: string | null;
  escalation_at: string | null;
  escalated_at: string | null;
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

type MetricRow = {
  category: WorkQueueCategory;
  status: WorkQueueStatus;
  first_seen_at: string;
  resolved_at: string | null;
};

const assignmentSchema = z.object({
  assigneeId: z.string().trim().min(1).max(255).nullable().optional(),
  assigneeName: z.string().trim().min(1).max(255).nullable().optional(),
  teamId: z.string().trim().min(1).max(120).nullable().optional(),
  teamName: z.string().trim().min(1).max(255).nullable().optional(),
}).superRefine((value, ctx) => {
  if (!!value.assigneeId !== !!value.assigneeName) ctx.addIssue({ code: "custom", message: "Assignee ID and name must be supplied together" });
  if (!!value.teamId !== !!value.teamName) ctx.addIssue({ code: "custom", message: "Team ID and name must be supplied together" });
});

const scheduleSchema = z.object({
  dueAt: z.string().datetime().nullable(),
  escalationAt: z.string().datetime().nullable(),
}).superRefine((value, ctx) => {
  if (value.dueAt && value.escalationAt && new Date(value.escalationAt).getTime() < new Date(value.dueAt).getTime()) {
    ctx.addIssue({ code: "custom", message: "Escalation cannot be earlier than the due date" });
  }
});

function now() {
  return new Date().toISOString();
}

function actorFrom(request: Request): Actor | null {
  const id = request.headers.get("x-ordermate-actor-id")?.trim() || "";
  const role = request.headers.get("x-ordermate-actor-role")?.trim() || "";
  if (!id || !role) return null;
  return { id, role, name: request.headers.get("x-ordermate-actor-name")?.trim() || id };
}

function parseEvidence(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function deepLink(row: Pick<Row, "page" | "entity_type" | "entity_id">) {
  const params = new URLSearchParams({ page: row.page });
  if (row.entity_type) params.set("entity", row.entity_type);
  if (row.entity_id) params.set("record", row.entity_id);
  return `/?${params.toString()}`;
}

function item(row: Row): WorkQueueItem {
  const timestamp = Date.now();
  const escalationAt = row.escalation_at ? new Date(row.escalation_at).getTime() : Number.NaN;
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
    teamId: row.team_id,
    teamName: row.team_name,
    dueAt: row.due_at,
    escalationAt: row.escalation_at,
    escalatedAt: row.escalated_at,
    escalated: !!row.escalated_at || Number.isFinite(escalationAt) && escalationAt <= timestamp,
    deepLink: deepLink(row),
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

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Math.round(sorted[index]! / 60_000);
}

export class WorkQueueCoordinationRuntime {
  constructor(private readonly ctx: DurableObjectState) {
    migrateWorkQueueSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!path.startsWith("/work-queue")) return null;
    const actor = actorFrom(request);
    if (!actor) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    try {
      if (request.method === "GET" && path === "/work-queue/frontline") return this.frontline(url, actor);
      if (request.method === "GET" && path === "/work-queue/metrics") return this.metrics(url);

      const assignment = path.match(/^\/work-queue\/([^/]+)\/assign$/);
      if (request.method === "POST" && assignment) return await this.assign(decodeURIComponent(assignment[1]), request, actor);

      const schedule = path.match(/^\/work-queue\/([^/]+)\/schedule$/);
      if (request.method === "POST" && schedule) return await this.schedule(decodeURIComponent(schedule[1]), request, actor);
      return null;
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid work queue request" }, { status: 400 });
      return Response.json({ error: cause instanceof Error ? cause.message : "Unable to update the work queue" }, { status: 500 });
    }
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray() as T[];
  }

  private lifecycle(itemId: string, eventType: string, actor: Actor, metadata: Record<string, unknown>, timestamp = now()) {
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

  private active(itemId: string) {
    const row = this.one<Row>("SELECT * FROM work_items WHERE id = ?", itemId);
    if (!row) return { error: Response.json({ error: "Work item not found" }, { status: 404 }) } as const;
    if (row.active_signal !== 1) return { error: Response.json({ error: "This work item is no longer active" }, { status: 409 }) } as const;
    if (row.status === "resolved" || row.status === "dismissed") return { error: Response.json({ error: "This work item is already closed" }, { status: 409 }) } as const;
    return { row } as const;
  }

  private markEscalations() {
    const timestamp = now();
    const due = this.rows<Row>(
      `SELECT * FROM work_items
       WHERE active_signal = 1 AND status IN ('open','acknowledged')
         AND escalation_at IS NOT NULL AND escalation_at <= ? AND escalated_at IS NULL`,
      timestamp,
    );
    if (!due.length) return;
    const actor: Actor = { id: "operations-work-queue", role: "system", name: "Operating Layer" };
    this.ctx.storage.transactionSync(() => {
      for (const row of due) {
        this.ctx.storage.sql.exec("UPDATE work_items SET escalated_at = ?, updated_at = ? WHERE id = ?", timestamp, timestamp, row.id);
        this.lifecycle(row.id, "escalated", actor, { escalationAt: row.escalation_at, dueAt: row.due_at }, timestamp);
      }
    });
  }

  private frontline(url: URL, actor: Actor) {
    this.markEscalations();
    const categoryValue = url.searchParams.get("category");
    const category = categoryValue && (WORK_QUEUE_CATEGORIES as readonly string[]).includes(categoryValue) ? categoryValue as WorkQueueCategory : null;
    if (categoryValue && !category) return Response.json({ error: "Unknown work queue category" }, { status: 400 });
    const teamId = url.searchParams.get("teamId")?.trim() || null;
    const assigneeId = url.searchParams.get("assigneeId")?.trim() || null;
    const mine = url.searchParams.get("mine") === "true";
    const bindings: unknown[] = [];
    const conditions = ["active_signal = 1", "status IN ('open','acknowledged')"];
    if (category) { conditions.push("category = ?"); bindings.push(category); }
    if (teamId) { conditions.push("team_id = ?"); bindings.push(teamId); }
    const effectiveAssignee = mine ? actor.id : assigneeId;
    if (effectiveAssignee) { conditions.push("assignee_id = ?"); bindings.push(effectiveAssignee); }
    const rows = this.rows<Row>(
      `SELECT * FROM work_items WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE WHEN escalated_at IS NOT NULL THEN 0 ELSE 1 END,
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
         due_at,
         score DESC,
         first_seen_at
       LIMIT 100`,
      ...bindings,
    );
    const items = rows.map(item);
    const allActive = this.rows<Row>("SELECT * FROM work_items WHERE active_signal = 1");
    const actionable = allActive.filter(row => row.status === "open" || row.status === "acknowledged");
    const timestamp = Date.now();
    const response: FrontlineWorkQueueResponse = {
      generatedAt: now(),
      filters: { category, teamId, assigneeId: effectiveAssignee },
      summary: {
        actionable: actionable.length,
        critical: actionable.filter(row => row.severity === "critical").length,
        acknowledged: actionable.filter(row => row.status === "acknowledged").length,
        snoozed: allActive.filter(row => row.status === "snoozed").length,
        assignedToMe: actionable.filter(row => row.assignee_id === actor.id).length,
        overdue: actionable.filter(row => row.due_at && new Date(row.due_at).getTime() < timestamp).length,
        escalated: actionable.filter(row => !!row.escalated_at || row.escalation_at && new Date(row.escalation_at).getTime() <= timestamp).length,
        unassigned: actionable.filter(row => !row.assignee_id && !row.team_id).length,
      },
      items,
    };
    return Response.json(response);
  }

  private metrics(url: URL) {
    const rawDays = Number(url.searchParams.get("days") || "30");
    const windowDays = Number.isInteger(rawDays) ? Math.min(365, Math.max(1, rawDays)) : 30;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.rows<MetricRow>(
      `SELECT category, status, first_seen_at, resolved_at FROM work_items
       WHERE first_seen_at >= ? OR (resolved_at IS NOT NULL AND resolved_at >= ?)`,
      since, since,
    );
    const detected = rows.filter(row => row.first_seen_at >= since).length;
    const closedRows = rows.filter(row => row.resolved_at && row.resolved_at >= since && (row.status === "resolved" || row.status === "dismissed"));
    const metric = (category: WorkQueueCategory | "all", values: MetricRow[]): WorkQueueResolutionMetric => {
      const durations = values
        .filter(row => row.resolved_at)
        .map(row => new Date(row.resolved_at!).getTime() - new Date(row.first_seen_at).getTime())
        .filter(value => Number.isFinite(value) && value >= 0);
      return {
        category,
        resolved: values.filter(row => row.status === "resolved").length,
        dismissed: values.filter(row => row.status === "dismissed").length,
        medianMinutes: percentile(durations, 0.5),
        p90Minutes: percentile(durations, 0.9),
      };
    };
    const openNow = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM work_items WHERE active_signal = 1 AND status IN ('open','acknowledged','snoozed')",
    )?.count ?? 0;
    const response: WorkQueueMetrics = {
      windowDays,
      detected,
      closed: closedRows.length,
      openNow,
      resolutionRate: detected ? Math.round(closedRows.length / detected * 1000) / 1000 : null,
      overall: metric("all", closedRows),
      byCategory: WORK_QUEUE_CATEGORIES.map(category => metric(category, closedRows.filter(row => row.category === category))),
    };
    return Response.json(response);
  }

  private async assign(itemId: string, request: Request, actor: Actor) {
    const active = this.active(itemId);
    if ("error" in active) return active.error;
    const input = assignmentSchema.parse(await request.json());
    const timestamp = now();
    const previous = active.row;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE work_items SET assignee_id = ?, assignee_name = ?, team_id = ?, team_name = ?, updated_at = ? WHERE id = ?`,
        input.assigneeId || null,
        input.assigneeName || null,
        input.teamId || null,
        input.teamName || null,
        timestamp,
        itemId,
      );
      this.lifecycle(itemId, "assignment_changed", actor, {
        previousAssigneeId: previous.assignee_id,
        previousAssigneeName: previous.assignee_name,
        previousTeamId: previous.team_id,
        previousTeamName: previous.team_name,
        assigneeId: input.assigneeId || null,
        assigneeName: input.assigneeName || null,
        teamId: input.teamId || null,
        teamName: input.teamName || null,
      }, timestamp);
    });
    const updated = this.one<Row>("SELECT * FROM work_items WHERE id = ?", itemId)!;
    return Response.json({ ok: true, item: item(updated) });
  }

  private async schedule(itemId: string, request: Request, actor: Actor) {
    const active = this.active(itemId);
    if ("error" in active) return active.error;
    const input = scheduleSchema.parse(await request.json());
    const timestamp = now();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE work_items SET due_at = ?, escalation_at = ?, escalated_at = NULL, updated_at = ? WHERE id = ?`,
        input.dueAt,
        input.escalationAt,
        timestamp,
        itemId,
      );
      this.lifecycle(itemId, "sla_scheduled", actor, {
        previousDueAt: active.row.due_at,
        previousEscalationAt: active.row.escalation_at,
        dueAt: input.dueAt,
        escalationAt: input.escalationAt,
      }, timestamp);
    });
    const updated = this.one<Row>("SELECT * FROM work_items WHERE id = ?", itemId)!;
    return Response.json({ ok: true, item: item(updated) });
  }
}
