import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Mail, MapPin, Phone, Plus, UserCheck, Users } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import { tenantApi } from "../api";
import { DataState, ErrorText, Field, Modal, PageHeader, Status } from "../ui";

type CrmStage = "prospect" | "customer";
type CrmContact = {
  id: string;
  lifecycle_stage: CrmStage;
  name: string;
  email?: string | null;
  mobile?: string | null;
  address?: Record<string, unknown> | null;
  notes?: string | null;
  source?: string | null;
  converted_at?: string | null;
  updated_at: string;
};
type ContactsResponse = { contacts: CrmContact[] };

type ContactForm = {
  lifecycleStage: CrmStage;
  name: string;
  email: string;
  mobile: string;
  line1: string;
  line2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
  source: string;
  notes: string;
};

const emptyForm: ContactForm = {
  lifecycleStage: "prospect",
  name: "",
  email: "",
  mobile: "",
  line1: "",
  line2: "",
  city: "",
  county: "",
  postcode: "",
  country: "GB",
  source: "",
  notes: "",
};

function addressLine(address: Record<string, unknown> | null | undefined) {
  if (!address) return "No address yet";
  return [address.line1, address.line2, address.city ?? address.locality, address.county ?? address.region, address.postcode]
    .filter(value => typeof value === "string" && value.trim())
    .join(", ") || "No address yet";
}

export default function CRM({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<CrmStage | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>(emptyForm);

  const contacts = useQuery({
    queryKey: ["tenant", tenant.id, "crm", "contacts"],
    queryFn: () => tenantApi<ContactsResponse>(tenant.id, "/crm/contacts"),
  });
  const filtered = useMemo(() => (contacts.data?.contacts || []).filter(contact => stage === "all" || contact.lifecycle_stage === stage), [contacts.data, stage]);
  const canEdit = ["owner", "admin", "manager"].includes(tenant.role);

  const create = useMutation({
    mutationFn: () => tenantApi<{ id: string }>(tenant.id, "/crm/contacts", {
      method: "POST",
      body: JSON.stringify({
        lifecycleStage: form.lifecycleStage,
        name: form.name,
        email: form.email || undefined,
        mobile: form.mobile || undefined,
        source: form.source || undefined,
        notes: form.notes || undefined,
        address: form.line1 || form.line2 || form.city || form.county || form.postcode
          ? { line1: form.line1, line2: form.line2, city: form.city, county: form.county, postcode: form.postcode, country: form.country || "GB" }
          : undefined,
      }),
    }),
    onSuccess: async () => {
      setCreateOpen(false);
      setForm(emptyForm);
      await qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "crm"] });
      await qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  const convert = useMutation({
    mutationFn: (id: string) => tenantApi(tenant.id, `/crm/contacts/${encodeURIComponent(id)}/convert`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "crm"] });
      await qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "customers"] });
      await qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  const counts = useMemo(() => ({
    prospects: contacts.data?.contacts.filter(contact => contact.lifecycle_stage === "prospect").length || 0,
    customers: contacts.data?.contacts.filter(contact => contact.lifecycle_stage === "customer").length || 0,
  }), [contacts.data]);

  return <>
    <PageHeader
      eyebrow="Mini CRM"
      title="Prospects & customers"
      description="Keep one person or business record from first enquiry through customer history. Converting a prospect preserves the same identity and service history."
      actions={canEdit ? <button type="button" className="primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Add contact</button> : undefined}
    />

    <div className="crm-summary-grid">
      <button type="button" className={`panel crm-stat ${stage === "prospect" ? "selected" : ""}`} onClick={() => setStage(stage === "prospect" ? "all" : "prospect")}>
        <span><Users size={18} /> Prospects</span><strong>{counts.prospects}</strong><small>Enquiries and opportunities not yet converted</small>
      </button>
      <button type="button" className={`panel crm-stat ${stage === "customer" ? "selected" : ""}`} onClick={() => setStage(stage === "customer" ? "all" : "customer")}>
        <span><UserCheck size={18} /> Customers</span><strong>{counts.customers}</strong><small>Converted or directly-created customers</small>
      </button>
    </div>

    <section className="panel crm-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Contacts</p><h3>{stage === "all" ? "All CRM contacts" : stage === "prospect" ? "Prospects" : "Customers"}</h3></div>
        {stage !== "all" && <button type="button" className="secondary" onClick={() => setStage("all")}>Show all</button>}
      </div>
      <DataState loading={contacts.isLoading} error={contacts.error} empty={!filtered.length} emptyText="Add a prospect or customer to start the CRM.">
        <div className="crm-contact-list">
          {filtered.map(contact => <article className="crm-contact-card" key={contact.id}>
            <div className="crm-contact-main">
              <div className="crm-contact-title"><strong>{contact.name}</strong><Status value={contact.lifecycle_stage} /></div>
              <div className="crm-contact-meta">
                <span><Mail size={14} /> {contact.email || "No email"}</span>
                <span><Phone size={14} /> {contact.mobile || "No mobile"}</span>
                <span><MapPin size={14} /> {addressLine(contact.address)}</span>
              </div>
              {(contact.source || contact.notes) && <p>{[contact.source ? `Source: ${contact.source}` : "", contact.notes || ""].filter(Boolean).join(" · ")}</p>}
            </div>
            {canEdit && contact.lifecycle_stage === "prospect" && <button type="button" className="secondary" disabled={convert.isPending} onClick={() => convert.mutate(contact.id)}>Convert to customer <ArrowRight size={14} /></button>}
          </article>)}
        </div>
      </DataState>
      {convert.error && <ErrorText error={convert.error} />}
    </section>

    {createOpen && <Modal title="Add CRM contact" subtitle="Start as a prospect or create an existing customer directly. Address is structured so service jobs and invoices can snapshot it safely." onClose={() => setCreateOpen(false)} wide>
      <form className="form-grid two" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
        <Field label="Lifecycle"><select value={form.lifecycleStage} onChange={event => setForm(current => ({ ...current, lifecycleStage: event.target.value as CrmStage }))}><option value="prospect">Prospect</option><option value="customer">Customer</option></select></Field>
        <Field label="Name"><input autoFocus required value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></Field>
        <Field label="Mobile"><input inputMode="tel" value={form.mobile} onChange={event => setForm(current => ({ ...current, mobile: event.target.value }))} /></Field>
        <Field label="Address line 1"><input value={form.line1} onChange={event => setForm(current => ({ ...current, line1: event.target.value }))} /></Field>
        <Field label="Address line 2"><input value={form.line2} onChange={event => setForm(current => ({ ...current, line2: event.target.value }))} /></Field>
        <Field label="Town / city"><input value={form.city} onChange={event => setForm(current => ({ ...current, city: event.target.value }))} /></Field>
        <Field label="County / region"><input value={form.county} onChange={event => setForm(current => ({ ...current, county: event.target.value }))} /></Field>
        <Field label="Postcode"><input value={form.postcode} onChange={event => setForm(current => ({ ...current, postcode: event.target.value }))} /></Field>
        <Field label="Country code"><input maxLength={2} value={form.country} onChange={event => setForm(current => ({ ...current, country: event.target.value.toUpperCase() }))} /></Field>
        <Field label="Source"><input placeholder="Website, referral, phone…" value={form.source} onChange={event => setForm(current => ({ ...current, source: event.target.value }))} /></Field>
        <Field label="Notes"><textarea rows={3} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></Field>
        {create.error && <div className="form-span"><ErrorText error={create.error} /></div>}
        <div className="modal-actions form-span"><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={create.isPending || !form.name.trim()}>Save contact</button></div>
      </form>
    </Modal>}
  </>;
}
