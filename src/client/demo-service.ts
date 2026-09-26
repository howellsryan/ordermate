import { getDemoProfile } from "./demo-profiles";

const DEMO_SERVICE_KEY = "operating-layer:demo-service:v1";

type Stage = "prospect" | "customer";
type Contact = { id: string; lifecycle_stage: Stage; name: string; email: string | null; mobile: string | null; address: Record<string, unknown> | null; notes: string | null; source: string | null; converted_at: string | null; created_at: string; updated_at: string };
type RequestRecord = { id: string; case_id: string; number: string; status: string; details: string; requested_for: string | null; created_at: string; updated_at: string };
type QuoteRecord = { id: string; case_id: string; number: string; status: string; currency: string; notes: string | null; subtotal_minor: number; tax_minor: number; total_minor: number; expires_at: string | null; created_at: string; updated_at: string };
type VisitRecord = { id: string; job_id: string; status: string; scheduled_start: string; scheduled_end: string | null; created_at: string; updated_at: string };
type JobRecord = { id: string; case_id: string; quote_id: string | null; number: string; status: string; title: string; completed_at: string | null; created_at: string; updated_at: string };
type InvoiceRecord = { id: string; case_id: string; job_id: string | null; number: string; status: string; currency: string; subtotal_minor: number; tax_minor: number; total_minor: number; paid_minor: number; supply_date: string | null; issue_date: string | null; due_date: string | null; created_at: string; updated_at: string };
type CaseRecord = { id: string; number: string; contact_id: string; title: string; summary: string | null; source: string | null; site_address: Record<string, unknown> | null; status: string; created_at: string; updated_at: string };
type DemoServiceState = { profile: string; contacts: Contact[]; cases: CaseRecord[]; requests: RequestRecord[]; quotes: QuoteRecord[]; jobs: JobRecord[]; visits: VisitRecord[]; invoices: InvoiceRecord[] };

const day = (offset = 0) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); };
const stamp = (offset = 0, hour = 10) => { const date = new Date(); date.setDate(date.getDate() + offset); date.setHours(hour, 0, 0, 0); return date.toISOString(); };
const id = () => crypto.randomUUID();

function contact(seed: Partial<Contact> & Pick<Contact, "id" | "name" | "lifecycle_stage">): Contact {
  return { email: null, mobile: null, address: null, notes: null, source: null, converted_at: seed.lifecycle_stage === "customer" ? stamp(-20) : null, created_at: stamp(-30), updated_at: stamp(-2), ...seed };
}

function seedState(): DemoServiceState {
  const profile = getDemoProfile();
  if (profile.key === "electrician") {
    return {
      profile: profile.key,
      contacts: [
        contact({ id: "crm-elec-sarah", lifecycle_stage: "prospect", name: "Sarah Walker", email: "sarah.walker@example.test", mobile: "07700 900221", source: "Website", address: { line1: "18 Lenton Avenue", city: "Nottingham", postcode: "NG7 2AA", country: "GB" }, updated_at: stamp(0, 9) }),
        contact({ id: "crm-elec-martin", lifecycle_stage: "customer", name: "Martin Hughes", email: "martin.hughes@example.test", mobile: "07700 900341", source: "Referral", address: { line1: "42 Trent View", city: "West Bridgford", postcode: "NG2 5FR", country: "GB" }, updated_at: stamp(-1) }),
        contact({ id: "crm-elec-priya", lifecycle_stage: "customer", name: "Priya Shah", email: "priya.shah@example.test", mobile: "07700 900488", source: "Repeat customer", address: { line1: "7 Station Road", city: "Beeston", postcode: "NG9 2AB", country: "GB" }, updated_at: stamp(-3) }),
      ],
      cases: [
        { id: "svc-elec-1", number: "SVC-2026-000031", contact_id: "crm-elec-sarah", title: "EV charger installation", summary: "Assess consumer unit capacity and quote for a 7kW charger.", source: "Website", site_address: { line1: "18 Lenton Avenue", city: "Nottingham", postcode: "NG7 2AA" }, status: "open", created_at: stamp(0, 9), updated_at: stamp(0, 9) },
        { id: "svc-elec-2", number: "SVC-2026-000030", contact_id: "crm-elec-martin", title: "Kitchen ring fault", summary: "Intermittent tripping under appliance load.", source: "Referral", site_address: { line1: "42 Trent View", city: "West Bridgford", postcode: "NG2 5FR" }, status: "won", created_at: stamp(-5), updated_at: stamp(-1) },
        { id: "svc-elec-3", number: "SVC-2026-000029", contact_id: "crm-elec-priya", title: "Replace bathroom extractor", summary: "Completed replacement and isolation test.", source: "Repeat customer", site_address: { line1: "7 Station Road", city: "Beeston", postcode: "NG9 2AB" }, status: "won", created_at: stamp(-10), updated_at: stamp(-3) },
      ],
      requests: [
        { id: "req-elec-1", case_id: "svc-elec-1", number: "REQ-2026-000044", status: "new", details: "Customer has an EV arriving next month and wants a 7kW wall charger installed beside the driveway.", requested_for: "Site survey next week", created_at: stamp(0, 9), updated_at: stamp(0, 9) },
        { id: "req-elec-2", case_id: "svc-elec-2", number: "REQ-2026-000043", status: "converted", details: "Kitchen sockets trip when kettle and toaster run together.", requested_for: "This week", created_at: stamp(-5), updated_at: stamp(-4) },
        { id: "req-elec-3", case_id: "svc-elec-3", number: "REQ-2026-000042", status: "converted", details: "Bathroom fan noisy and no longer clears steam.", requested_for: "Friday", created_at: stamp(-10), updated_at: stamp(-9) },
      ],
      quotes: [
        { id: "q-elec-2", case_id: "svc-elec-2", number: "QTE-2026-000021", status: "accepted", currency: "GBP", notes: "Fault finding plus up to two hours labour.", subtotal_minor: 14000, tax_minor: 2800, total_minor: 16800, expires_at: day(7), created_at: stamp(-4), updated_at: stamp(-3) },
        { id: "q-elec-3", case_id: "svc-elec-3", number: "QTE-2026-000020", status: "accepted", currency: "GBP", notes: null, subtotal_minor: 17500, tax_minor: 3500, total_minor: 21000, expires_at: day(-3), created_at: stamp(-9), updated_at: stamp(-8) },
      ],
      jobs: [
        { id: "job-elec-2", case_id: "svc-elec-2", quote_id: "q-elec-2", number: "JOB-2026-000018", status: "scheduled", title: "Kitchen ring fault", completed_at: null, created_at: stamp(-3), updated_at: stamp(-1) },
        { id: "job-elec-3", case_id: "svc-elec-3", quote_id: "q-elec-3", number: "JOB-2026-000017", status: "completed", title: "Replace bathroom extractor", completed_at: stamp(-4, 15), created_at: stamp(-8), updated_at: stamp(-4, 15) },
      ],
      visits: [
        { id: "visit-elec-2", job_id: "job-elec-2", status: "scheduled", scheduled_start: stamp(2, 9), scheduled_end: stamp(2, 11), created_at: stamp(-1), updated_at: stamp(-1) },
        { id: "visit-elec-3", job_id: "job-elec-3", status: "completed", scheduled_start: stamp(-4, 13), scheduled_end: stamp(-4, 15), created_at: stamp(-7), updated_at: stamp(-4, 15) },
      ],
      invoices: [
        { id: "inv-elec-3", case_id: "svc-elec-3", job_id: "job-elec-3", number: "INV-2026-000015", status: "issued", currency: "GBP", subtotal_minor: 17500, tax_minor: 3500, total_minor: 21000, paid_minor: 0, supply_date: day(-4), issue_date: day(-4), due_date: day(10), created_at: stamp(-4, 16), updated_at: stamp(-4, 16) },
      ],
    };
  }

  if (profile.key === "salon") {
    return {
      profile: profile.key,
      contacts: [
        contact({ id: "crm-salon-amelia", lifecycle_stage: "customer", name: "Amelia Reed", email: "amelia.reed@example.test", mobile: "07700 901101", source: "Instagram", address: { line1: "29 Mapperley Road", city: "Nottingham", postcode: "NG3 5AQ", country: "GB" }, updated_at: stamp(0, 8) }),
        contact({ id: "crm-salon-lucy", lifecycle_stage: "prospect", name: "Lucy Bennett", email: "lucy.bennett@example.test", mobile: "07700 901222", source: "Walk-in", address: { line1: "4 Castle Boulevard", city: "Nottingham", postcode: "NG7 1FB", country: "GB" }, updated_at: stamp(-1) }),
      ],
      cases: [
        { id: "svc-salon-1", number: "SVC-2026-000112", contact_id: "crm-salon-amelia", title: "Balayage refresh + cut", summary: "Colour refresh with toner, treatment and finish.", source: "Instagram", site_address: null, status: "won", created_at: stamp(-6), updated_at: stamp(0, 8) },
        { id: "svc-salon-2", number: "SVC-2026-000113", contact_id: "crm-salon-lucy", title: "Bridal styling consultation", summary: "Initial consultation and trial request.", source: "Walk-in", site_address: null, status: "open", created_at: stamp(-1), updated_at: stamp(-1) },
      ],
      requests: [
        { id: "req-salon-1", case_id: "svc-salon-1", number: "REQ-2026-000151", status: "converted", details: "Existing client wants colour refresh before holiday.", requested_for: "Saturday afternoon", created_at: stamp(-6), updated_at: stamp(-5) },
        { id: "req-salon-2", case_id: "svc-salon-2", number: "REQ-2026-000152", status: "qualified", details: "Wedding in six weeks; wants trial and wedding-day styling options.", requested_for: "Consultation next week", created_at: stamp(-1), updated_at: stamp(-1) },
      ],
      quotes: [
        { id: "q-salon-1", case_id: "svc-salon-1", number: "QTE-2026-000081", status: "accepted", currency: "GBP", notes: "Balayage refresh, toner, treatment and cut/finish.", subtotal_minor: 14500, tax_minor: 2900, total_minor: 17400, expires_at: day(3), created_at: stamp(-5), updated_at: stamp(-4) },
      ],
      jobs: [{ id: "job-salon-1", case_id: "svc-salon-1", quote_id: "q-salon-1", number: "JOB-2026-000074", status: "scheduled", title: "Balayage refresh + cut", completed_at: null, created_at: stamp(-4), updated_at: stamp(0, 8) }],
      visits: [{ id: "visit-salon-1", job_id: "job-salon-1", status: "scheduled", scheduled_start: stamp(1, 13), scheduled_end: stamp(1, 16), created_at: stamp(-4), updated_at: stamp(-4) }],
      invoices: [],
    };
  }

  const contacts: Contact[] = profile.key === "cafe" ? [] : [
    contact({ id: `crm-${profile.key}-1`, lifecycle_stage: "customer", name: profile.key === "retail" ? "Olivia Grant" : profile.key === "dropship" ? "Daniel Moore" : "Trent Retail Group", email: `${profile.key}@customer.example.test`, mobile: "07700 902345", source: "Demo seed", address: { line1: "10 Market Street", city: "Nottingham", postcode: "NG1 6HX", country: "GB" } }),
  ];
  return { profile: profile.key, contacts, cases: [], requests: [], quotes: [], jobs: [], visits: [], invoices: [] };
}

function ensureState(): DemoServiceState {
  const profile = getDemoProfile();
  const raw = window.localStorage.getItem(DEMO_SERVICE_KEY);
  if (raw) {
    try {
      const state = JSON.parse(raw) as DemoServiceState;
      if (state.profile === profile.key) return state;
    } catch { /* reseed below */ }
  }
  const state = seedState();
  persist(state);
  return state;
}

function persist(state: DemoServiceState) {
  window.localStorage.setItem(DEMO_SERVICE_KEY, JSON.stringify(state));
}

export function resetDemoService() {
  window.localStorage.removeItem(DEMO_SERVICE_KEY);
}

function body(init?: RequestInit): Record<string, any> {
  if (typeof init?.body !== "string") return {};
  try { return JSON.parse(init.body) as Record<string, any>; } catch { return {}; }
}

function nextNumber(records: Array<{ number: string }>, prefix: string) {
  const max = records.reduce((value, record) => Math.max(value, Number(record.number.match(/(\d+)$/)?.[1] || 0)), 0);
  return `${prefix}-${new Date().getFullYear()}-${String(max + 1).padStart(6, "0")}`;
}

function lineTotals(lines: Array<{ quantityMilli?: number; unitPriceMinor?: number; taxRateBps?: number }>) {
  return lines.reduce((totals, line) => {
    const net = Math.round((Number(line.unitPriceMinor) || 0) * (Number(line.quantityMilli) || 1000) / 1000);
    const tax = Math.round(net * (Number(line.taxRateBps) || 0) / 10000);
    return { subtotal: totals.subtotal + net, tax: totals.tax + tax, total: totals.total + net + tax };
  }, { subtotal: 0, tax: 0, total: 0 });
}

function convertContact(state: DemoServiceState, contactId: string) {
  const contact = state.contacts.find(item => item.id === contactId);
  if (!contact) return;
  contact.lifecycle_stage = "customer";
  contact.converted_at ||= new Date().toISOString();
  contact.updated_at = new Date().toISOString();
}

export async function demoServiceApi<T>(path: string, init?: RequestInit): Promise<T> {
  const state = ensureState();
  const url = new URL(path, "https://demo.local");
  const method = (init?.method || "GET").toUpperCase();
  const pathname = url.pathname;
  const input = body(init);
  const now = new Date().toISOString();

  if (method === "GET" && pathname === "/crm/contacts") {
    const stage = url.searchParams.get("stage");
    return { contacts: state.contacts.filter(contact => !stage || contact.lifecycle_stage === stage) } as T;
  }
  if (method === "POST" && pathname === "/crm/contacts") {
    const record: Contact = { id: id(), lifecycle_stage: input.lifecycleStage === "customer" ? "customer" : "prospect", name: String(input.name || "Unnamed"), email: input.email || null, mobile: input.mobile || null, address: input.address || null, notes: input.notes || null, source: input.source || null, converted_at: input.lifecycleStage === "customer" ? now : null, created_at: now, updated_at: now };
    state.contacts.unshift(record); persist(state); return { id: record.id } as T;
  }
  const contactMatch = pathname.match(/^\/crm\/contacts\/([^/]+)$/);
  if (contactMatch && method === "GET") {
    const record = state.contacts.find(item => item.id === decodeURIComponent(contactMatch[1]));
    if (!record) throw new Error("CRM contact not found");
    return record as T;
  }
  if (contactMatch && method === "PATCH") {
    const record = state.contacts.find(item => item.id === decodeURIComponent(contactMatch[1]));
    if (!record) throw new Error("CRM contact not found");
    Object.assign(record, { name: input.name ?? record.name, email: input.email ?? record.email, mobile: input.mobile ?? record.mobile, address: input.address ?? record.address, notes: input.notes ?? record.notes, source: input.source ?? record.source, updated_at: now });
    persist(state); return { ok: true } as T;
  }
  const convertMatch = pathname.match(/^\/crm\/contacts\/([^/]+)\/convert$/);
  if (convertMatch && method === "POST") { convertContact(state, decodeURIComponent(convertMatch[1])); persist(state); return { ok: true } as T; }

  if (method === "GET" && pathname === "/service/cases") {
    const cases = state.cases.map(serviceCase => ({ ...serviceCase, contact_name: state.contacts.find(contact => contact.id === serviceCase.contact_id)?.name || "Unknown" })).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { cases } as T;
  }
  const caseMatch = pathname.match(/^\/service\/cases\/([^/]+)$/);
  if (caseMatch && method === "GET") {
    const serviceCase = state.cases.find(item => item.id === decodeURIComponent(caseMatch[1]));
    if (!serviceCase) throw new Error("Service case not found");
    const contact = state.contacts.find(item => item.id === serviceCase.contact_id);
    return {
      ...serviceCase,
      contact_name: contact?.name || "Unknown",
      requests: state.requests.filter(item => item.case_id === serviceCase.id),
      quotes: state.quotes.filter(item => item.case_id === serviceCase.id),
      jobs: state.jobs.filter(item => item.case_id === serviceCase.id).map(job => ({ ...job, next_visit_at: state.visits.filter(visit => visit.job_id === job.id && visit.status === "scheduled").sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0]?.scheduled_start || null })),
      invoices: state.invoices.filter(item => item.case_id === serviceCase.id),
    } as T;
  }
  if (method === "POST" && pathname === "/service/requests") {
    const contactRecord = state.contacts.find(item => item.id === input.contactId);
    if (!contactRecord) throw new Error("CRM contact not found");
    const caseRecord: CaseRecord = { id: id(), number: nextNumber(state.cases, "SVC"), contact_id: input.contactId, title: String(input.title), summary: input.summary || null, source: input.source || null, site_address: input.siteAddress || contactRecord.address, status: "open", created_at: now, updated_at: now };
    const requestRecord: RequestRecord = { id: id(), case_id: caseRecord.id, number: nextNumber(state.requests, "REQ"), status: "new", details: String(input.details), requested_for: input.requestedFor || null, created_at: now, updated_at: now };
    state.cases.unshift(caseRecord); state.requests.unshift(requestRecord); persist(state);
    return { id: requestRecord.id, caseId: caseRecord.id, caseNumber: caseRecord.number, requestNumber: requestRecord.number } as T;
  }
  const qualifyMatch = pathname.match(/^\/service\/requests\/([^/]+)\/qualify$/);
  if (qualifyMatch && method === "POST") { const record = state.requests.find(item => item.id === qualifyMatch[1]); if (!record || record.status !== "new") throw new Error("Only new requests can be qualified"); record.status = "qualified"; record.updated_at = now; persist(state); return { ok: true } as T; }
  const requestQuoteMatch = pathname.match(/^\/service\/requests\/([^/]+)\/convert-to-quote$/);
  if (requestQuoteMatch && method === "POST") {
    const record = state.requests.find(item => item.id === requestQuoteMatch[1]); if (!record || !["new", "qualified"].includes(record.status)) throw new Error("Request cannot be converted to quote");
    const totals = lineTotals(input.lines || []); const quote: QuoteRecord = { id: id(), case_id: record.case_id, number: nextNumber(state.quotes, "QTE"), status: "draft", currency: "GBP", notes: input.notes || null, subtotal_minor: totals.subtotal, tax_minor: totals.tax, total_minor: totals.total, expires_at: input.expiresAt || null, created_at: now, updated_at: now };
    record.status = "converted"; record.updated_at = now; state.quotes.unshift(quote); persist(state); return { quoteId: quote.id, quoteNumber: quote.number } as T;
  }
  const requestJobMatch = pathname.match(/^\/service\/requests\/([^/]+)\/convert-to-job$/);
  if (requestJobMatch && method === "POST") {
    const record = state.requests.find(item => item.id === requestJobMatch[1]); if (!record || !["new", "qualified"].includes(record.status)) throw new Error("Request cannot be converted to job");
    const serviceCase = state.cases.find(item => item.id === record.case_id)!; const job: JobRecord = { id: id(), case_id: record.case_id, quote_id: null, number: nextNumber(state.jobs, "JOB"), status: "draft", title: input.title || serviceCase.title, completed_at: null, created_at: now, updated_at: now };
    record.status = "converted"; serviceCase.status = "won"; serviceCase.updated_at = now; convertContact(state, serviceCase.contact_id); state.jobs.unshift(job); persist(state); return { jobId: job.id, jobNumber: job.number } as T;
  }

  if (method === "GET" && pathname === "/service/quotes") return { quotes: state.quotes } as T;
  const quoteAction = pathname.match(/^\/service\/quotes\/([^/]+)\/(send|accept|reject|create-job)$/);
  if (quoteAction && method === "POST") {
    const quote = state.quotes.find(item => item.id === quoteAction[1]); if (!quote) throw new Error("Service quote not found");
    if (quoteAction[2] === "send") { if (quote.status !== "draft") throw new Error("Only draft quotes can be sent"); quote.status = "sent"; }
    if (quoteAction[2] === "accept") { if (quote.status !== "sent") throw new Error("Only sent quotes can be accepted"); quote.status = "accepted"; const serviceCase = state.cases.find(item => item.id === quote.case_id)!; serviceCase.status = "won"; convertContact(state, serviceCase.contact_id); }
    if (quoteAction[2] === "reject") { if (quote.status !== "sent") throw new Error("Only sent quotes can be rejected"); quote.status = "rejected"; }
    if (quoteAction[2] === "create-job") {
      if (quote.status !== "accepted") throw new Error("Only accepted quotes can create jobs");
      const existing = state.jobs.find(item => item.quote_id === quote.id); if (existing) return { jobId: existing.id, jobNumber: existing.number, existing: true } as T;
      const serviceCase = state.cases.find(item => item.id === quote.case_id)!; const job: JobRecord = { id: id(), case_id: quote.case_id, quote_id: quote.id, number: nextNumber(state.jobs, "JOB"), status: "draft", title: serviceCase.title, completed_at: null, created_at: now, updated_at: now }; state.jobs.unshift(job); persist(state); return { jobId: job.id, jobNumber: job.number } as T;
    }
    quote.updated_at = now; persist(state); return { ok: true } as T;
  }

  if (method === "GET" && pathname === "/service/jobs") return { jobs: state.jobs } as T;
  const visitMatch = pathname.match(/^\/service\/jobs\/([^/]+)\/visits$/);
  if (visitMatch && method === "POST") { const job = state.jobs.find(item => item.id === visitMatch[1]); if (!job) throw new Error("Service job not found"); const visit: VisitRecord = { id: id(), job_id: job.id, status: "scheduled", scheduled_start: input.scheduledStart, scheduled_end: input.scheduledEnd || null, created_at: now, updated_at: now }; state.visits.unshift(visit); if (job.status === "draft") job.status = "scheduled"; job.updated_at = now; persist(state); return { id: visit.id } as T; }
  const jobAction = pathname.match(/^\/service\/jobs\/([^/]+)\/(start|complete)$/);
  if (jobAction && method === "POST") { const job = state.jobs.find(item => item.id === jobAction[1]); if (!job) throw new Error("Service job not found"); if (jobAction[2] === "start") { if (!["draft", "scheduled"].includes(job.status)) throw new Error("Job cannot be started"); job.status = "in_progress"; } else { if (job.status !== "in_progress") throw new Error("Only in-progress jobs can be completed"); job.status = "completed"; job.completed_at = now; } job.updated_at = now; persist(state); return { ok: true } as T; }

  if (method === "GET" && pathname === "/service/invoices") return { invoices: state.invoices.map(invoice => ({ ...invoice, outstanding_minor: invoice.total_minor - invoice.paid_minor })) } as T;
  if (method === "POST" && pathname === "/service/invoices") { const totals = lineTotals(input.lines || []); const invoice: InvoiceRecord = { id: id(), case_id: input.caseId, job_id: input.jobId || null, number: nextNumber(state.invoices, "INV"), status: "draft", currency: "GBP", subtotal_minor: totals.subtotal, tax_minor: totals.tax, total_minor: totals.total, paid_minor: 0, supply_date: input.supplyDate || null, issue_date: null, due_date: input.dueDate || null, created_at: now, updated_at: now }; state.invoices.unshift(invoice); persist(state); return { invoiceId: invoice.id, invoiceNumber: invoice.number } as T; }
  const issueMatch = pathname.match(/^\/service\/invoices\/([^/]+)\/issue$/);
  if (issueMatch && method === "POST") { const invoice = state.invoices.find(item => item.id === issueMatch[1]); if (!invoice || invoice.status !== "draft") throw new Error("Only draft invoices can be issued"); const job = state.jobs.find(item => item.id === invoice.job_id); invoice.status = "issued"; invoice.issue_date = day(); invoice.supply_date ||= job?.completed_at?.slice(0, 10) || day(); invoice.updated_at = now; persist(state); return { ok: true, issueDate: invoice.issue_date, supplyDate: invoice.supply_date } as T; }
  const paymentMatch = pathname.match(/^\/service\/invoices\/([^/]+)\/payments$/);
  if (paymentMatch && method === "POST") { const invoice = state.invoices.find(item => item.id === paymentMatch[1]); if (!invoice || !["issued", "partially_paid"].includes(invoice.status)) throw new Error("Invoice cannot accept a payment"); const amount = Number(input.amountMinor) || 0; const outstanding = invoice.total_minor - invoice.paid_minor; if (amount <= 0 || amount > outstanding) throw new Error("Payment exceeds the outstanding balance"); invoice.paid_minor += amount; invoice.status = invoice.paid_minor === invoice.total_minor ? "paid" : "partially_paid"; invoice.updated_at = now; persist(state); return { id: id(), status: invoice.status, outstandingMinor: invoice.total_minor - invoice.paid_minor } as T; }

  throw new Error("Demo CRM/service route not found");
}
