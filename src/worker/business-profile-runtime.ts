import { z } from "zod";

type BusinessProfileRow = {
  address_json: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  company_number: string | null;
  updated_at: string;
  updated_by: string;
};

type ContactRow = {
  id: string;
  lifecycle_stage: "prospect" | "customer";
  name: string;
  email: string | null;
  mobile: string | null;
  address_json: string | null;
  notes: string | null;
};

type InvoiceRow = {
  id: string;
  case_id: string;
  job_id: string | null;
  number: string;
  status: string;
  total_minor: number;
  tax_minor: number;
  supply_date: string | null;
};

const profileInput = z.object({
  address: z.record(z.string(), z.unknown()).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  vatNumber: z.string().trim().max(80).nullable().optional(),
  companyNumber: z.string().trim().max(80).nullable().optional(),
});

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export class BusinessProfileRuntime {
  constructor(private readonly ctx: DurableObjectState) {}

  async handle(request: Request): Promise<Response | null> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (request.method === "GET" && path === "/business-profile") return this.getProfile();
      if (request.method === "PATCH" && path === "/business-profile") return this.updateProfile(request);

      const issue = path.match(/^\/service\/invoices\/([^/]+)\/issue$/);
      if (request.method === "POST" && issue) {
        if (!this.moduleEnabled("service")) return error("Service is disabled for this workspace.", 404);
        return this.issueInvoice(decodeURIComponent(issue[1]), request);
      }
      return null;
    } catch (cause) {
      if (cause instanceof z.ZodError) return error(cause.issues[0]?.message || "Invalid business profile", 400);
      console.error("Business profile runtime failed", cause);
      return error(cause instanceof Error ? cause.message : "Unexpected error", 500);
    }
  }

  private actor(request: Request) {
    return {
      id: request.headers.get("x-ordermate-actor-id") || "system",
      role: request.headers.get("x-ordermate-actor-role") || "unknown",
    };
  }

  private moduleEnabled(moduleKey: string) {
    return this.ctx.storage.sql.exec<{ enabled: number }>(
      "SELECT enabled FROM workspace_modules WHERE module_key = ?",
      moduleKey,
    ).toArray()[0]?.enabled === 1;
  }

  private profile() {
    return this.ctx.storage.sql.exec<BusinessProfileRow>(
      "SELECT address_json, email, phone, vat_number, company_number, updated_at, updated_by FROM business_profile WHERE id = 1",
    ).toArray()[0];
  }

  private businessName() {
    return this.ctx.storage.sql.exec<{ business_name: string }>("SELECT business_name FROM tenant_settings WHERE id = 1").toArray()[0]?.business_name || "";
  }

  private getProfile() {
    const profile = this.profile();
    return Response.json({
      businessName: this.businessName(),
      address: parseJson(profile?.address_json ?? null),
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      vatNumber: profile?.vat_number ?? null,
      companyNumber: profile?.company_number ?? null,
      updatedAt: profile?.updated_at ?? null,
    });
  }

  private async updateProfile(request: Request) {
    const input = profileInput.parse(await request.json());
    const actor = this.actor(request);
    const current = this.profile();
    if (!current) return error("Business profile is unavailable", 409);
    const updatedAt = now();
    const addressJson = input.address === undefined ? current.address_json : input.address ? JSON.stringify(input.address) : null;
    const email = input.email === undefined ? current.email : input.email;
    const phone = input.phone === undefined ? current.phone : input.phone;
    const vatNumber = input.vatNumber === undefined ? current.vat_number : input.vatNumber;
    const companyNumber = input.companyNumber === undefined ? current.company_number : input.companyNumber;

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "UPDATE business_profile SET address_json = ?, email = ?, phone = ?, vat_number = ?, company_number = ?, updated_at = ?, updated_by = ? WHERE id = 1",
        addressJson, email, phone, vatNumber, companyNumber, updatedAt, actor.id,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'business_profile.updated', 'business_profile', '1', ?, ?)",
        uid(), actor.id, actor.role, JSON.stringify({ addressChanged: input.address !== undefined, emailChanged: input.email !== undefined, phoneChanged: input.phone !== undefined, vatNumberChanged: input.vatNumber !== undefined, companyNumberChanged: input.companyNumber !== undefined }), updatedAt,
      );
    });
    return this.getProfile();
  }

  private ensureCompatibilityCustomer(contact: ContactRow, timestamp: string) {
    const existing = this.ctx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM customers WHERE crm_contact_id = ? OR id = ?",
      contact.id,
      contact.id,
    ).toArray()[0];
    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE customers SET crm_contact_id = COALESCE(crm_contact_id, ?), name = ?, email = ?, phone = ?, address_json = ?, notes = ?, updated_at = ? WHERE id = ?",
        contact.id, contact.name, contact.email, contact.mobile, contact.address_json, contact.notes, timestamp, existing.id,
      );
      return;
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO customers (id, name, email, phone, address_json, notes, crm_contact_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      contact.id, contact.name, contact.email, contact.mobile, contact.address_json, contact.notes, contact.id, timestamp, timestamp,
    );
  }

  private issueInvoice(invoiceId: string, request: Request) {
    const invoice = this.ctx.storage.sql.exec<InvoiceRow>(
      "SELECT id, case_id, job_id, number, status, total_minor, tax_minor, supply_date FROM service_invoices WHERE id = ?",
      invoiceId,
    ).toArray()[0];
    if (!invoice) return error("Service invoice not found", 404);
    if (invoice.status !== "draft") return error(`Only draft invoices can be issued; current status is ${invoice.status}.`, 409);

    const contact = this.ctx.storage.sql.exec<ContactRow>(
      "SELECT c.id, c.lifecycle_stage, c.name, c.email, c.mobile, c.address_json, c.notes FROM crm_contacts c JOIN service_cases sc ON sc.contact_id = c.id WHERE sc.id = ?",
      invoice.case_id,
    ).toArray()[0];
    if (!contact) return error("Invoice customer is unavailable", 409);
    if (!contact.address_json) return error("Customer address is required before an invoice can be issued", 409);

    const profile = this.profile();
    const businessName = this.businessName();
    if (!businessName || !profile?.address_json) return error("Business name and business address are required before an invoice can be issued", 409);
    if (invoice.tax_minor > 0 && !profile.vat_number) return error("VAT number is required before an invoice containing VAT can be issued", 409);

    let supplyDate = invoice.supply_date;
    if (!supplyDate && invoice.job_id) {
      const completedAt = this.ctx.storage.sql.exec<{ completed_at: string | null }>("SELECT completed_at FROM service_jobs WHERE id = ?", invoice.job_id).toArray()[0]?.completed_at;
      if (completedAt) supplyDate = completedAt.slice(0, 10);
    }
    if (!supplyDate) return error("Supply date is required before an invoice can be issued", 409);

    const timestamp = now();
    const issueDate = timestamp.slice(0, 10);
    const actor = this.actor(request);
    const converted = contact.lifecycle_stage === "prospect";
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE service_invoices SET status = 'issued', supply_date = ?, issue_date = ?,
         business_name_snapshot = ?, business_address_json_snapshot = ?, business_contact_snapshot = ?,
         customer_name_snapshot = ?, customer_email_snapshot = ?, customer_mobile_snapshot = ?, customer_address_json_snapshot = ?,
         issued_at = ?, updated_at = ? WHERE id = ?`,
        supplyDate, issueDate, businessName, profile.address_json,
        JSON.stringify({ email: profile.email, phone: profile.phone, vatNumber: profile.vat_number, companyNumber: profile.company_number }),
        contact.name, contact.email, contact.mobile, contact.address_json, timestamp, timestamp, invoiceId,
      );
      this.ctx.storage.sql.exec(
        "UPDATE crm_contacts SET lifecycle_stage = 'customer', converted_at = COALESCE(converted_at, ?), updated_at = ? WHERE id = ?",
        timestamp, timestamp, contact.id,
      );
      this.ensureCompatibilityCustomer(contact, timestamp);
      if (converted) {
        this.ctx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'crm_contact.converted', 'crm_contact', ?, ?, ?)",
          uid(), actor.id, actor.role, contact.id, JSON.stringify({ source: "service_invoice" }), timestamp,
        );
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'service_invoice.issued', 'service_invoice', ?, ?, ?)",
        uid(), actor.id, actor.role, invoiceId, JSON.stringify({ number: invoice.number, totalMinor: invoice.total_minor, supplyDate, issueDate }), timestamp,
      );
    });
    return Response.json({ ok: true, issueDate, supplyDate });
  }
}
