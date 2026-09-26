import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, FileText, Hammer, Plus, ReceiptText, Send, WalletCards, Wrench } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import { money, tenantApi } from "../api";
import { DataState, ErrorText, Field, Modal, PageHeader, Status, pounds } from "../ui";

type Contact = { id: string; lifecycle_stage: "prospect" | "customer"; name: string; address?: Record<string, unknown> | null };
type CaseSummary = { id: string; number: string; contact_name: string; title: string; status: string; updated_at: string };
type ServiceRequest = { id: string; number: string; status: string; details: string; requested_for?: string | null };
type Quote = { id: string; number: string; status: string; total_minor: number; currency: string; expires_at?: string | null };
type Job = { id: string; number: string; status: string; title: string; completed_at?: string | null; next_visit_at?: string | null };
type Invoice = { id: string; number: string; status: string; total_minor: number; paid_minor?: number; currency: string; due_date?: string | null };
type CaseDetail = CaseSummary & { contact_id: string; requests: ServiceRequest[]; quotes: Quote[]; jobs: Job[]; invoices: Invoice[] };
type CasesResponse = { cases: CaseSummary[] };
type ContactsResponse = { contacts: Contact[] };

type ModalState =
  | { kind: "request" }
  | { kind: "quote"; requestId: string }
  | { kind: "visit"; jobId: string }
  | { kind: "invoice"; jobId: string; caseId: string }
  | { kind: "payment"; invoiceId: string; outstandingMinor: number; currency: string }
  | null;

function invalidateService(qc: ReturnType<typeof useQueryClient>, tenantId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["tenant", tenantId, "service"] }),
    qc.invalidateQueries({ queryKey: ["tenant", tenantId, "crm"] }),
    qc.invalidateQueries({ queryKey: ["tenant", tenantId, "customers"] }),
    qc.invalidateQueries({ queryKey: ["tenant", tenantId, "inventory"] }),
    qc.invalidateQueries({ queryKey: ["tenant", tenantId, "audit"] }),
  ]);
}

export default function Service({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const canEdit = ["owner", "admin", "manager", "fulfilment"].includes(tenant.role);

  const cases = useQuery({ queryKey: ["tenant", tenant.id, "service", "cases"], queryFn: () => tenantApi<CasesResponse>(tenant.id, "/service/cases") });
  const contacts = useQuery({ queryKey: ["tenant", tenant.id, "crm", "contacts"], queryFn: () => tenantApi<ContactsResponse>(tenant.id, "/crm/contacts") });
  useEffect(() => {
    if (!selectedCaseId && cases.data?.cases[0]) setSelectedCaseId(cases.data.cases[0].id);
    if (selectedCaseId && cases.data && !cases.data.cases.some(item => item.id === selectedCaseId)) setSelectedCaseId(cases.data.cases[0]?.id || "");
  }, [cases.data, selectedCaseId]);

  const detail = useQuery({
    queryKey: ["tenant", tenant.id, "service", "case", selectedCaseId],
    queryFn: () => tenantApi<CaseDetail>(tenant.id, `/service/cases/${encodeURIComponent(selectedCaseId)}`),
    enabled: !!selectedCaseId,
  });

  const transition = useMutation({
    mutationFn: ({ path, body = {} }: { path: string; body?: unknown }) => tenantApi(tenant.id, path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => { await invalidateService(qc, tenant.id); },
  });

  const stats = useMemo(() => {
    const all = cases.data?.cases || [];
    return {
      open: all.filter(item => item.status === "open").length,
      won: all.filter(item => item.status === "won").length,
      jobs: detail.data?.jobs.filter(item => ["scheduled", "in_progress"].includes(item.status)).length || 0,
      due: detail.data?.invoices.filter(item => ["issued", "partially_paid"].includes(item.status)).length || 0,
    };
  }, [cases.data, detail.data]);

  return <>
    <PageHeader
      eyebrow="Service operations"
      title="Request to invoice"
      description="A dedicated service lifecycle: intake and qualification, quote, scheduled job/visits, completion, invoice and payment. Service work stays separate from commerce Orders."
      actions={canEdit ? <button type="button" className="primary" onClick={() => setModal({ kind: "request" })}><Plus size={16} /> New request</button> : undefined}
    />

    <div className="service-kpis">
      <div className="panel"><span>Open enquiries</span><strong>{stats.open}</strong><small>Service cases still being worked</small></div>
      <div className="panel"><span>Won work</span><strong>{stats.won}</strong><small>Converted into customer work</small></div>
      <div className="panel"><span>Active jobs</span><strong>{stats.jobs}</strong><small>Scheduled or in progress in this case</small></div>
      <div className="panel"><span>Invoices due</span><strong>{stats.due}</strong><small>Issued or partly paid in this case</small></div>
    </div>

    <div className="service-layout">
      <section className="panel service-case-list">
        <div className="panel-heading"><div><p className="eyebrow">Cases</p><h3>Customer work</h3></div></div>
        <DataState loading={cases.isLoading} error={cases.error} empty={!cases.data?.cases.length} emptyText="Create a request to start the first service case.">
          <div className="service-case-buttons">{cases.data?.cases.map(item => <button type="button" className={selectedCaseId === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedCaseId(item.id)}>
            <span><strong>{item.title}</strong><small>{item.number} · {item.contact_name}</small></span><Status value={item.status} />
          </button>)}</div>
        </DataState>
      </section>

      <section className="panel service-case-detail">
        {!selectedCaseId ? <div className="empty-state"><Wrench size={28} /><strong>Select a case</strong><span>Its request, quote, job and invoice documents will appear here.</span></div> :
          <DataState loading={detail.isLoading} error={detail.error} empty={!detail.data} emptyText="Service case unavailable.">
            {detail.data && <CaseLifecycle tenant={tenant} detail={detail.data} canEdit={canEdit} transition={transition} setModal={setModal} />}
          </DataState>}
      </section>
    </div>

    {transition.error && <ErrorText error={transition.error} />}
    {modal?.kind === "request" && <RequestModal tenant={tenant} contacts={contacts.data?.contacts || []} onClose={() => setModal(null)} onCreated={async caseId => { setModal(null); setSelectedCaseId(caseId); await invalidateService(qc, tenant.id); }} />}
    {modal?.kind === "quote" && <QuoteModal tenant={tenant} requestId={modal.requestId} onClose={() => setModal(null)} onDone={async () => { setModal(null); await invalidateService(qc, tenant.id); }} />}
    {modal?.kind === "visit" && <VisitModal tenant={tenant} jobId={modal.jobId} onClose={() => setModal(null)} onDone={async () => { setModal(null); await invalidateService(qc, tenant.id); }} />}
    {modal?.kind === "invoice" && <InvoiceModal tenant={tenant} caseId={modal.caseId} jobId={modal.jobId} onClose={() => setModal(null)} onDone={async () => { setModal(null); await invalidateService(qc, tenant.id); }} />}
    {modal?.kind === "payment" && <PaymentModal tenant={tenant} invoiceId={modal.invoiceId} outstandingMinor={modal.outstandingMinor} currency={modal.currency} onClose={() => setModal(null)} onDone={async () => { setModal(null); await invalidateService(qc, tenant.id); }} />}
  </>;
}

function CaseLifecycle({ tenant, detail, canEdit, transition, setModal }: {
  tenant: OrganizationSummary;
  detail: CaseDetail;
  canEdit: boolean;
  transition: ReturnType<typeof useMutation<any, Error, { path: string; body?: unknown }>>;
  setModal: (value: ModalState) => void;
}) {
  return <div className="service-timeline">
    <div className="service-case-heading"><div><p className="eyebrow">{detail.number}</p><h2>{detail.title}</h2><p>{detail.contact_name}</p></div><Status value={detail.status} /></div>

    <LifecycleSection icon={<FileText size={18} />} title="1. Request" description="Capture the need, qualify it, then choose whether this work needs a quote or can go directly to a job.">
      {detail.requests.map(item => <LifecycleCard key={item.id} title={item.number} status={item.status} copy={item.details}>
        {canEdit && item.status === "new" && <button className="secondary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/requests/${item.id}/qualify` })}>Qualify</button>}
        {canEdit && ["new", "qualified"].includes(item.status) && <><button className="primary" onClick={() => setModal({ kind: "quote", requestId: item.id })}>Prepare quote</button><button className="secondary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/requests/${item.id}/convert-to-job` })}>Skip quote → Job</button></>}
      </LifecycleCard>)}
    </LifecycleSection>

    <LifecycleSection icon={<Send size={18} />} title="2. Quote" description="A quote is a commercial document in its own lifecycle. Sending freezes the customer snapshot; acceptance can create the job.">
      {detail.quotes.length ? detail.quotes.map(item => <LifecycleCard key={item.id} title={`${item.number} · ${money(item.total_minor, item.currency)}`} status={item.status} copy={item.expires_at ? `Expires ${item.expires_at}` : "No expiry set"}>
        {canEdit && item.status === "draft" && <button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/quotes/${item.id}/send` })}>Send quote</button>}
        {canEdit && item.status === "sent" && <><button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/quotes/${item.id}/accept` })}>Accept</button><button className="secondary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/quotes/${item.id}/reject` })}>Reject</button></>}
        {canEdit && item.status === "accepted" && !detail.jobs.some(job => job.id && (job as Job & { quote_id?: string }).quote_id === item.id) && <button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/quotes/${item.id}/create-job` })}>Create job</button>}
      </LifecycleCard>) : <EmptyStep copy="No quote required yet — requests can legitimately go directly to a job." />}
    </LifecycleSection>

    <LifecycleSection icon={<Hammer size={18} />} title="3. Job & visits" description="The job is the work obligation; visits are scheduled attendances. A job can span more than one visit without duplicating the quote or invoice.">
      {detail.jobs.length ? detail.jobs.map(job => <LifecycleCard key={job.id} title={`${job.number} · ${job.title}`} status={job.status} copy={job.next_visit_at ? `Next visit ${new Date(job.next_visit_at).toLocaleString("en-GB")}` : job.completed_at ? `Completed ${new Date(job.completed_at).toLocaleString("en-GB")}` : "No visit scheduled"}>
        {canEdit && ["draft", "scheduled"].includes(job.status) && <button className="secondary" onClick={() => setModal({ kind: "visit", jobId: job.id })}><CalendarClock size={14} /> Schedule visit</button>}
        {canEdit && ["draft", "scheduled"].includes(job.status) && <button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/jobs/${job.id}/start` })}>Start job</button>}
        {canEdit && job.status === "in_progress" && <button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/jobs/${job.id}/complete` })}><CheckCircle2 size={14} /> Complete job</button>}
        {canEdit && job.status === "completed" && <button className="primary" onClick={() => setModal({ kind: "invoice", jobId: job.id, caseId: detail.id })}><ReceiptText size={14} /> Create invoice</button>}
      </LifecycleCard>) : <EmptyStep copy="No job yet. Accept a quote or convert a request directly to work." />}
    </LifecycleSection>

    <LifecycleSection icon={<ReceiptText size={18} />} title="4. Invoice & payment" description="Invoices are financial documents, not Orders. Issuing freezes legal/customer details and payments are append-only allocations against the invoice.">
      {detail.invoices.length ? detail.invoices.map(invoice => {
        const paid = invoice.paid_minor || 0;
        const outstanding = Math.max(0, invoice.total_minor - paid);
        return <LifecycleCard key={invoice.id} title={`${invoice.number} · ${money(invoice.total_minor, invoice.currency)}`} status={invoice.status} copy={`${money(outstanding, invoice.currency)} outstanding${invoice.due_date ? ` · due ${invoice.due_date}` : ""}`}>
          {canEdit && invoice.status === "draft" && <button className="primary" disabled={transition.isPending} onClick={() => transition.mutate({ path: `/service/invoices/${invoice.id}/issue` })}>Issue invoice</button>}
          {canEdit && ["issued", "partially_paid"].includes(invoice.status) && outstanding > 0 && <button className="primary" onClick={() => setModal({ kind: "payment", invoiceId: invoice.id, outstandingMinor: outstanding, currency: invoice.currency })}><WalletCards size={14} /> Record payment</button>}
        </LifecycleCard>;
      }) : <EmptyStep copy="Complete a job, then create the invoice for the delivered work." />}
    </LifecycleSection>
  </div>;
}

function LifecycleSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="service-stage"><div className="service-stage-title"><span>{icon}</span><div><h3>{title}</h3><p>{description}</p></div></div><div className="service-stage-body">{children}</div></section>;
}
function LifecycleCard({ title, status, copy, children }: { title: string; status: string; copy: string; children: React.ReactNode }) {
  return <article className="service-record"><div><div className="service-record-title"><strong>{title}</strong><Status value={status} /></div><p>{copy}</p></div><div className="service-record-actions">{children}</div></article>;
}
function EmptyStep({ copy }: { copy: string }) { return <div className="service-step-empty">{copy}</div>; }

function RequestModal({ tenant, contacts, onClose, onCreated }: { tenant: OrganizationSummary; contacts: Contact[]; onClose: () => void; onCreated: (caseId: string) => void | Promise<void> }) {
  const [contactId, setContactId] = useState(contacts[0]?.id || "");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requestedFor, setRequestedFor] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const create = useMutation({
    mutationFn: () => tenantApi<{ caseId: string }>(tenant.id, "/service/requests", { method: "POST", body: JSON.stringify({ contactId, title, details, requestedFor: requestedFor || undefined, siteAddress: line1 || city || postcode ? { line1, city, postcode, country: "GB" } : undefined }) }),
    onSuccess: data => onCreated(data.caseId),
  });
  return <Modal title="New service request" subtitle="Start the service lifecycle from a CRM prospect/customer. A request creates a service case, not a sales order." onClose={onClose} wide><form className="form-grid two" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
    <Field label="CRM contact"><select required value={contactId} onChange={event => setContactId(event.target.value)}><option value="">Select a contact…</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name} · {contact.lifecycle_stage}</option>)}</select></Field>
    <Field label="Requested timing"><input value={requestedFor} onChange={event => setRequestedFor(event.target.value)} placeholder="e.g. Friday morning" /></Field>
    <Field label="Work title"><input required autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Kitchen sockets tripping" /></Field>
    <Field label="Site address line 1"><input value={line1} onChange={event => setLine1(event.target.value)} /></Field>
    <Field label="Town / city"><input value={city} onChange={event => setCity(event.target.value)} /></Field>
    <Field label="Postcode"><input value={postcode} onChange={event => setPostcode(event.target.value)} /></Field>
    <div className="form-span"><Field label="Request details"><textarea required rows={5} value={details} onChange={event => setDetails(event.target.value)} /></Field></div>
    {create.error && <div className="form-span"><ErrorText error={create.error} /></div>}
    {!contacts.length && <div className="form-span form-error">Add a prospect or customer in CRM before creating a service request.</div>}
    <div className="modal-actions form-span"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={create.isPending || !contactId || !title.trim() || !details.trim()}>Create request</button></div>
  </form></Modal>;
}

function QuoteModal({ tenant, requestId, onClose, onDone }: { tenant: OrganizationSummary; requestId: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [description, setDescription] = useState("Labour and service");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState("20");
  const [expiresAt, setExpiresAt] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/service/requests/${requestId}/convert-to-quote`, { method: "POST", body: JSON.stringify({ expiresAt: expiresAt || undefined, lines: [{ lineType: "service", description, quantityMilli: Math.round(Number(quantity) * 1000), unitPriceMinor: pounds(price), taxRateBps: Math.round(Number(vat) * 100) }] }) }), onSuccess: onDone });
  return <Modal title="Prepare quote" subtitle="Commercial values live on the quote. Quantities support fractional labour without floating-point storage." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <Field label="Description"><input required value={description} onChange={event => setDescription(event.target.value)} /></Field>
    <Field label="Quantity / hours"><input type="number" min="0.001" step="0.001" required value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
    <Field label="Unit price (£)"><input type="number" min="0" step="0.01" required value={price} onChange={event => setPrice(event.target.value)} /></Field>
    <Field label="VAT / tax (%)"><input type="number" min="0" step="0.01" value={vat} onChange={event => setVat(event.target.value)} /></Field>
    <Field label="Expiry"><input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></Field>
    {mutation.error && <ErrorText error={mutation.error} />}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !description.trim() || !price}>Create draft quote</button></div>
  </form></Modal>;
}

function VisitModal({ tenant, jobId, onClose, onDone }: { tenant: OrganizationSummary; jobId: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/service/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify({ scheduledStart: start ? new Date(start).toISOString() : "", scheduledEnd: end ? new Date(end).toISOString() : undefined }) }), onSuccess: onDone });
  return <Modal title="Schedule visit" subtitle="Visits are separate from the job so one job can have multiple attendances." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <Field label="Start"><input type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></Field>
    <Field label="End"><input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></Field>
    {mutation.error && <ErrorText error={mutation.error} />}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !start}>Schedule</button></div>
  </form></Modal>;
}

function InvoiceModal({ tenant, caseId, jobId, onClose, onDone }: { tenant: OrganizationSummary; caseId: string; jobId: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [description, setDescription] = useState("Completed service work");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [vat, setVat] = useState("20");
  const [dueDate, setDueDate] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/service/invoices", { method: "POST", body: JSON.stringify({ caseId, jobId, dueDate: dueDate || undefined, lines: [{ lineType: "service", description, quantityMilli: Math.round(Number(quantity) * 1000), unitPriceMinor: pounds(price), taxRateBps: Math.round(Number(vat) * 100) }] }) }), onSuccess: onDone });
  return <Modal title="Create invoice" subtitle="Create a draft financial document for this completed job. Issue it separately to freeze invoice/customer details." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <Field label="Description"><input required value={description} onChange={event => setDescription(event.target.value)} /></Field>
    <Field label="Quantity / hours"><input type="number" min="0.001" step="0.001" required value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
    <Field label="Unit price (£)"><input type="number" min="0" step="0.01" required value={price} onChange={event => setPrice(event.target.value)} /></Field>
    <Field label="VAT / tax (%)"><input type="number" min="0" step="0.01" value={vat} onChange={event => setVat(event.target.value)} /></Field>
    <Field label="Due date"><input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></Field>
    {mutation.error && <ErrorText error={mutation.error} />}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !description.trim() || !price}>Create draft invoice</button></div>
  </form></Modal>;
}

function PaymentModal({ tenant, invoiceId, outstandingMinor, currency, onClose, onDone }: { tenant: OrganizationSummary; invoiceId: string; outstandingMinor: number; currency: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [amount, setAmount] = useState((outstandingMinor / 100).toFixed(2));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/service/invoices/${invoiceId}/payments`, { method: "POST", body: JSON.stringify({ amountMinor: pounds(amount), method, reference: reference || undefined }) }), onSuccess: onDone });
  return <Modal title="Record payment" subtitle={`Outstanding balance ${money(outstandingMinor, currency)}. Payments are append-only allocations against the issued invoice.`} onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <Field label="Amount (£)"><input type="number" min="0.01" max={(outstandingMinor / 100).toFixed(2)} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></Field>
    <Field label="Method"><select value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select></Field>
    <Field label="Reference"><input value={reference} onChange={event => setReference(event.target.value)} /></Field>
    {mutation.error && <ErrorText error={mutation.error} />}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || pounds(amount) <= 0 || pounds(amount) > outstandingMinor}>Record payment</button></div>
  </form></Modal>;
}
