import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleDashed, Link2, ShieldAlert, Sparkles } from "lucide-react";
import type { OnboardingHealth, OnboardingStep } from "../shared/onboarding-health";
import type { OrganizationSummary } from "../shared/types";
import { tenantApi } from "./api";
import type { SearchResult } from "./model";
import { DataState, ErrorText } from "./ui";
import XeroAccountingSetup from "./XeroAccountingSetup";

type IntegrationList = { connections: Array<{ id: string; provider: string; displayName: string; status: string }> };

type XeroInstall = { authorizationUrl: string; expiresAt: number };

function stepPage(step: OnboardingStep): SearchResult["page"] {
  if (step.page === "products") return "products";
  if (step.page === "orders") return "orders";
  if (step.page === "purchasing") return "purchasing";
  if (step.page === "inventory") return "inventory";
  if (step.page === "settings") return "settings";
  return "overview";
}

async function startXero(tenantId: string) {
  const response = await fetch("/api/integrations/xero/install", {
    method: "POST",
    headers: { "x-ordermate-tenant": tenantId },
  });
  const payload = await response.json<XeroInstall & { error?: string }>();
  if (!response.ok) throw new Error(payload.error || "Unable to start Xero connection");
  return payload;
}

export default function OnboardingHealthPanel({
  tenant,
  onNavigate,
}: {
  tenant: OrganizationSummary;
  onNavigate: (page: SearchResult["page"]) => void;
}) {
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: ["tenant", tenant.id, "onboarding-health"],
    queryFn: () => tenantApi<OnboardingHealth>(tenant.id, "/onboarding/health"),
    refetchInterval: 60_000,
  });
  const integrations = useQuery({
    queryKey: ["tenant", tenant.id, "integrations"],
    queryFn: () => tenantApi<IntegrationList>(tenant.id, "/integrations"),
    enabled: tenant.role === "owner" || tenant.role === "admin" || tenant.role === "manager",
  });
  const xero = integrations.data?.connections.find(connection => connection.provider === "xero" && connection.status !== "disconnected");
  const connectXero = useMutation({
    mutationFn: () => startXero(tenant.id),
    onSuccess: data => {
      window.location.assign(data.authorizationUrl);
    },
  });
  const data = health.data;
  const complete = data?.steps.filter(step => step.status === "complete").length ?? 0;
  const total = data?.steps.filter(step => step.status !== "optional").length ?? 0;
  const canManageIntegrations = tenant.role === "owner" || tenant.role === "admin";

  if (data?.firstValueAt && data.migration.blockers.length === 0 && !xero) return null;

  return <section className="panel">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">First-value onboarding</p>
        <h3>{data?.firstValueAt ? "Finish migration cleanly" : "Get operational without guesswork"}</h3>
      </div>
      <Sparkles size={21} />
    </div>
    <p>Operating Layer derives this checklist from real workspace state. It stays focused on the next blocker, then measures how long it took to reach the first real operational transaction.</p>

    <DataState loading={health.isLoading} error={health.error} empty={false} emptyText="Onboarding health is unavailable.">
      {data && <>
        <div className="flow-plan-summary" aria-label="Onboarding health summary">
          <span><CheckCircle2 size={15} /> {complete}/{total} core steps</span>
          <span>{data.progressPercent}% ready</span>
          <span>{data.timeToFirstValueMinutes === null ? "First value not reached" : `First value in ${data.timeToFirstValueMinutes}m`}</span>
          <span><ShieldAlert size={15} /> {data.migration.blockers.length} migration blocker{data.migration.blockers.length === 1 ? "" : "s"}</span>
        </div>

        <div className="principle-list">
          {data.steps.map(step => <span key={step.key}>
            <i>{step.status === "complete" ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}</i>
            <span><strong>{step.title}</strong><br />{step.detail}</span>
          </span>)}
        </div>

        {data.migration.blockers.length > 0 && <div className="automation-callout">
          <ShieldAlert size={18} />
          <div><strong>Migration health needs attention</strong><span>{data.migration.blockers.join(" · ")}</span></div>
        </div>}

        <div className="action-row">
          {data.nextStep?.actionLabel && <button type="button" className="primary" onClick={() => onNavigate(stepPage(data.nextStep!))}>
            {data.nextStep.actionLabel} <ArrowRight size={14} />
          </button>}
          {canManageIntegrations && !xero && <button type="button" disabled={connectXero.isPending} onClick={() => connectXero.mutate()}>
            <Link2 size={14} /> {connectXero.isPending ? "Opening Xero…" : "Connect Xero"}
          </button>}
          {xero && <span><Link2 size={14} /> Xero: {xero.displayName} · {xero.status.replaceAll("_", " ")}</span>}
          <button type="button" onClick={() => { qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "onboarding-health"] }); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "integrations"] }); if (xero) qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "xero-accounting-setup", xero.id] }); }}>Refresh health</button>
        </div>
        {connectXero.error && <ErrorText error={connectXero.error} />}
        {xero && <XeroAccountingSetup tenant={tenant} connectionId={xero.id} />}
      </>}
    </DataState>
  </section>;
}
