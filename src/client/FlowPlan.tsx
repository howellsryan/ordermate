import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Clock3, ShieldAlert, Sparkles, UserRound, Workflow, X } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { buildFlowPlan } from "../shared/flow-plan";
import type { WorkQueueItem, WorkQueueResponse } from "../shared/work-queue";
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

type WorkAction = "acknowledge" | "snooze" | "assign-to-me" | "unassign" | "resolve" | "dismiss";
type WorkMutation = { itemId: string; action: WorkAction; reason?: string };

export default function FlowPlan(props: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const features = useWorkspaceFeatures(props.tenant.id);
  if (!features.data || !features.enabled.has("flow_plan") || !features.enabled.has("operating_intelligence")) return null;
  return isDemoTenant(props.tenant.id) ? <DemoFlowPlan {...props} /> : <PersistentWorkQueue {...props} />;
}

function PersistentWorkQueue({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const qc = useQueryClient();
  const canWork = tenant.role !== "viewer";
  const queue = useQuery({
    queryKey: ["tenant", tenant.id, "work-queue"],
    queryFn: () => tenantApi<WorkQueueResponse>(tenant.id, "/work-queue/refresh", { method: "POST" }),
    refetchInterval: 60_000,
  });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "work-queue"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  const data = queue.data;
  return <section className="panel flow-plan-panel">
    <div className="panel-heading flow-plan-heading">
      <div>
        <p className="eyebrow">Operations work queue</p>
        <h3>What needs attention next</h3>
      </div>
      <div className="flow-plan-status"><Sparkles size={16} /><span>Persistent live triage</span></div>
    </div>
    <p className="flow-plan-intro">Operating Layer continuously turns customer promises, stock risk, incoming supply, receiving issues and integration exceptions into durable operational work. Items stay visible until the condition clears or somebody deliberately handles them.</p>

    <DataState
      loading={queue.isLoading}
      error={queue.error}
      empty={!!data && !data.items.length}
      emptyText={data?.summary.snoozed ? `No actionable work right now. ${data.summary.snoozed} item${data.summary.snoozed === 1 ? " is" : "s are"} snoozed.` : "The queue is clear — no active exceptions need a decision right now."}
    >
      {data && <>
        <div className="flow-plan-summary" aria-label="Operations work queue summary">
          <span><Workflow size={15} /> {data.summary.actionable} actionable</span>
          <span><ShieldAlert size={15} /> {data.summary.critical} critical</span>
          <span><UserRound size={15} /> {data.summary.assignedToMe} assigned to me</span>
          <span><Clock3 size={15} /> {data.summary.snoozed} snoozed</span>
        </div>
        {mutate.error && <ErrorText error={mutate.error} />}
        <div className="flow-plan-list">
          {data.items.map(item => <WorkQueueCard
            key={item.id}
            item={item}
            canWork={canWork}
            pending={mutate.isPending}
            onNavigate={() => onNavigate(item.page)}
            onAction={mutation => mutate.mutate(mutation)}
          />)}
        </div>
      </>}
    </DataState>
  </section>;
}

function WorkQueueCard({
  item,
  canWork,
  pending,
  onNavigate,
  onAction,
}: {
  item: WorkQueueItem;
  canWork: boolean;
  pending: boolean;
  onNavigate: () => void;
  onAction: (mutation: WorkMutation) => void;
}) {
  const [closeAction, setCloseAction] = useState<"resolve" | "dismiss" | null>(null);
  const [reason, setReason] = useState("");
  const submitClose = () => {
    const trimmed = reason.trim();
    if (!closeAction || trimmed.length < 2) return;
    onAction({ itemId: item.id, action: closeAction, reason: trimmed });
    setCloseAction(null);
    setReason("");
  };

  return <article className={`flow-plan-item flow-plan-${item.severity}`}>
    <span className="flow-plan-rank" aria-hidden="true" />
    <div className="flow-plan-copy">
      <small>{categoryLabel[item.category]}{item.status === "acknowledged" ? " · Acknowledged" : ""}</small>
      <strong>{item.title}</strong>
      <span>{item.detail}</span>
      <b>{item.nextAction}</b>
      {item.assigneeName && <span><UserRound size={13} /> Assigned to {item.assigneeName}</span>}
      {item.evidence.length > 0 && <small>{item.evidence.slice(0, 2).join(" · ")}</small>}
    </div>
    <div className="action-row">
      <button type="button" onClick={onNavigate}>Open <ArrowRight size={14} /></button>
      {canWork && <>
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
      </>}
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

function DemoFlowPlan({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
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
    <p className="flow-plan-intro">This browser-only guest demo keeps the deterministic Flow Plan local. Persistent assignment, snooze and resolution history are available in a real workspace.</p>

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
