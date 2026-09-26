import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, PackageSearch, Plus, Trash2 } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { money, tenantApi } from "./api";
import type { Product, Supplier, SupplierVariant } from "./model";
import { DataState, ErrorText, Field, Modal, pounds } from "./ui";

export default function SupplierCatalogue({ tenant, suppliers }: { tenant: OrganizationSummary; suppliers: Supplier[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const mappings = useQuery({
    queryKey: ["tenant", tenant.id, "supplier-variants"],
    queryFn: () => tenantApi<SupplierVariant[]>(tenant.id, "/supplier-variants"),
  });
  const unlink = useMutation({
    mutationFn: (mapping: SupplierVariant) => tenantApi(tenant.id, `/supplier-variants/${encodeURIComponent(mapping.supplier_id)}/${encodeURIComponent(mapping.variant_id)}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "supplier-variants"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    },
  });

  return <section className="panel supplier-catalogue">
    <div className="panel-heading">
      <div><p className="eyebrow">Supplier catalogue</p><h3>Map how suppliers identify your stock</h3></div>
      {canWrite && <button className="secondary" onClick={() => setOpen(true)}><Plus size={15} /> Link variant</button>}
    </div>
    <p>Supplier SKU, latest known cost and lead time give receiving, document matching and replenishment a reliable deterministic anchor.</p>
    <DataState loading={mappings.isLoading} error={mappings.error || unlink.error} empty={!mappings.data?.length} emptyText="No supplier variants are linked yet. Add a mapping to unlock better PO matching and replenishment suggestions.">
      <div className="supplier-map-list">
        <div className="supplier-map-head"><span>Supplier</span><span>Operating Layer variant</span><span>Supplier SKU</span><span>Last cost</span><span>Lead time</span><span /></div>
        {mappings.data?.map(mapping => <div className="supplier-map-row" key={`${mapping.supplier_id}:${mapping.variant_id}`}>
          <div><strong>{mapping.supplier_name}</strong></div>
          <div><strong>{mapping.product_name} · {mapping.variant_name}</strong><small className="mono">{mapping.sku}</small></div>
          <span className="mono">{mapping.supplier_sku || "—"}</span>
          <span>{mapping.last_cost_minor == null ? "—" : money(mapping.last_cost_minor)}</span>
          <span>{mapping.lead_time_days == null ? "—" : `${mapping.lead_time_days} day${mapping.lead_time_days === 1 ? "" : "s"}`}</span>
          <span>{canWrite && <button className="icon-button" aria-label={`Unlink ${mapping.product_name} from ${mapping.supplier_name}`} disabled={unlink.isPending} onClick={() => unlink.mutate(mapping)}><Trash2 size={15} /></button>}</span>
        </div>)}
      </div>
    </DataState>
    {open && canWrite && <SupplierVariantModal tenant={tenant} suppliers={suppliers} onClose={() => setOpen(false)} onSaved={() => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "supplier-variants"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] });
    }} />}
  </section>;
}

function SupplierVariantModal({ tenant, suppliers, onClose, onSaved }: { tenant: OrganizationSummary; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const variants = useMemo(() => (products.data || [])
    .filter(product => product.status === "active")
    .flatMap(product => product.variants
      .filter(variant => variant.active !== 0)
      .map(variant => ({ ...variant, productName: product.name }))), [products.data]);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [variantId, setVariantId] = useState("");
  const [supplierSku, setSupplierSku] = useState("");
  const [lastCost, setLastCost] = useState("");
  const [leadTime, setLeadTime] = useState("7");
  const selected = variants.find(variant => variant.id === variantId);

  const save = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/supplier-variants", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        variantId,
        supplierSku: supplierSku || undefined,
        lastCostMinor: lastCost === "" ? selected?.cost_minor : pounds(lastCost),
        leadTimeDays: leadTime === "" ? undefined : Number(leadTime),
      }),
    }),
    onSuccess: onSaved,
  });

  return <Modal title="Link supplier variant" subtitle="This is operational metadata only. It never changes the Operating Layer SKU or historical purchase orders." onClose={onClose} wide>
    <form className="form-grid" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <Field label="Supplier"><select required value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
      <Field label="Operating Layer variant"><select required value={variantId} onChange={event => { const value = event.target.value; setVariantId(value); const variant = variants.find(item => item.id === value); if (variant && !lastCost) setLastCost((variant.cost_minor / 100).toFixed(2)); }}><option value="">Select active variant</option>{variants.map(variant => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} — {variant.sku}</option>)}</select></Field>
      <Field label="Supplier SKU"><input value={supplierSku} onChange={event => setSupplierSku(event.target.value)} placeholder="Their code for this item" /></Field>
      <Field label="Last known unit cost (£)"><input type="number" min="0" step="0.01" value={lastCost} onChange={event => setLastCost(event.target.value)} /></Field>
      <Field label="Typical lead time (days)"><input type="number" min="0" max="3650" step="1" value={leadTime} onChange={event => setLeadTime(event.target.value)} /></Field>
      <div className="mapping-hint"><PackageSearch size={18} /><span><strong>Used for matching and planning</strong><small>Document automation can match supplier codes to variants; replenishment can account for lead time before suggesting quantities.</small></span></div>
      {!products.isLoading && !variants.length && <p className="form-note full-span">No active product variants are available to link. Restore an archived product or add a new product first.</p>}
      {save.error && <ErrorText error={save.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={save.isPending || !supplierId || !variantId}><Link2 size={16} /> Save mapping</button></div>
    </form>
  </Modal>;
}
