import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleUserRound, Pencil, Plus, Truck } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import SupplierCatalogue from "../SupplierCatalogue";
import { tenantApi } from "../api";
import type { Customer, Supplier } from "../model";
import { CardList, ErrorText, Field, Modal, PageHeader } from "../ui";

export function Suppliers({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "suppliers"], queryFn: () => tenantApi<Supplier[]>(tenant.id, "/suppliers") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id] });

  return <>
    <PageHeader eyebrow="Purchasing" title="Suppliers" description="The commercial relationships behind incoming stock, source-document matching and replenishment intelligence." actions={canWrite ? <button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Add supplier</button> : undefined} />
    {query.error ? <section className="panel people-error"><ErrorText error={query.error} /></section> : <CardList items={query.data || []} loading={query.isLoading} empty="No suppliers yet." render={supplier => <><div className="list-icon"><Truck size={19} /></div><div><strong>{supplier.name}</strong><small>{supplier.email || supplier.phone || "No contact details"}</small></div>{canWrite && <button className="table-action person-edit" onClick={() => setEditing(supplier)}><Pencil size={13} /> Edit</button>}</>} />}
    <SupplierCatalogue tenant={tenant} suppliers={query.data || []} />
    {open && canWrite && <PersonModal kind="supplier" tenant={tenant} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refresh(); }} />}
    {editing && canWrite && <PersonModal kind="supplier" tenant={tenant} existing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
  </>;
}

export function Customers({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const canWrite = ["owner", "admin", "manager"].includes(tenant.role);
  const query = useQuery({ queryKey: ["tenant", tenant.id, "customers"], queryFn: () => tenantApi<Customer[]>(tenant.id, "/customers") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", tenant.id] });

  return <>
    <PageHeader eyebrow="Orders" title="Customers" description="Simple customer records for order history and contact details without turning OrderMate into a CRM." actions={canWrite ? <button className="primary" onClick={() => setOpen(true)}><Plus size={17} /> Add customer</button> : undefined} />
    {query.error ? <section className="panel people-error"><ErrorText error={query.error} /></section> : <CardList items={query.data || []} loading={query.isLoading} empty="No customers yet." render={customer => <><div className="list-icon"><CircleUserRound size={19} /></div><div><strong>{customer.name}</strong><small>{customer.email || customer.phone || "No contact details"}</small></div>{canWrite && <button className="table-action person-edit" onClick={() => setEditing(customer)}><Pencil size={13} /> Edit</button>}</>} />}
    {open && canWrite && <PersonModal kind="customer" tenant={tenant} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); refresh(); }} />}
    {editing && canWrite && <PersonModal kind="customer" tenant={tenant} existing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
  </>;
}

function PersonModal({ kind, tenant, existing, onClose, onSaved }: { kind: "supplier" | "customer"; tenant: OrganizationSummary; existing?: Supplier | Customer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: existing?.name || "",
    email: existing?.email || "",
    phone: existing?.phone || "",
    notes: existing?.notes || "",
  });
  const mutation = useMutation({
    mutationFn: () => tenantApi(tenant.id, existing ? `/${kind === "supplier" ? "suppliers" : "customers"}/${existing.id}` : kind === "supplier" ? "/suppliers" : "/customers", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ name: form.name, email: form.email || undefined, phone: form.phone || undefined, notes: form.notes || undefined }),
    }),
    onSuccess: onSaved,
  });
  const label = kind === "supplier" ? "supplier" : "customer";

  return <Modal title={`${existing ? "Edit" : "Add"} ${label}`} subtitle={kind === "supplier" ? "Supplier identity stays stable so purchase history and SKU mappings keep the same anchor when contact details change." : "Customer details can change without rewriting the commercial snapshot held by historic orders."} onClose={onClose}>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
      <Field label="Name"><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
      <Field label="Email"><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
      <Field label="Phone"><input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></Field>
      <Field label="Notes"><input value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></Field>
      {mutation.error && <ErrorText error={mutation.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !form.name.trim()}>{existing ? "Save changes" : `Add ${label}`}</button></div>
    </form>
  </Modal>;
}
