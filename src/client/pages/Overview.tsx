import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, BriefcaseBusiness, ContactRound, Sparkles, Warehouse } from "lucide-react";
import type { WorkspaceModuleKey } from "../../shared/modules";
import type { OrganizationSummary, DashboardSummary } from "../../shared/types";
import { money, tenantApi, tenantOpsApi } from "../api";
import FlowPlan from "../FlowPlan";
import { isDemoTenant } from "../demo-store";
import type { AttentionResponse, SearchResult } from "../model";
import OperationsAssistant from "../OperationsAssistant";
import { DataState, PageHeader } from "../ui";

type ModulesResponse = { modules: Array<{ key: WorkspaceModuleKey; enabled: boolean }> };
type Contact = { id: string; lifecycle_stage: "prospect" | "customer" };
type ServiceCase = { id: string; number: string; title: string; contact_name: string; status: string };
type ServiceJob = { id: string; case_id: string; number: string; title: string; customer_name?: string | null; status: string; next_visit_at?: string | null };
type ServiceInvoice = { id: string; case_id: string; number: string; customer_name?: string | null; status: string; total_minor: number; outstanding_minor: number; currency: string; due_date?: string | null };
type ServiceSummary = { contacts: Contact[]; cases: ServiceCase[]; jobs: ServiceJob[]; invoices: ServiceInvoice[] };
type InboxItem = AttentionResponse["items"][number];

export default function Overview({ tenant, onNavigate }: { tenant: OrganizationSummary; onNavigate: (page: SearchResult["page"]) => void }) {
  const demo = isDemoTenant(tenant.id);
  const modules = useQuery({
    queryKey: ["tenant", tenant.id, "modules"],
    queryFn: () => tenantApi<ModulesResponse>(tenant.id, "/modules"),
  });
  const enabled = useMemo(() => new Set(modules.data?.modules.filter(module => module.enabled).map(module => module.key) || []), [modules.data]);
  const crmEnabled = enabled.has("crm");
  const serviceEnabled = enabled.has("service");
  const ordersEnabled = enabled.has("orders");
  const inventoryEnabled = enabled.has("inventory");
  const purchasingEnabled = enabled.has("purchasing");
  const operationsEnabled = ordersEnabled || inventoryEnabled || purchasingEnabled;
  const commercePlanningEnabled = ordersEnabled && inventoryEnabled && purchasingEnabled;

  const query = useQuery({
    queryKey: ["tenant", tenant.id, "dashboard"],
    queryFn: () => tenantApi<DashboardSummary>(tenant.id, "/dashboard"),
    enabled: !!modules.data && operationsEnabled,
  });
  const attention = useQuery({
    queryKey: ["tenant", tenant.id, "attention"],
    queryFn: () => tenantOpsApi<AttentionResponse>(tenant.id, "/attention"),
    enabled: !!modules.data && operationsEnabled,
  });
  const service = useQuery({
    queryKey: ["tenant", tenant.id, "service-overview"],
    queryFn: async (): Promise<ServiceSummary> => {
      const [contacts, cases, jobs, invoices] = await Promise.all([
        tenantApi<{ contacts: Contact[] }>(tenant.id, "/crm/contacts"),
        tenantApi<{ cases: ServiceCase[] }>(tenant.id, "/service/cases"),
        tenantApi<{ jobs: ServiceJob[] }>(tenant.id, "/service/jobs"),
        tenantApi<{ invoices: ServiceInvoice[] }>(tenant.id, "/service/invoices"),
      ]);
      return { contacts: contacts.contacts, cases: cases.cases, jobs: jobs.jobs, invoices: invoices.invoices };
    },
    enabled: !!modules.data && serviceEnabled,
  });
  const crm = useQuery({
    queryKey: ["tenant", tenant.id, "crm-overview"],
    queryFn: () => tenantApi<{ contacts: Contact[] }>(tenant.id, "/crm/contacts"),
    enabled: !!modules.data && crmEnabled && !serviceEnabled,
  });

  const data = query.data;
  const serviceData = service.data;
  const prospects = serviceData?.contacts.filter(contact => contact.lifecycle_stage === "prospect").length ?? crm.data?.contacts.filter(contact => contact.lifecycle_stage === "prospect").length ?? 0;
  const customers = serviceData?.contacts.filter(contact => contact.lifecycle_stage === "customer").length ?? crm.data?.contacts.filter(contact => contact.lifecycle_stage === "customer").length ?? 0;
  const openCases = serviceData?.cases.filter(item => item.status === "open").length ?? 0;
  const activeJobs = serviceData?.jobs.filter(item => item.status === "scheduled" || item.status === "in_progress").length ?? 0;
  const outstandingInvoices = useMemo(() => serviceData?.invoices.filter(item => item.status === "issued" || item.status === "partially_paid") ?? [], [serviceData]);
  const outstandingMinor = outstandingInvoices.reduce((sum, invoice) => sum + Number(invoice.outstanding_minor || 0), 0);
  const serviceCurrency = outstandingInvoices[0]?.currency || serviceData?.invoices[0]?.currency || "GBP";

  const serviceInbox = useMemo<InboxItem[]>(() => {
    if (!serviceData) return [];
    const customerByCase = new Map(serviceData.cases.map(serviceCase => [serviceCase.id, serviceCase.contact_name] as const));
    const items: InboxItem[] = [];
    for (const serviceCase of serviceData.cases.filter(item => item.status === "open").slice(0, 3)) {
      items.push({ id: `service-case:${serviceCase.id}`, severity: "info", type: "Service enquiry", title: `${serviceCase.number} · ${serviceCase.title}`, detail: serviceCase.contact_name, page: "service" });
    }
    for (const job of serviceData.jobs.filter(item => item.status === "scheduled" || item.status === "in_progress").slice(0, 3)) {
      const customer = job.customer_name || customerByCase.get(job.case_id) || "Customer";
      items.push({ id: `service-job:${job.id}`, severity: job.status === "in_progress" ? "warning" : "info", type: job.status === "in_progress" ? "Job in progress" : "Scheduled service", title: `${job.number} · ${job.title}`, detail: `${customer}${job.next_visit_at ? ` · ${new Date(job.next_visit_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}`, page: "service" });
    }
    for (const invoice of outstandingInvoices.slice(0, 3)) {
      const customer = invoice.customer_name || customerByCase.get(invoice.case_id) || "Customer";
      items.push({ id: `service-invoice:${invoice.id}`, severity: "warning", type: "Invoice outstanding", title: invoice.number, detail: `${customer} · ${money(invoice.outstanding_minor, invoice.currency)} outstanding${invoice.due_date ? ` · due ${invoice.due_date}` : ""}`, page: "service" });
    }
    return items;
  }, [serviceData, outstandingInvoices]);

  const inbox = [...serviceInbox, ...(attention.data?.items || [])].slice(0, 8);
  const attentionPage = (item: InboxItem): SearchResult["page"] => item.type === "Awaiting fulfilment" ? "warehouse" : item.page;
  const pageDescription = serviceEnabled
    ? "Prospects, service work, scheduled jobs and money still to collect—then the material work that supports them."
    : operationsEnabled
      ? "The work that needs attention, shaped by the modules this business actually uses."
      : crmEnabled
        ? "A lightweight relationship workspace for prospects and customers, without stock or fulfilment noise."
        : "This workspace only shows the modules enabled for this business.";

  return <>
    <PageHeader eyebrow="Today" title={tenant.name} description={demo ? `${pageDescription} This sample stays only in this browser.` : pageDescription} />

    {serviceEnabled ? <section className="metric-grid">
      <Metric label="Prospects" value={service.isLoading ? "—" : prospects} helper="Not converted yet" tone="blue" />
      <Metric label="Open service cases" value={service.isLoading ? "—" : openCases} helper="Enquiries and active opportunities" tone="ink" />
      <Metric label="Active jobs" value={service.isLoading ? "—" : activeJobs} helper="Scheduled + in progress" tone="amber" />
      <Metric label="Outstanding invoices" value={service.isLoading ? "—" : money(outstandingMinor, serviceCurrency)} helper={`${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"} to collect`} tone="rose" />
    </section> : operationsEnabled ? <section className="metric-grid">
      {ordersEnabled && <Metric label="Open orders" value={data?.ordersOpen ?? "—"} helper="Draft + confirmed" tone="ink" />}
      {ordersEnabled && <Metric label="Awaiting fulfilment" value={data?.ordersAwaitingFulfilment ?? "—"} helper="Ready to pick" tone="amber" />}
      {purchasingEnabled && <Metric label="Open purchase orders" value={data?.purchaseOrdersOpen ?? "—"} helper="Including partial receipts" tone="blue" />}
      {inventoryEnabled && <Metric label="Low stock" value={data?.lowStockVariants ?? "—"} helper="Active tracked positions" tone="rose" />}
      {!ordersEnabled && inventoryEnabled && <Metric label="Inventory value" value={money(data?.inventoryValueMinor, data?.currency)} helper="At recorded variant cost" tone="ink" />}
    </section> : crmEnabled ? <section className="metric-grid">
      <Metric label="Prospects" value={crm.isLoading ? "—" : prospects} helper="Not converted yet" tone="blue" />
      <Metric label="Customers" value={crm.isLoading ? "—" : customers} helper="Established CRM relationships" tone="ink" />
    </section> : null}

    {commercePlanningEnabled && <FlowPlan tenant={tenant} onNavigate={onNavigate} />}

    {commercePlanningEnabled && <OperationsAssistant tenant={tenant} onNavigate={onNavigate} />}

    {(serviceEnabled || operationsEnabled) && <section className="panel attention-panel">
      <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h3>{serviceEnabled ? "Work inbox" : "Operational inbox"}</h3></div><AlertTriangle size={21} /></div>
      <DataState loading={(serviceEnabled && service.isLoading) || (operationsEnabled && attention.isLoading)} error={service.error || attention.error} empty={!inbox.length} emptyText="Nothing needs attention right now.">
        <div className="attention-list">{inbox.map(item => <button key={item.id} className={`attention-item attention-${item.severity}`} onClick={() => onNavigate(attentionPage(item))}><span className="attention-marker" /><span className="attention-copy"><small>{item.type}</small><strong>{item.title}</strong><span>{item.detail}</span></span><span className="attention-open">Open</span></button>)}</div>
      </DataState>
    </section>}

    <section className="overview-grid">
      {inventoryEnabled && <div className="panel spotlight">
        <div className="panel-heading"><div><p className="eyebrow">Inventory position</p><h2>{money(data?.inventoryValueMinor, data?.currency)}</h2></div><Warehouse size={24} /></div>
        <p>Current on-hand inventory valued at recorded variant cost.</p>
        <div className="soft-rule" />
        <div className="automation-callout"><Sparkles size={18} /><div><strong>{demo ? "Explainable planning, locally" : "Automation with a human checkpoint"}</strong><span>{demo ? "Forecasting and replenishment use the sample operational records in this browser. File-based extraction stays disabled in guest mode." : "Forecasting and evidence-backed purchasing suggestions can prepare work; audited transactions remain the source of business truth."}</span></div></div>
      </div>}

      {serviceEnabled ? <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Service operating model</p><h3>One customer, separate documents</h3></div><BriefcaseBusiness size={21} /></div>
        <div className="principle-list"><span><i>01</i>CRM identity survives prospect → customer.</span><span><i>02</i>Request, quote, job and invoice keep independent lifecycles.</span><span><i>03</i>Stock is optional and only posts when material is actually used.</span></div>
      </div> : operationsEnabled ? <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Operating model</p><h3>One source of stock truth</h3></div><Archive size={21} /></div>
        <div className="principle-list"><span><i>01</i>Orders reserve before they consume.</span><span><i>02</i>Purchase receipts create stock movements.</span><span><i>03</i>Every mutation records who did it.</span></div>
      </div> : crmEnabled ? <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Relationship model</p><h3>One durable contact identity</h3></div><ContactRound size={21} /></div>
        <div className="principle-list"><span><i>01</i>Prospects can become customers without a duplicate record.</span><span><i>02</i>Contact details and notes stay attached to the relationship.</span><span><i>03</i>Operational modules can be added later without rebuilding CRM.</span></div>
      </div> : null}
    </section>
  </>;
}

function Metric({ label, value, helper, tone }: { label: string; value: string | number; helper: string; tone: string }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>;
}
