import { z } from "zod";
import {
  WORKSPACE_MODULES,
  WORKSPACE_MODULE_KEYS,
  isWorkspaceModuleKey,
  validateModuleConfiguration,
  type WorkspaceModuleKey,
} from "../shared/modules";

type Actor = { id: string; role: string };
type ModuleRow = { module_key: string; enabled: number; updated_at: string; updated_by: string };
type ContactRow = {
  id: string;
  lifecycle_stage: "prospect" | "customer";
  name: string;
  email: string | null;
  mobile: string | null;
  address_json: string | null;
  notes: string | null;
  source: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
};
type ServiceCaseRow = {
  id: string;
  number: string;
  contact_id: string;
  contact_name: string;
  contact_stage: string;
  title: string;
  summary: string | null;
  source: string | null;
  site_address_json: string | null;
  status: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};
type InvoiceRow = {
  id: string;
  case_id: string;
  job_id: string | null;
  number: string;
  status: string;
  total_minor: number;
  currency: string;
  supply_date: string | null;
  issue_date: string | null;
  due_date: string | null;
};

const contactInput = z.object({
  lifecycleStage: z.enum(["prospect", "customer"]).default("prospect"),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional(),
  mobile: z.string().trim().max(80).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(4000).optional(),
  source: z.string().trim().max(120).optional(),
});
const contactPatchInput = contactInput.partial().omit({ lifecycleStage: true });

const requestInput = z.object({
  contactId: z.string().min(1),
  title: z.string().trim().min(1).max(240),
  details: z.string().trim().min(1).max(12000),
  summary: z.string().trim().max(4000).optional(),
  source: z.string().trim().max(120).optional(),
  siteAddress: z.record(z.string(), z.unknown()).optional(),
  requestedFor: z.string().trim().max(120).optional(),
});

const commercialLineInput = z.object({
  lineType: z.enum(["service", "material", "other"]),
  variantId: z.string().min(1).optional(),
  description: z.string().trim().min(1).max(1000),
  quantityMilli: z.number().int().min(1).max(100000000),
  unitPriceMinor: z.number().int().nonnegative(),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
});

const quoteCreateInput = z.object({
  caseId: z.string().min(1),
  notes: z.string().max(8000).optional(),
  expiresAt: z.string().trim().max(80).optional(),
  lines: z.array(commercialLineInput).min(1),
});
const requestQuoteInput = quoteCreateInput.omit({ caseId: true });

const jobCreateInput = z.object({
  caseId: z.string().min(1),
  quoteId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(240),
  siteAddress: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(8000).optional(),
});

const visitInput = z.object({
  scheduledStart: z.string().min(1),
  scheduledEnd: z.string().optional(),
  assignedActorId: z.string().trim().max(200).optional(),
  notes: z.string().max(4000).optional(),
});

const materialInput = z.object({
  visitId: z.string().min(1).optional(),
  variantId: z.string().min(1),
  locationId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const invoiceCreateInput = z.object({
  caseId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  supplyDate: z.string().trim().max(40).optional(),
  dueDate: z.string().trim().max(40).optional(),
  notes: z.string().max(8000).optional(),
  lines: z.array(commercialLineInput).min(1),
});

const paymentInput = z.object({
  amountMinor: z.number().int().positive(),
  method: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(240).optional(),
  paidAt: z.string().trim().max(80).optional(),
});
const modulePatchInput = z.object({ enabled: z.boolean() });

const timestamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const responseError = (message: string, status = 400) => Response.json({ error: message }, { status });

function jsonObject(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export class ServiceRuntime {
  constructor(private readonly ctx: DurableObjectState) {}

  async handle(request: Request): Promise<Response | null> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const method = request.method;

      if (method === "GET" && path === "/modules") return this.listModules();
      const moduleMatch = path.match(/^\/modules\/([^/]+)$/);
      if (method === "PATCH" && moduleMatch) return this.updateModule(decodeURIComponent(moduleMatch[1]), request);

      const requiredModule = this.moduleForPath(path);
      if (requiredModule && !this.moduleEnabled(requiredModule)) {
        return responseError(`${this.moduleLabel(requiredModule)} is disabled for this workspace.`, 404);
      }

      if (method === "GET" && path === "/crm/contacts") return this.listContacts(url);
      if (method === "POST" && path === "/crm/contacts") return this.createContact(request);
      const contactMatch = path.match(/^\/crm\/contacts\/([^/]+)$/);
      if (method === "GET" && contactMatch) return this.getContact(decodeURIComponent(contactMatch[1]));
      if (method === "PATCH" && contactMatch) return this.updateContact(decodeURIComponent(contactMatch[1]), request);
      const contactConvert = path.match(/^\/crm\/contacts\/([^/]+)\/convert$/);
      if (method === "POST" && contactConvert) return this.convertContact(decodeURIComponent(contactConvert[1]), request);

      // Keep the pre-existing commerce customer API in sync with canonical CRM contacts.
      if (method === "POST" && path === "/customers") return this.createCompatibilityCustomer(request);
      const compatibilityCustomer = path.match(/^\/customers\/([^/]+)$/);
      if (method === "PATCH" && compatibilityCustomer) return this.updateCompatibilityCustomer(decodeURIComponent(compatibilityCustomer[1]), request);

      if (method === "GET" && path === "/service/cases") return this.listServiceCases();
      const caseMatch = path.match(/^\/service\/cases\/([^/]+)$/);
      if (method === "GET" && caseMatch) return this.getServiceCase(decodeURIComponent(caseMatch[1]));

      if (method === "POST" && path === "/service/requests") return this.createServiceRequest(request);
      const qualify = path.match(/^\/service\/requests\/([^/]+)\/qualify$/);
      if (method === "POST" && qualify) return this.qualifyRequest(decodeURIComponent(qualify[1]), request);
      const toQuote = path.match(/^\/service\/requests\/([^/]+)\/convert-to-quote$/);
      if (method === "POST" && toQuote) return this.convertRequestToQuote(decodeURIComponent(toQuote[1]), request);
      const toJob = path.match(/^\/service\/requests\/([^/]+)\/convert-to-job$/);
      if (method === "POST" && toJob) return this.convertRequestToJob(decodeURIComponent(toJob[1]), request);

      if (method === "GET" && path === "/service/quotes") return this.listQuotes();
      if (method === "POST" && path === "/service/quotes") return this.createQuote(request);
      const quoteSend = path.match(/^\/service\/quotes\/([^/]+)\/send$/);
      if (method === "POST" && quoteSend) return this.sendQuote(decodeURIComponent(quoteSend[1]), request);
      const quoteAccept = path.match(/^\/service\/quotes\/([^/]+)\/accept$/);
      if (method === "POST" && quoteAccept) return this.acceptQuote(decodeURIComponent(quoteAccept[1]), request);
      const quoteReject = path.match(/^\/service\/quotes\/([^/]+)\/reject$/);
      if (method === "POST" && quoteReject) return this.rejectQuote(decodeURIComponent(quoteReject[1]), request);
      const quoteJob = path.match(/^\/service\/quotes\/([^/]+)\/create-job$/);
      if (method === "POST" && quoteJob) return this.createJobFromQuote(decodeURIComponent(quoteJob[1]), request);

      if (method === "GET" && path === "/service/jobs") return this.listJobs();
      if (method === "POST" && path === "/service/jobs") return this.createJob(request);
      const jobVisit = path.match(/^\/service\/jobs\/([^/]+)\/visits$/);
      if (method === "POST" && jobVisit) return this.createVisit(decodeURIComponent(jobVisit[1]), request);
      const jobStart = path.match(/^\/service\/jobs\/([^/]+)\/start$/);
      if (method === "POST" && jobStart) return this.startJob(decodeURIComponent(jobStart[1]), request);
      const jobComplete = path.match(/^\/service\/jobs\/([^/]+)\/complete$/);
      if (method === "POST" && jobComplete) return this.completeJob(decodeURIComponent(jobComplete[1]), request);
      const jobMaterial = path.match(/^\/service\/jobs\/([^/]+)\/materials$/);
      if (method === "POST" && jobMaterial) return this.postJobMaterial(decodeURIComponent(jobMaterial[1]), request);

      if (method === "GET" && path === "/service/invoices") return this.listInvoices();
      if (method === "POST" && path === "/service/invoices") return this.createInvoice(request);
      const invoiceIssue = path.match(/^\/service\/invoices\/([^/]+)\/issue$/);
      if (method === "POST" && invoiceIssue) return this.issueInvoice(decodeURIComponent(invoiceIssue[1]), request);
      const invoicePayment = path.match(/^\/service\/invoices\/([^/]+)\/payments$/);
      if (method === "POST" && invoicePayment) return this.addInvoicePayment(decodeURIComponent(invoicePayment[1]), request);
      const invoiceVoid = path.match(/^\/service\/invoices\/([^/]+)\/void$/);
      if (method === "POST" && invoiceVoid) return this.voidInvoice(decodeURIComponent(invoiceVoid[1]), request);

      return null;
    } catch (cause) {
      if (cause instanceof z.ZodError) return responseError(cause.issues[0]?.message || "Invalid request", 400);
      console.error("Service runtime request failed", cause);
      return responseError(cause instanceof Error ? cause.message : "Unexpected error", 500);
    }
  }

  private actor(request: Request): Actor {
    return {
      id: request.headers.get("x-ordermate-actor-id") || "system",
      role: request.headers.get("x-ordermate-actor-role") || "unknown",
    };
  }

  private audit(request: Request, action: string, entityType: string, entityId?: string, metadata?: unknown) {
    const actor = this.actor(request);
    this.ctx.storage.sql.exec(
      "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      uid(), actor.id, actor.role, action, entityType, entityId ?? null,
      metadata === undefined ? null : JSON.stringify(metadata), timestamp(),
    );
  }

  private nextNumber(sequence: string, prefix: string) {
    this.ctx.storage.sql.exec("INSERT INTO sequences (name, next_value) VALUES (?, 1) ON CONFLICT(name) DO NOTHING", sequence);
    const row = this.ctx.storage.sql.exec<{ next_value: number }>("SELECT next_value FROM sequences WHERE name = ?", sequence).toArray()[0];
    if (!row) throw new Error(`Sequence ${sequence} is unavailable`);
    this.ctx.storage.sql.exec("UPDATE sequences SET next_value = next_value + 1 WHERE name = ?", sequence);
    return `${prefix}-${new Date().getUTCFullYear()}-${String(row.next_value).padStart(6, "0")}`;
  }

  private moduleRows() {
    return this.ctx.storage.sql.exec<ModuleRow>("SELECT module_key, enabled, updated_at, updated_by FROM workspace_modules ORDER BY module_key").toArray();
  }

  private moduleEnabled(key: WorkspaceModuleKey) {
    return this.ctx.storage.sql.exec<{ enabled: number }>("SELECT enabled FROM workspace_modules WHERE module_key = ?", key).toArray()[0]?.enabled === 1;
  }

  private moduleLabel(key: WorkspaceModuleKey) {
    return WORKSPACE_MODULES.find(module => module.key === key)?.label || key;
  }

  private moduleForPath(path: string): WorkspaceModuleKey | null {
    if (path.startsWith("/crm/") || path === "/customers" || path.startsWith("/customers/")) return "crm";
    if (path.startsWith("/service/")) return "service";
    if (path === "/orders" || path.startsWith("/orders/")) return "orders";
    if (path.startsWith("/inventory") || path === "/locations" || path.startsWith("/locations/")) return "inventory";
    if (path.startsWith("/purchase-orders") || path.startsWith("/suppliers") || path.startsWith("/supplier-variants") || path.startsWith("/replenishment") || path.startsWith("/delivery-discrepancies")) return "purchasing";
    if (path.startsWith("/reports")) return "reports";
    return null;
  }

  private listModules() {
    const rows = new Map(this.moduleRows().map(row => [row.module_key, row]));
    return Response.json({ modules: WORKSPACE_MODULES.map(definition => {
      const row = rows.get(definition.key);
      return { ...definition, enabled: row?.enabled === 1, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null };
    }) });
  }

  private async updateModule(rawKey: string, request: Request) {
    if (!isWorkspaceModuleKey(rawKey)) return responseError("Unknown workspace module", 404);
    const { enabled } = modulePatchInput.parse(await request.json());
    const actor = this.actor(request);
    const current = Object.fromEntries(WORKSPACE_MODULE_KEYS.map(key => [key, this.moduleEnabled(key)])) as Record<WorkspaceModuleKey, boolean>;
    current[rawKey] = enabled;
    const errors = validateModuleConfiguration(current);
    if (errors.length) return responseError(errors.join(" "), 409);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_modules (module_key, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        rawKey, enabled ? 1 : 0, timestamp(), actor.id,
      );
      this.audit(request, "workspace_module.updated", "workspace_module", rawKey, { enabled });
    });
    return this.listModules();
  }

  private contactById(contactId: string) {
    return this.ctx.storage.sql.exec<ContactRow>("SELECT * FROM crm_contacts WHERE id = ?", contactId).toArray()[0];
  }

  private serializeContact(row: ContactRow) {
    return { ...row, address: jsonObject(row.address_json) };
  }

  private listContacts(url: URL) {
    const stage = url.searchParams.get("stage");
    if (stage && stage !== "prospect" && stage !== "customer") return responseError("Invalid CRM lifecycle stage");
    const rows = stage
      ? this.ctx.storage.sql.exec<ContactRow>("SELECT * FROM crm_contacts WHERE lifecycle_stage = ? ORDER BY updated_at DESC, name COLLATE NOCASE", stage).toArray()
      : this.ctx.storage.sql.exec<ContactRow>("SELECT * FROM crm_contacts ORDER BY updated_at DESC, name COLLATE NOCASE").toArray();
    return Response.json({ contacts: rows.map(row => this.serializeContact(row)) });
  }

  private getContact(contactId: string) {
    const row = this.contactById(contactId);
    return row ? Response.json(this.serializeContact(row)) : responseError("CRM contact not found", 404);
  }

  private async createContact(request: Request) {
    const input = contactInput.parse(await request.json());
    const contactId = uid();
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO crm_contacts (id, lifecycle_stage, name, email, mobile, address_json, notes, source, converted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        contactId, input.lifecycleStage, input.name, input.email ?? null, input.mobile ?? null,
        input.address ? JSON.stringify(input.address) : null, input.notes ?? null, input.source ?? null,
        input.lifecycleStage === "customer" ? now : null, now, now,
      );
      if (input.lifecycleStage === "customer") this.ensureCompatibilityCustomer(contactId);
      this.audit(request, "crm_contact.created", "crm_contact", contactId, { lifecycleStage: input.lifecycleStage, name: input.name });
    });
    return Response.json({ id: contactId }, { status: 201 });
  }

  private async updateContact(contactId: string, request: Request) {
    const existing = this.contactById(contactId);
    if (!existing) return responseError("CRM contact not found", 404);
    const input = contactPatchInput.parse(await request.json());
    if (!Object.keys(input).length) return responseError("No CRM contact fields supplied");
    const next = {
      name: input.name ?? existing.name,
      email: input.email === undefined ? existing.email : input.email || null,
      mobile: input.mobile === undefined ? existing.mobile : input.mobile || null,
      addressJson: input.address === undefined ? existing.address_json : JSON.stringify(input.address),
      notes: input.notes === undefined ? existing.notes : input.notes || null,
      source: input.source === undefined ? existing.source : input.source || null,
    };
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE crm_contacts SET name = ?, email = ?, mobile = ?, address_json = ?, notes = ?, source = ?, updated_at = ? WHERE id = ?",
        next.name, next.email, next.mobile, next.addressJson, next.notes, next.source, now, contactId,
      );
      if (existing.lifecycle_stage === "customer") this.syncCompatibilityCustomer(contactId);
      this.audit(request, "crm_contact.updated", "crm_contact", contactId);
    });
    return Response.json({ ok: true });
  }

  private convertContactInternal(contactId: string, request: Request) {
    const existing = this.contactById(contactId);
    if (!existing) return false;
    if (existing.lifecycle_stage === "customer") {
      this.ensureCompatibilityCustomer(contactId);
      return true;
    }
    const now = timestamp();
    this.ctx.storage.sql.exec("UPDATE crm_contacts SET lifecycle_stage = 'customer', converted_at = ?, updated_at = ? WHERE id = ?", now, now, contactId);
    this.ensureCompatibilityCustomer(contactId);
    this.audit(request, "crm_contact.converted", "crm_contact", contactId);
    return true;
  }

  private convertContact(contactId: string, request: Request) {
    if (!this.contactById(contactId)) return responseError("CRM contact not found", 404);
    this.ctx.storage.transactionSync(() => { this.convertContactInternal(contactId, request); });
    return Response.json({ ok: true });
  }

  private ensureCompatibilityCustomer(contactId: string) {
    const contact = this.contactById(contactId);
    if (!contact) throw new Error("CRM contact not found");
    const existing = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM customers WHERE crm_contact_id = ? OR id = ?", contactId, contactId).toArray()[0];
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE customers SET crm_contact_id = COALESCE(crm_contact_id, ?), name = ?, email = ?, phone = ?, address_json = ?, notes = ?, updated_at = ? WHERE id = ?",
        contactId, contact.name, contact.email, contact.mobile, contact.address_json, contact.notes, timestamp(), existing.id,
      );
      return existing.id;
    }
    const now = timestamp();
    this.ctx.storage.sql.exec(
      "INSERT INTO customers (id, name, email, phone, address_json, notes, crm_contact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      contactId, contact.name, contact.email, contact.mobile, contact.address_json, contact.notes, contactId, now, now,
    );
    return contactId;
  }

  private syncCompatibilityCustomer(contactId: string) {
    const contact = this.contactById(contactId);
    if (!contact) return;
    this.ctx.storage.sql.exec(
      "UPDATE customers SET name = ?, email = ?, phone = ?, address_json = ?, notes = ?, updated_at = ? WHERE crm_contact_id = ? OR id = ?",
      contact.name, contact.email, contact.mobile, contact.address_json, contact.notes, timestamp(), contactId, contactId,
    );
  }

  private async createCompatibilityCustomer(request: Request) {
    const raw = z.object({
      name: z.string().trim().min(1).max(200), email: z.string().trim().email().optional(),
      phone: z.string().trim().max(80).optional(), address: z.record(z.string(), z.unknown()).optional(), notes: z.string().max(4000).optional(),
    }).parse(await request.json());
    const contactId = uid();
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO crm_contacts (id, lifecycle_stage, name, email, mobile, address_json, notes, source, converted_at, created_at, updated_at)
         VALUES (?, 'customer', ?, ?, ?, ?, ?, 'commerce', ?, ?, ?)`,
        contactId, raw.name, raw.email ?? null, raw.phone ?? null, raw.address ? JSON.stringify(raw.address) : null, raw.notes ?? null, now, now, now,
      );
      this.ensureCompatibilityCustomer(contactId);
      this.audit(request, "customer.created", "customer", contactId, { name: raw.name, crmContactId: contactId });
      this.audit(request, "crm_contact.created", "crm_contact", contactId, { lifecycleStage: "customer", source: "commerce" });
    });
    return Response.json({ id: contactId }, { status: 201 });
  }

  private async updateCompatibilityCustomer(customerId: string, request: Request) {
    const legacy = this.ctx.storage.sql.exec<{ id: string; crm_contact_id: string | null }>("SELECT id, crm_contact_id FROM customers WHERE id = ?", customerId).toArray()[0];
    if (!legacy) return responseError("Customer not found", 404);
    const raw = z.object({
      name: z.string().trim().min(1).max(200), email: z.string().trim().email().optional(), phone: z.string().trim().max(80).optional(), notes: z.string().max(4000).optional(),
    }).parse(await request.json());
    const contactId = legacy.crm_contact_id || customerId;
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      if (!this.contactById(contactId)) {
        this.ctx.storage.sql.exec(
          `INSERT INTO crm_contacts (id, lifecycle_stage, name, email, mobile, notes, source, converted_at, created_at, updated_at)
           VALUES (?, 'customer', ?, ?, ?, ?, 'commerce', ?, ?, ?)`,
          contactId, raw.name, raw.email ?? null, raw.phone ?? null, raw.notes ?? null, now, now, now,
        );
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE crm_contacts SET lifecycle_stage = 'customer', name = ?, email = ?, mobile = ?, notes = ?, converted_at = COALESCE(converted_at, ?), updated_at = ? WHERE id = ?",
          raw.name, raw.email ?? null, raw.phone ?? null, raw.notes ?? null, now, now, contactId,
        );
      }
      this.ctx.storage.sql.exec(
        "UPDATE customers SET crm_contact_id = ?, name = ?, email = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?",
        contactId, raw.name, raw.email ?? null, raw.phone ?? null, raw.notes ?? null, now, customerId,
      );
      this.audit(request, "customer.updated", "customer", customerId, { crmContactId: contactId });
    });
    return Response.json({ ok: true });
  }

  private listServiceCases() {
    const rows = this.ctx.storage.sql.exec<ServiceCaseRow>(
      `SELECT sc.id, sc.number, sc.contact_id, c.name AS contact_name, c.lifecycle_stage AS contact_stage,
              sc.title, sc.summary, sc.source, sc.site_address_json, sc.status, sc.closed_at, sc.created_at, sc.updated_at
       FROM service_cases sc JOIN crm_contacts c ON c.id = sc.contact_id ORDER BY sc.updated_at DESC`,
    ).toArray();
    return Response.json({ cases: rows.map(row => ({ ...row, site_address: jsonObject(row.site_address_json) })) });
  }

  private getServiceCase(caseId: string) {
    const row = this.ctx.storage.sql.exec<ServiceCaseRow>(
      `SELECT sc.id, sc.number, sc.contact_id, c.name AS contact_name, c.lifecycle_stage AS contact_stage,
              sc.title, sc.summary, sc.source, sc.site_address_json, sc.status, sc.closed_at, sc.created_at, sc.updated_at
       FROM service_cases sc JOIN crm_contacts c ON c.id = sc.contact_id WHERE sc.id = ?`, caseId,
    ).toArray()[0];
    if (!row) return responseError("Service case not found", 404);
    const requests = this.ctx.storage.sql.exec("SELECT * FROM service_requests WHERE case_id = ? ORDER BY created_at DESC", caseId).toArray();
    const quotes = this.ctx.storage.sql.exec("SELECT * FROM service_quotes WHERE case_id = ? ORDER BY created_at DESC", caseId).toArray();
    const jobs = this.ctx.storage.sql.exec("SELECT * FROM service_jobs WHERE case_id = ? ORDER BY created_at DESC", caseId).toArray();
    const invoices = this.ctx.storage.sql.exec(
      `SELECT i.*, COALESCE((SELECT SUM(p.amount_minor) FROM service_payments p WHERE p.invoice_id = i.id), 0) AS paid_minor
       FROM service_invoices i WHERE i.case_id = ? ORDER BY i.created_at DESC`, caseId,
    ).toArray();
    return Response.json({ ...row, site_address: jsonObject(row.site_address_json), requests, quotes, jobs, invoices });
  }

  private async createServiceRequest(request: Request) {
    const input = requestInput.parse(await request.json());
    if (!this.contactById(input.contactId)) return responseError("CRM contact not found", 404);
    const caseId = uid();
    const requestId = uid();
    const now = timestamp();
    let caseNumber = "";
    let requestNumber = "";
    this.ctx.storage.transactionSync(() => {
      caseNumber = this.nextNumber("service_case", "SVC");
      requestNumber = this.nextNumber("service_request", "REQ");
      this.ctx.storage.sql.exec(
        `INSERT INTO service_cases (id, number, contact_id, title, summary, source, site_address_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        caseId, caseNumber, input.contactId, input.title, input.summary ?? null, input.source ?? null,
        input.siteAddress ? JSON.stringify(input.siteAddress) : null, now, now,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO service_requests (id, case_id, number, status, details, requested_for, created_at, updated_at) VALUES (?, ?, ?, 'new', ?, ?, ?, ?)",
        requestId, caseId, requestNumber, input.details, input.requestedFor ?? null, now, now,
      );
      this.audit(request, "service_request.created", "service_request", requestId, { caseId, caseNumber, requestNumber });
    });
    return Response.json({ id: requestId, caseId, caseNumber, requestNumber }, { status: 201 });
  }

  private requestRow(requestId: string) {
    return this.ctx.storage.sql.exec<{ id: string; case_id: string; status: string; contact_id: string; case_title: string; site_address_json: string | null }>(
      `SELECT r.id, r.case_id, r.status, sc.contact_id, sc.title AS case_title, sc.site_address_json
       FROM service_requests r JOIN service_cases sc ON sc.id = r.case_id WHERE r.id = ?`, requestId,
    ).toArray()[0];
  }

  private qualifyRequest(requestId: string, request: Request) {
    const row = this.requestRow(requestId);
    if (!row) return responseError("Service request not found", 404);
    if (row.status !== "new") return responseError(`Only new requests can be qualified; current status is ${row.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_requests SET status = 'qualified', qualified_at = ?, updated_at = ? WHERE id = ?", now, now, requestId);
      this.audit(request, "service_request.qualified", "service_request", requestId, { caseId: row.case_id });
    });
    return Response.json({ ok: true });
  }

  private async convertRequestToQuote(requestId: string, request: Request) {
    const row = this.requestRow(requestId);
    if (!row) return responseError("Service request not found", 404);
    if (!new Set(["new", "qualified"]).has(row.status)) return responseError(`Request cannot convert from ${row.status}.`, 409);
    const input = requestQuoteInput.parse(await request.json());
    let quoteId = "";
    let quoteNumber = "";
    this.ctx.storage.transactionSync(() => {
      ({ quoteId, quoteNumber } = this.insertQuote(row.case_id, input, request));
      const now = timestamp();
      this.ctx.storage.sql.exec("UPDATE service_requests SET status = 'converted', converted_at = ?, updated_at = ? WHERE id = ?", now, now, requestId);
      this.audit(request, "service_request.converted_to_quote", "service_request", requestId, { quoteId, quoteNumber });
    });
    return Response.json({ quoteId, quoteNumber }, { status: 201 });
  }

  private async convertRequestToJob(requestId: string, request: Request) {
    const row = this.requestRow(requestId);
    if (!row) return responseError("Service request not found", 404);
    if (!new Set(["new", "qualified"]).has(row.status)) return responseError(`Request cannot convert from ${row.status}.`, 409);
    const body = z.object({ title: z.string().trim().min(1).max(240).optional(), siteAddress: z.record(z.string(), z.unknown()).optional(), notes: z.string().max(8000).optional() })
      .parse(await request.json().catch(() => ({})));
    let jobId = "";
    let jobNumber = "";
    this.ctx.storage.transactionSync(() => {
      ({ jobId, jobNumber } = this.insertJob({
        caseId: row.case_id, title: body.title || row.case_title,
        siteAddressJson: body.siteAddress ? JSON.stringify(body.siteAddress) : row.site_address_json,
        notes: body.notes ?? null, quoteId: null,
      }, request));
      const now = timestamp();
      this.ctx.storage.sql.exec("UPDATE service_requests SET status = 'converted', converted_at = ?, updated_at = ? WHERE id = ?", now, now, requestId);
      this.ctx.storage.sql.exec("UPDATE service_cases SET status = 'won', updated_at = ? WHERE id = ?", now, row.case_id);
      this.convertContactInternal(row.contact_id, request);
      this.audit(request, "service_request.converted_to_job", "service_request", requestId, { jobId, jobNumber });
    });
    return Response.json({ jobId, jobNumber }, { status: 201 });
  }

  private calculateLines(lines: z.infer<typeof commercialLineInput>[]) {
    const inclusive = this.ctx.storage.sql.exec<{ prices_include_tax: number }>("SELECT prices_include_tax FROM tenant_settings WHERE id = 1").toArray()[0]?.prices_include_tax === 1;
    const calculated = lines.map(line => {
      const grossOrNet = Math.round(line.unitPriceMinor * line.quantityMilli / 1000);
      if (inclusive) {
        const net = Math.round(grossOrNet * 10000 / (10000 + line.taxRateBps));
        return { ...line, net, tax: grossOrNet - net, gross: grossOrNet };
      }
      const net = grossOrNet;
      const tax = Math.round(net * line.taxRateBps / 10000);
      return { ...line, net, tax, gross: net + tax };
    });
    return {
      lines: calculated,
      subtotal: calculated.reduce((sum, line) => sum + line.net, 0),
      tax: calculated.reduce((sum, line) => sum + line.tax, 0),
      total: calculated.reduce((sum, line) => sum + line.gross, 0),
    };
  }

  private insertQuote(caseId: string, input: z.infer<typeof requestQuoteInput> | z.infer<typeof quoteCreateInput>, request: Request) {
    if (!this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM service_cases WHERE id = ?", caseId).toArray()[0]) throw new Error("Service case not found");
    const currency = this.ctx.storage.sql.exec<{ currency: string }>("SELECT currency FROM tenant_settings WHERE id = 1").toArray()[0]?.currency || "GBP";
    const totals = this.calculateLines(input.lines);
    const quoteId = uid();
    const quoteNumber = this.nextNumber("service_quote", "QTE");
    const now = timestamp();
    this.ctx.storage.sql.exec(
      `INSERT INTO service_quotes (id, case_id, number, status, currency, notes, subtotal_minor, tax_minor, total_minor, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      quoteId, caseId, quoteNumber, currency, input.notes ?? null, totals.subtotal, totals.tax, totals.total, input.expiresAt ?? null, now, now,
    );
    for (const line of totals.lines) {
      if (line.variantId && !this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM product_variants WHERE id = ?", line.variantId).toArray()[0]) throw new Error("Quote line product variant not found");
      this.ctx.storage.sql.exec(
        `INSERT INTO service_quote_lines (id, quote_id, line_type, variant_id, description_snapshot, quantity_milli, unit_price_minor, tax_rate_bps, net_minor, tax_minor, gross_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid(), quoteId, line.lineType, line.variantId ?? null, line.description, line.quantityMilli, line.unitPriceMinor, line.taxRateBps, line.net, line.tax, line.gross,
      );
    }
    this.audit(request, "service_quote.created", "service_quote", quoteId, { caseId, quoteNumber, totalMinor: totals.total });
    return { quoteId, quoteNumber };
  }

  private listQuotes() {
    return Response.json({ quotes: this.ctx.storage.sql.exec(
      `SELECT q.*, c.name AS customer_name FROM service_quotes q
       JOIN service_cases sc ON sc.id = q.case_id JOIN crm_contacts c ON c.id = sc.contact_id ORDER BY q.updated_at DESC`,
    ).toArray() });
  }

  private async createQuote(request: Request) {
    const input = quoteCreateInput.parse(await request.json());
    let result!: { quoteId: string; quoteNumber: string };
    this.ctx.storage.transactionSync(() => { result = this.insertQuote(input.caseId, input, request); });
    return Response.json(result, { status: 201 });
  }

  private quoteContext(quoteId: string) {
    return this.ctx.storage.sql.exec<{ id: string; case_id: string; status: string; contact_id: string; name: string; email: string | null; mobile: string | null; address_json: string | null }>(
      `SELECT q.id, q.case_id, q.status, sc.contact_id, c.name, c.email, c.mobile, c.address_json
       FROM service_quotes q JOIN service_cases sc ON sc.id = q.case_id JOIN crm_contacts c ON c.id = sc.contact_id WHERE q.id = ?`, quoteId,
    ).toArray()[0];
  }

  private sendQuote(quoteId: string, request: Request) {
    const row = this.quoteContext(quoteId);
    if (!row) return responseError("Service quote not found", 404);
    if (row.status !== "draft") return responseError(`Only draft quotes can be sent; current status is ${row.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE service_quotes SET status = 'sent', customer_name_snapshot = ?, customer_email_snapshot = ?, customer_mobile_snapshot = ?,
         customer_address_json_snapshot = ?, sent_at = ?, updated_at = ? WHERE id = ?`,
        row.name, row.email, row.mobile, row.address_json, now, now, quoteId,
      );
      this.audit(request, "service_quote.sent", "service_quote", quoteId, { caseId: row.case_id });
    });
    return Response.json({ ok: true });
  }

  private acceptQuote(quoteId: string, request: Request) {
    const row = this.quoteContext(quoteId);
    if (!row) return responseError("Service quote not found", 404);
    if (row.status !== "sent") return responseError(`Only sent quotes can be accepted; current status is ${row.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_quotes SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?", now, now, quoteId);
      this.ctx.storage.sql.exec("UPDATE service_cases SET status = 'won', updated_at = ? WHERE id = ?", now, row.case_id);
      this.convertContactInternal(row.contact_id, request);
      this.audit(request, "service_quote.accepted", "service_quote", quoteId, { caseId: row.case_id });
    });
    return Response.json({ ok: true });
  }

  private rejectQuote(quoteId: string, request: Request) {
    const row = this.quoteContext(quoteId);
    if (!row) return responseError("Service quote not found", 404);
    if (row.status !== "sent") return responseError(`Only sent quotes can be rejected; current status is ${row.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_quotes SET status = 'rejected', updated_at = ? WHERE id = ?", now, quoteId);
      this.audit(request, "service_quote.rejected", "service_quote", quoteId, { caseId: row.case_id });
    });
    return Response.json({ ok: true });
  }

  private insertJob(input: { caseId: string; quoteId: string | null; title: string; siteAddressJson: string | null; notes: string | null }, request: Request) {
    const jobId = uid();
    const jobNumber = this.nextNumber("service_job", "JOB");
    const now = timestamp();
    this.ctx.storage.sql.exec(
      "INSERT INTO service_jobs (id, case_id, quote_id, number, status, title, site_address_json, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
      jobId, input.caseId, input.quoteId, jobNumber, input.title, input.siteAddressJson, input.notes, now, now,
    );
    this.audit(request, "service_job.created", "service_job", jobId, { caseId: input.caseId, quoteId: input.quoteId, jobNumber });
    return { jobId, jobNumber };
  }

  private async createJob(request: Request) {
    const input = jobCreateInput.parse(await request.json());
    const serviceCase = this.ctx.storage.sql.exec<{ id: string; contact_id: string; site_address_json: string | null }>("SELECT id, contact_id, site_address_json FROM service_cases WHERE id = ?", input.caseId).toArray()[0];
    if (!serviceCase) return responseError("Service case not found", 404);
    if (input.quoteId) {
      const quote = this.ctx.storage.sql.exec<{ id: string; case_id: string; status: string }>("SELECT id, case_id, status FROM service_quotes WHERE id = ?", input.quoteId).toArray()[0];
      if (!quote || quote.case_id !== input.caseId) return responseError("Quote does not belong to this service case", 409);
      if (quote.status !== "accepted") return responseError("Only accepted quotes can create linked jobs", 409);
    }
    let result!: { jobId: string; jobNumber: string };
    this.ctx.storage.transactionSync(() => {
      result = this.insertJob({
        caseId: input.caseId, quoteId: input.quoteId ?? null, title: input.title,
        siteAddressJson: input.siteAddress ? JSON.stringify(input.siteAddress) : serviceCase.site_address_json, notes: input.notes ?? null,
      }, request);
      this.ctx.storage.sql.exec("UPDATE service_cases SET status = 'won', updated_at = ? WHERE id = ?", timestamp(), input.caseId);
      this.convertContactInternal(serviceCase.contact_id, request);
    });
    return Response.json(result, { status: 201 });
  }

  private createJobFromQuote(quoteId: string, request: Request) {
    const row = this.ctx.storage.sql.exec<{ id: string; case_id: string; status: string; title: string; site_address_json: string | null; contact_id: string }>(
      `SELECT q.id, q.case_id, q.status, sc.title, sc.site_address_json, sc.contact_id
       FROM service_quotes q JOIN service_cases sc ON sc.id = q.case_id WHERE q.id = ?`, quoteId,
    ).toArray()[0];
    if (!row) return responseError("Service quote not found", 404);
    if (row.status !== "accepted") return responseError("Only accepted quotes can create jobs", 409);
    const existing = this.ctx.storage.sql.exec<{ id: string; number: string }>("SELECT id, number FROM service_jobs WHERE quote_id = ? ORDER BY created_at LIMIT 1", quoteId).toArray()[0];
    if (existing) return Response.json({ jobId: existing.id, jobNumber: existing.number, existing: true });
    let result!: { jobId: string; jobNumber: string };
    this.ctx.storage.transactionSync(() => {
      result = this.insertJob({ caseId: row.case_id, quoteId, title: row.title, siteAddressJson: row.site_address_json, notes: null }, request);
      this.convertContactInternal(row.contact_id, request);
    });
    return Response.json(result, { status: 201 });
  }

  private listJobs() {
    return Response.json({ jobs: this.ctx.storage.sql.exec(
      `SELECT j.*, c.name AS customer_name,
              (SELECT MIN(v.scheduled_start) FROM service_visits v WHERE v.job_id = j.id AND v.status = 'scheduled') AS next_visit_at
       FROM service_jobs j JOIN service_cases sc ON sc.id = j.case_id JOIN crm_contacts c ON c.id = sc.contact_id ORDER BY j.updated_at DESC`,
    ).toArray() });
  }

  private async createVisit(jobId: string, request: Request) {
    const input = visitInput.parse(await request.json());
    const job = this.ctx.storage.sql.exec<{ id: string; status: string }>("SELECT id, status FROM service_jobs WHERE id = ?", jobId).toArray()[0];
    if (!job) return responseError("Service job not found", 404);
    if (new Set(["completed", "cancelled"]).has(job.status)) return responseError(`Cannot schedule a visit for a ${job.status} job.`, 409);
    if (input.scheduledEnd && input.scheduledEnd <= input.scheduledStart) return responseError("Visit end must be after its start");
    const visitId = uid();
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO service_visits (id, job_id, status, scheduled_start, scheduled_end, assigned_actor_id, notes, created_at, updated_at) VALUES (?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)",
        visitId, jobId, input.scheduledStart, input.scheduledEnd ?? null, input.assignedActorId ?? null, input.notes ?? null, now, now,
      );
      if (job.status === "draft") this.ctx.storage.sql.exec("UPDATE service_jobs SET status = 'scheduled', updated_at = ? WHERE id = ?", now, jobId);
      this.audit(request, "service_visit.created", "service_visit", visitId, { jobId, scheduledStart: input.scheduledStart });
    });
    return Response.json({ id: visitId }, { status: 201 });
  }

  private startJob(jobId: string, request: Request) {
    const job = this.ctx.storage.sql.exec<{ id: string; status: string }>("SELECT id, status FROM service_jobs WHERE id = ?", jobId).toArray()[0];
    if (!job) return responseError("Service job not found", 404);
    if (!new Set(["draft", "scheduled"]).has(job.status)) return responseError(`Job cannot start from ${job.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_jobs SET status = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?", now, now, jobId);
      this.audit(request, "service_job.started", "service_job", jobId);
    });
    return Response.json({ ok: true });
  }

  private completeJob(jobId: string, request: Request) {
    const job = this.ctx.storage.sql.exec<{ id: string; status: string }>("SELECT id, status FROM service_jobs WHERE id = ?", jobId).toArray()[0];
    if (!job) return responseError("Service job not found", 404);
    if (job.status !== "in_progress") return responseError(`Only in-progress jobs can be completed; current status is ${job.status}.`, 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_jobs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?", now, now, jobId);
      this.audit(request, "service_job.completed", "service_job", jobId);
    });
    return Response.json({ ok: true });
  }

  private async postJobMaterial(jobId: string, request: Request) {
    if (!this.moduleEnabled("inventory")) return responseError("Inventory must be enabled to post job material usage.", 409);
    const input = materialInput.parse(await request.json());
    const job = this.ctx.storage.sql.exec<{ id: string; status: string }>("SELECT id, status FROM service_jobs WHERE id = ?", jobId).toArray()[0];
    if (!job) return responseError("Service job not found", 404);
    if (job.status !== "in_progress") return responseError("Materials can only be posted to an in-progress job.", 409);
    if (input.visitId && !this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM service_visits WHERE id = ? AND job_id = ?", input.visitId, jobId).toArray()[0]) return responseError("Visit does not belong to this job", 409);
    const variant = this.ctx.storage.sql.exec<{ id: string; sku: string; variant_name: string; product_name: string; cost_minor: number }>(
      "SELECT v.id, v.sku, v.name AS variant_name, p.name AS product_name, v.cost_minor FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.active = 1", input.variantId,
    ).toArray()[0];
    if (!variant) return responseError("Product variant not found", 404);
    const stock = this.ctx.storage.sql.exec<{ on_hand: number; reserved: number }>("SELECT on_hand, reserved FROM inventory_levels WHERE variant_id = ? AND location_id = ?", input.variantId, input.locationId).toArray()[0];
    if (!stock || stock.on_hand - input.quantity < stock.reserved) return responseError("Insufficient unreserved stock for this material usage", 409);
    if (!this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM locations WHERE id = ? AND active = 1", input.locationId).toArray()[0]) return responseError("Stock location not found", 404);

    const actor = this.actor(request);
    const usageId = uid();
    const movementId = uid();
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE inventory_levels SET on_hand = on_hand - ?, updated_at = ? WHERE variant_id = ? AND location_id = ?", input.quantity, now, input.variantId, input.locationId);
      this.ctx.storage.sql.exec(
        "INSERT INTO inventory_movements (id, variant_id, location_id, quantity_delta, movement_type, reference_type, reference_id, reason, actor_id, created_at) VALUES (?, ?, ?, ?, 'service_material_usage', 'service_job', ?, ?, ?, ?)",
        movementId, input.variantId, input.locationId, -input.quantity, jobId, "Material used on service job", actor.id, now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO service_material_usage (id, job_id, visit_id, variant_id, location_id, quantity, sku_snapshot, description_snapshot, unit_cost_minor_snapshot, movement_id, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        usageId, jobId, input.visitId ?? null, input.variantId, input.locationId, input.quantity, variant.sku,
        `${variant.product_name} · ${variant.variant_name}`, variant.cost_minor, movementId, actor.id, now,
      );
      this.audit(request, "service_job.material_posted", "service_material_usage", usageId, { jobId, movementId, quantity: input.quantity });
    });
    return Response.json({ id: usageId, movementId }, { status: 201 });
  }

  private listInvoices() {
    return Response.json({ invoices: this.ctx.storage.sql.exec(
      `SELECT i.*, c.name AS customer_name,
              COALESCE((SELECT SUM(p.amount_minor) FROM service_payments p WHERE p.invoice_id = i.id), 0) AS paid_minor,
              i.total_minor - COALESCE((SELECT SUM(p.amount_minor) FROM service_payments p WHERE p.invoice_id = i.id), 0) AS outstanding_minor
       FROM service_invoices i JOIN service_cases sc ON sc.id = i.case_id JOIN crm_contacts c ON c.id = sc.contact_id ORDER BY i.updated_at DESC`,
    ).toArray() });
  }

  private insertInvoice(input: z.infer<typeof invoiceCreateInput>, request: Request) {
    if (!this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM service_cases WHERE id = ?", input.caseId).toArray()[0]) throw new Error("Service case not found");
    if (input.jobId) {
      const job = this.ctx.storage.sql.exec<{ id: string; case_id: string }>("SELECT id, case_id FROM service_jobs WHERE id = ?", input.jobId).toArray()[0];
      if (!job || job.case_id !== input.caseId) throw new Error("Invoice job does not belong to this service case");
    }
    const currency = this.ctx.storage.sql.exec<{ currency: string }>("SELECT currency FROM tenant_settings WHERE id = 1").toArray()[0]?.currency || "GBP";
    const totals = this.calculateLines(input.lines);
    const invoiceId = uid();
    const invoiceNumber = this.nextNumber("service_invoice", "INV");
    const now = timestamp();
    this.ctx.storage.sql.exec(
      `INSERT INTO service_invoices (id, case_id, job_id, number, status, currency, supply_date, due_date, notes, subtotal_minor, tax_minor, total_minor, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, input.caseId, input.jobId ?? null, invoiceNumber, currency, input.supplyDate ?? null, input.dueDate ?? null,
      input.notes ?? null, totals.subtotal, totals.tax, totals.total, now, now,
    );
    for (const line of totals.lines) {
      this.ctx.storage.sql.exec(
        `INSERT INTO service_invoice_lines (id, invoice_id, line_type, description_snapshot, quantity_milli, unit_price_minor, tax_rate_bps, net_minor, tax_minor, gross_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid(), invoiceId, line.lineType, line.description, line.quantityMilli, line.unitPriceMinor, line.taxRateBps, line.net, line.tax, line.gross,
      );
    }
    this.audit(request, "service_invoice.created", "service_invoice", invoiceId, { caseId: input.caseId, jobId: input.jobId ?? null, invoiceNumber, totalMinor: totals.total });
    return { invoiceId, invoiceNumber };
  }

  private async createInvoice(request: Request) {
    const input = invoiceCreateInput.parse(await request.json());
    let result!: { invoiceId: string; invoiceNumber: string };
    try { this.ctx.storage.transactionSync(() => { result = this.insertInvoice(input, request); }); }
    catch (cause) { return responseError(cause instanceof Error ? cause.message : "Could not create invoice", 409); }
    return Response.json(result, { status: 201 });
  }

  private issueInvoice(invoiceId: string, request: Request) {
    const invoice = this.ctx.storage.sql.exec<InvoiceRow>(
      "SELECT id, case_id, job_id, number, status, total_minor, currency, supply_date, issue_date, due_date FROM service_invoices WHERE id = ?", invoiceId,
    ).toArray()[0];
    if (!invoice) return responseError("Service invoice not found", 404);
    if (invoice.status !== "draft") return responseError(`Only draft invoices can be issued; current status is ${invoice.status}.`, 409);
    const contact = this.ctx.storage.sql.exec<ContactRow>(
      "SELECT c.* FROM crm_contacts c JOIN service_cases sc ON sc.contact_id = c.id WHERE sc.id = ?", invoice.case_id,
    ).toArray()[0];
    if (!contact) return responseError("Invoice customer is unavailable", 409);
    if (!contact.address_json) return responseError("Customer address is required before an invoice can be issued", 409);

    const businessName = this.ctx.storage.sql.exec<{ business_name: string }>("SELECT business_name FROM tenant_settings WHERE id = 1").toArray()[0]?.business_name;
    const businessLocation = this.ctx.storage.sql.exec<{ address_json: string | null; name: string }>(
      "SELECT address_json, name FROM locations WHERE active = 1 AND address_json IS NOT NULL ORDER BY created_at LIMIT 1",
    ).toArray()[0];
    if (!businessName || !businessLocation?.address_json) return responseError("Business name and at least one active location address are required before an invoice can be issued", 409);

    let supplyDate = invoice.supply_date;
    if (!supplyDate && invoice.job_id) {
      const completed = this.ctx.storage.sql.exec<{ completed_at: string | null }>("SELECT completed_at FROM service_jobs WHERE id = ?", invoice.job_id).toArray()[0]?.completed_at;
      if (completed) supplyDate = completed.slice(0, 10);
    }
    if (!supplyDate) return responseError("Supply date is required before an invoice can be issued", 409);

    const now = timestamp();
    const issueDate = now.slice(0, 10);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE service_invoices SET status = 'issued', supply_date = ?, issue_date = ?,
         business_name_snapshot = ?, business_address_json_snapshot = ?, business_contact_snapshot = ?,
         customer_name_snapshot = ?, customer_email_snapshot = ?, customer_mobile_snapshot = ?, customer_address_json_snapshot = ?,
         issued_at = ?, updated_at = ? WHERE id = ?`,
        supplyDate, issueDate, businessName, businessLocation.address_json, JSON.stringify({ location: businessLocation.name }),
        contact.name, contact.email, contact.mobile, contact.address_json, now, now, invoiceId,
      );
      this.convertContactInternal(contact.id, request);
      this.audit(request, "service_invoice.issued", "service_invoice", invoiceId, { number: invoice.number, totalMinor: invoice.total_minor, supplyDate, issueDate });
    });
    return Response.json({ ok: true, issueDate, supplyDate });
  }

  private async addInvoicePayment(invoiceId: string, request: Request) {
    const input = paymentInput.parse(await request.json());
    const invoice = this.ctx.storage.sql.exec<{ id: string; status: string; total_minor: number }>("SELECT id, status, total_minor FROM service_invoices WHERE id = ?", invoiceId).toArray()[0];
    if (!invoice) return responseError("Service invoice not found", 404);
    if (!new Set(["issued", "partially_paid"]).has(invoice.status)) return responseError(`Payments cannot be added to an invoice in ${invoice.status} status.`, 409);
    const paid = this.ctx.storage.sql.exec<{ total: number | null }>("SELECT SUM(amount_minor) AS total FROM service_payments WHERE invoice_id = ?", invoiceId).toArray()[0]?.total ?? 0;
    const outstanding = invoice.total_minor - paid;
    if (input.amountMinor > outstanding) return responseError(`Payment exceeds the outstanding balance of ${outstanding} minor units.`, 409);
    const actor = this.actor(request);
    const paymentId = uid();
    const now = timestamp();
    const nextPaid = paid + input.amountMinor;
    const nextStatus = nextPaid === invoice.total_minor ? "paid" : "partially_paid";
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO service_payments (id, invoice_id, amount_minor, method, reference, paid_at, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        paymentId, invoiceId, input.amountMinor, input.method ?? null, input.reference ?? null, input.paidAt ?? now, actor.id, now,
      );
      this.ctx.storage.sql.exec("UPDATE service_invoices SET status = ?, updated_at = ? WHERE id = ?", nextStatus, now, invoiceId);
      this.audit(request, "service_invoice.payment_recorded", "service_payment", paymentId, { invoiceId, amountMinor: input.amountMinor, status: nextStatus });
    });
    return Response.json({ id: paymentId, status: nextStatus, outstandingMinor: invoice.total_minor - nextPaid }, { status: 201 });
  }

  private voidInvoice(invoiceId: string, request: Request) {
    const invoice = this.ctx.storage.sql.exec<{ id: string; status: string }>("SELECT id, status FROM service_invoices WHERE id = ?", invoiceId).toArray()[0];
    if (!invoice) return responseError("Service invoice not found", 404);
    if (!new Set(["draft", "issued"]).has(invoice.status)) return responseError(`Invoice cannot be voided from ${invoice.status}.`, 409);
    const payments = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM service_payments WHERE invoice_id = ?", invoiceId).toArray()[0]?.count ?? 0;
    if (payments) return responseError("An invoice with recorded payments cannot be voided", 409);
    const now = timestamp();
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("UPDATE service_invoices SET status = 'void', voided_at = ?, updated_at = ? WHERE id = ?", now, now, invoiceId);
      this.audit(request, "service_invoice.voided", "service_invoice", invoiceId);
    });
    return Response.json({ ok: true });
  }
}
