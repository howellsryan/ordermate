import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock3, ShieldAlert, Sparkles, Workflow } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { buildFlowPlan } from "../shared/flow-plan";
import { tenantApi, tenantOpsApi } from "./api";
import type { AttentionResponse, ReplenishmentResponse, SearchResult } from "./model";
import { DataState } from "./ui";

const categoryLabel = {
  customer_promise: "Customer promise",
  stock_risk: "Stock risk",
  supply_risk: "Incoming supply",
  receiving_exception: "Receiving exception",
} as const;

export default function FlowPlan({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
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
    <p className="flow-plan-intro">Operating Layer continuously checks customer promises, forecast stock risk, incoming supplier dates and receiving exceptions, then turns the highest-impact exceptions into a short decision queue.</p>

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
