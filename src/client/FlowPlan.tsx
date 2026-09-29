import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Clock3, ShieldAlert, Sparkles, UserRound, UsersRound, Workflow, X } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { buildFlowPlan } from "../shared/flow-plan";
import type { FrontlineWorkQueueResponse, WorkQueueCategory, WorkQueueItem, WorkQueueMetrics } from "../shared/work-queue";
import { isDemoTenant } from "./demo-store";
import { tenantApi, tenantOpsApi } from "./api";
import type { AttentionResponse, ReplenishmentResponse, SearchResult } from "./model";
import { DataState, ErrorText } from "./ui";
import { useWorkspaceFeatures } from "./workspace-features";

const categoryLabel = {
  customer_promise: "Customer promise",
  stock_risk: "Stock risk",
  supply_risk: "Incoming supply",
  receiving_exception: "Receiving exception",
  integration_exception: "Integration exception",
} as const;

const persistentQueueRoles = new Set(["owner", "admin", "manager", "inventory", "fulfilment"]);
const allCategories = Object.keys(categoryLabel) as WorkQueueCategory[];
type WorkAction = "acknowledge" | "snooze" | "assign-to-me" | "unassign" | "resolve" | "dismiss";
type WorkMutation = { itemId: string; action: WorkAction; reason?: string };
type AssignmentMutation = { itemId: string; assigneeId?: string | null; assigneeName?: string | null; teamId?: string | null; teamName?: string | null };
type ScheduleMutation = { itemId: string; dueAt: string | null; escalationAt: string | null };

function categoriesForRole(role: OrganizationSummary["role"]): WorkQueueCategory[] {
  if (role === "inventory") return ["stock_risk", "supply_risk", "receiving_exception"];
  if (role === "fulfilment") return ["customer_promise", "receiving_exception"];
  return allCategories;
}

export default function FlowPlan(props: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const features = useWorkspaceFeatures(props.tenant.id);
  if (!features.data || !features.enabled.has("flow_plan") || !features.enabled.has("operating_intelligence")) return null;
  const persistent = !isDemoTenant(props.tenant.id) && persistentQueueRoles.has(props.tenant.role);
  return persistent ? <PersistentWorkQueue {...props} /> : <EphemeralFlowPlan {...props} />;
}

function PersistentWorkQueue({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const qc = useQueryClient();
  const categories = useMemo(() => categoriesForRole(tenant.role), [tenant.role]);
  const [category, setCategory] = useState<WorkQueueCategory | "all">("all");
  const [mineOnly, setMineOnly] = useState(false);
  const queue = useQuery({
    queryKey: ["tenant", tenant.id, "work-queue", "frontline", category, mineOnly],
    queryFn: async () => {
      await tenantApi(tenant.id, "/work-queue/refresh", { method: "POST" });
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (mineOnly) params.set("mine", "true");
      const query = params.size ? `?${params.toString()}` : "";
      return tenantApi<FrontlineWorkQueueResponse>(tenant.id, `/work-queue/frontline${query}`);
    },
    refetchInterval: 60_000,
  });
  const metrics = useQuery({
    queryKey: ["tenant", tenant.id, "work-queue", "metrics"],
    queryFn: () => tenantApi<WorkQueueMetrics>(tenant.id, "/work-queue/metrics?days=30"),
    refetchInterval: 5 * 60_000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "work-queue"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
  };
  const mutate = useMutation({
    mutationFn: ({ itemId, action, reason }: WorkMutation) => {
      const body = action === "snooze"
        ? JSON.stringify({ until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
        : action === "resolve" || action === "dismiss"
          ? JSON.stringify({ reason })
          : undefined;
      return tenantApi<{ ok: true; item: WorkQueueItem }>(tenant.id, `/work-queue/${encodeURIComponent(itemId)}/${action}`, {
        method: "POST",
        body,
      });
    },
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: (input: AssignmentMutation) => tenantApi<{ ok: true; item: WorkQueueItem }>(tenant.id, `/work-queue/${encodeURIComponent(input.itemId)}/assign`, {
      method: "POST",
      body: JSON.stringify({
        assigneeId: input.assigneeId ?? null,
        assigneeName: input.assigneeName ?? null,
        teamId: input.teamId ?? null,
        teamName: input.teamName ?? null,
      }),
    }),
    onSuccess: invalidate,
  });
  const schedule = useMutation({
    mutationFn: (input: ScheduleMutation) => tenantApi<{ ok: true; item: WorkQueueItem }>(tenant.id, `/work-queue/${encodeURIComponent(input.itemId)}/schedule`, {
      method: "POST",
      body: JSON.stringify({ dueAt: input.dueAt, escalationAt: input.escalationAt }),
    }),
    onSuccess: invalidate,
  });

  const data = queue.data;
  const pending = mutate.isPending || assign.isPending || schedule.isPending;
  return <section className="panel flow-plan-panel">
    <div className="panel-heading flow-plan-heading">
      <div>
        <p className="eyebrow">Operations work queue</p>
        <h3>What needs attention next</h3>
      </div>
      <div className="flow-plan-status"><Sparkles size={16} /><span>Persistent live triage</span></div>
    </div>
    <p className="flow-plan-intro">Operating Layer continuously turns customer promises, stock risk, incoming supply, receiving issues and integration exceptions into durable operational work. Frontline roles only see the categories relevant to their job; managers can coordinate across the whole operation.</p>

    <div className="action-row" aria-label="Work queue filters">
      <button type="button" className={category === "all" ? "primary" : ""} onClick={() => setCategory("all")}>All</button>
      {categories.map(value => <button key={value} type="button" className={category === value ? "primary" : ""} onClick={() => setCategory(value)}>{categoryLabel[value]}</button>)}
      <button type="button" className={mineOnly ? "primary" : ""} onClick={() => setMineOnly(value => !value)}><UserRound size={14} /> Mine</button>
    </div>

    <DataState
      loading={queue.isLoading}
      error={queue.error}
      empty={!!data && !data.items.length}
      emptyText={data?.summary.snoozed ? `No actionable work in this view. ${data.summary.snoozed} item${data.summary.snoozed === 1 ? " is" : "s are"} snoozed.` : "This queue is clear — no active exceptions need a decision right now."}
    >
      {data && <>
        <div className="flow-plan-summary" aria-label="Operations work queue summary">
          <span><Workflow size={15} /> {data.summary.actionable} actionable</span>
          <span><ShieldAlert size={15} /> {data.summary.critical} critical</span>
          <span><UserRound size={15} /> {data.summary.assignedToMe} mine</span>
          <span><Clock3 size={15} /> {data.summary.overdue} overdue</span>
          <span><ShieldAlert size={15} /> {data.summary.escalated} escalated</span>
          <span><UsersRound size={15} /> {data.summary.unassigned} unowned</span>
        </div>
        {metrics.data && <div className="flow-plan-summary" aria-label="Work queue resolution metrics">
          <span>{metrics.data.windowDays}d resolution {metrics.data.resolutionRate === null ? "—" : `${Math.round(metrics.data.resolutionRate * 100)}%`}</span>
          <span>Median {metrics.data.overall.medianMinutes === null ? "—" : `${metrics.data.overall.medianMinutes}m`}</span>
          <span>P90 {metrics.data.overall.p90Minutes === null ? "—" : `${metrics.data.overall.p90Minutes}m`}</span>
        </div>}
        {(mutate.error || assign.error || schedule.error) && <ErrorText error={mutate.error || assign.error || schedule.error} />}
        <div className="flow-plan-list">
          {data.items.map(item => <WorkQueueCard
            key={item.id}
            item={item}
            pending={pending}
            onNavigate={() => onNavigate(item.page)}
            onAction={mutation => mutate.mutate(mutation)}
            onAssign={mutation => assign.mutate(mutation)}
            onSchedule={mutation => schedule.mutate(mutation)}
          />)}
        </div>
      </>}
    </DataState>
  </section>;
}

function WorkQueueCard({
  item,
  pending,
  onNavigate,
  onAction,
  onAssign,
  onSchedule,
}: {
  item: WorkQueueItem;
  pending: boolean;
  onNavigate: () => void;
  onAction: (mutation: WorkMutation) => void;
  onAssign: (mutation: AssignmentMutation) => void;
  onSchedule: (mutation: ScheduleMutation) => void;
}) {
  const [closeAction, setCloseAction] = useState<"resolve" | "dismiss" | null>(null);
  const [reason, setReason] = useState("");
  const [teamName, setTeamName] = useState(item.teamName || "");
  const [dueAt, setDueAt] = useState(item.dueAt ? item.dueAt.slice(0, 16) : "");
  const [escalationAt, setEscalationAt] = useState(item.escalationAt ? item.escalationAt.slice(0, 16) : "");
  const submitClose = () => {
    const trimmed = reason.trim();
    if (!closeAction || trimmed.length < 2) return;
    onAction({ itemId: item.id, action: closeAction, reason: trimmed });
    setCloseAction(null);
    setReason("");
  };
  const submitTeam = () => {
    const trimmed = teamName.trim();
    onAssign({
      itemId: item.id,
      assigneeId: item.assigneeId,
      assigneeName: item.assigneeName,
      teamId: trimmed ? trimmed.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) : null,
      teamName: trimmed || null,
    });
  };
  const submitSchedule = () => {
    onSchedule({
      itemId: item.id,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      escalationAt: escalationAt ? new Date(escalationAt).toISOString() : null,
    });
  };

  return <article className={`flow-plan-item flow-plan-${item.severity}`}>
    <span className="flow-plan-rank" aria-hidden="true" />
    <div className="flow-plan-copy">
      <small>{categoryLabel[item.category]}{item.status === "acknowledged" ? " · Acknowledged" : ""}{item.escalated ? " · Escalated" : ""}</small>
      <strong>{item.title}</strong>
      <span>{item.detail}</span>
      <b>{item.nextAction}</b>
      {item.assigneeName && <span><UserRound size={13} /> Assigned to {item.assigneeName}</span>}
      {item.teamName && <span><UsersRound size={13} /> Team {item.teamName}</span>}
      {item.dueAt && <span><Clock3 size={13} /> Due {new Date(item.dueAt).toLocaleString()}</span>}
      {item.evidence.length > 0 && <small>{item.evidence.slice(0, 2).join(" · ")}</small>}
    </div>
    <div className="action-row">
      {item.deepLink ? <a className="button-link" href={item.deepLink}>Open record <ArrowRight size={14} /></a> : <button type="button" onClick={onNavigate}>Open <ArrowRight size={14} /></button>}
      <button type="button" disabled={pending} onClick={() => onAction({ itemId: item.id, action: item.assigneeId ? "unassign" : "assign-to-me" })}>
        <UserRound size={14} /> {item.assigneeId ? "Unassign" : "Take"}
      </button>
      {item.status !== "acknowledged" && <button type="button" disabled={pending} onClick={() => onAction({ itemId: item.id, action: "acknowledge" })}>
        <Check size={14} /> Acknowledge
      </button>}
      <button type="button" disabled={pending} onClick={() => onAction({ itemId: item.id, action: "snooze" })}>
        <Clock3 size={14} /> Snooze 24h
      </button>
      <button type="button" disabled={pending} onClick={() => setCloseAction(closeAction === "resolve" ? null : "resolve")}>
        <Check size={14} /> Resolve
      </button>
      <button type="button" disabled={pending} onClick={() => setCloseAction(closeAction === "dismiss" ? null : "dismiss")}>
        <X size={14} /> Dismiss
      </button>
    </div>
    <div className="settings-form">
      <label>
        <span>Team</span>
        <input value={teamName} maxLength={255} onChange={event => setTeamName(event.target.value)} placeholder="Warehouse, customer care…" />
      </label>
      <button type="button" disabled={pending || teamName.trim() === (item.teamName || "")} onClick={submitTeam}>Save team</button>
      <label>
        <span>Due</span>
        <input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} />
      </label>
      <label>
        <span>Escalate</span>
        <input type="datetime-local" value={escalationAt} onChange={event => setEscalationAt(event.target.value)} />
      </label>
      <button type="button" disabled={pending || (!!dueAt && !!escalationAt && escalationAt < dueAt)} onClick={submitSchedule}>Save SLA</button>
    </div>
    {closeAction && <div className="settings-form">
      <label>
        <span>{closeAction === "resolve" ? "Resolution note" : "Dismissal reason"}</span>
        <input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder={closeAction === "resolve" ? "What was done?" : "Why is this not actionable?"} />
      </label>
      <div className="action-row">
        <button className="primary" type="button" disabled={pending || reason.trim().length < 2} onClick={submitClose}>{closeAction === "resolve" ? "Mark resolved" : "Dismiss item"}</button>
        <button type="button" disabled={pending} onClick={() => { setCloseAction(null); setReason(""); }}>Cancel</button>
      </div>
    </div>}
  </article>;
}

function EphemeralFlowPlan({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const attention = useQuery({
    queryKey: ["tenant", tenant.id, "attention"],
    queryFn: () => tenantOpsApi<AttentionResponse>(tenant.id, "/attention"),
  });
  const replenishment = useQuery({
    queryKey: ["tenant", tenant.id, "replenishment"],
    queryFn: () => tenantApi<ReplenishmentResponse>(tenant.id, "/replenishment"),
  });

  const plan = attention.data && replenishment.data
    ? buildFlowPlan(attention.data.items, replenishment.data)
    : null;

  return <section className="panel flow-plan-panel">
    <div className="panel-heading flow-plan-heading">
      <div>
        <p className="eyebrow">Automatic flow plan</p>
        <h3>What should move next</h3>
      </div>
      <div className="flow-plan-status"><Sparkles size={16} /><span>Live triage</span></div>
    </div>
    <p className="flow-plan-intro">Operating Layer checks the operational signals this role can access and prioritises the highest-impact exceptions. Persistent assignment, team ownership and SLA handling are available to operational roles on live workspaces.</p>

    <DataState
      loading={attention.isLoading || replenishment.isLoading}
      error={attention.error || replenishment.error}
      empty={!!plan && !plan.actions.length}
      emptyText="The flow plan is clear — no urgent exceptions need a decision right now."
    >
      {plan && <>
        <div className="flow-plan-summary" aria-label="Flow plan summary">
          <span><Workflow size={15} /> {plan.actions.length} action{plan.actions.length === 1 ? "" : "s"} prioritised</span>
          <span><ShieldAlert size={15} /> {plan.critical} critical</span>
          <span><Clock3 size={15} /> {plan.checks.length} live checks</span>
        </div>
        <div className="flow-plan-list">
          {plan.actions.map(action => <button
            type="button"
            className={`flow-plan-item flow-plan-${action.severity}`}
            key={action.id}
            onClick={() => onNavigate(action.page)}
          >
            <span className="flow-plan-rank" aria-hidden="true" />
            <span className="flow-plan-copy">
              <small>{categoryLabel[action.category]}</small>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
              <b>{action.nextAction}</b>
            </span>
            <span className="flow-plan-open">Open <ArrowRight size={14} /></span>
          </button>)}
        </div>
      </>}
    </DataState>
  </section>;
}
