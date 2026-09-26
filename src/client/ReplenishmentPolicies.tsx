import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { tenantApi } from "./api";
import type { InventoryPolicy, Location, Product, SupplierVariant } from "./model";
import { DataState, ErrorText, Field, Modal } from "./ui";

type DraftPolicy = {
  variantId: string;
  locationId: string;
  reorderPoint: string;
  targetStock: string;
  preferredSupplierId: string;
};

export default function ReplenishmentPolicies({ tenant, defaultThreshold = 5 }: { tenant: OrganizationSummary; defaultThreshold?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPolicy>(() => blankPolicy(defaultThreshold));
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);

  const policies = useQuery({
    queryKey: ["tenant", tenant.id, "inventory-policies"],
    queryFn: () => tenantApi<InventoryPolicy[]>(tenant.id, "/inventory-policies"),
    enabled: open,
  });
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products"), enabled: open });
  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations"), enabled: open });
  const mappings = useQuery({ queryKey: ["tenant", tenant.id, "supplier-variants"], queryFn: () => tenantApi<SupplierVariant[]>(tenant.id, "/supplier-variants"), enabled: open });

  const variants = useMemo(() => (products.data || [])
    .filter(product => product.status === "active")
    .flatMap(product => product.variants
      .filter(variant => variant.active !== 0)
      .map(variant => ({ ...variant, productName: product.name }))), [products.data]);
  const mappedSuppliers = (mappings.data || []).filter(mapping => mapping.variant_id === draft.variantId);
  const selectedPolicy = policies.data?.find(policy => `${policy.variant_id}:${policy.location_id}` === editing);

  const save = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/inventory-policies", {
      method: "PUT",
      body: JSON.stringify({
        variantId: draft.variantId,
        locationId: draft.locationId,
        reorderPoint: Number(draft.reorderPoint),
        targetStock: Number(draft.targetStock),
        preferredSupplierId: draft.preferredSupplierId || null,
      }),
    }),
    onSuccess: async () => {
      setEditing(null);
      setDraft(blankPolicy(defaultThreshold));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory-policies"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "activity"] }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: (policy: InventoryPolicy) => tenantApi(tenant.id, `/inventory-policies/${encodeURIComponent(policy.variant_id)}/${encodeURIComponent(policy.location_id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setEditing(null);
      setDraft(blankPolicy(defaultThreshold));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory-policies"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "activity"] }),
      ]);
    },
  });

  const editPolicy = (policy: InventoryPolicy) => {
    setEditing(`${policy.variant_id}:${policy.location_id}`);
    setDraft({
      variantId: policy.variant_id,
      locationId: policy.location_id,
      reorderPoint: String(policy.reorder_point),
      targetStock: String(policy.target_stock),
      preferredSupplierId: policy.preferred_supplier_id || "",
    });
  };
  const newPolicy = () => {
    setEditing("new");
    setDraft(blankPolicy(defaultThreshold));
  };
  const reorderPoint = Number(draft.reorderPoint);
  const targetStock = Number(draft.targetStock);
  const valid = !!draft.variantId && !!draft.locationId
    && Number.isInteger(reorderPoint) && reorderPoint >= 0
    && Number.isInteger(targetStock) && targetStock >= reorderPoint;

  return <>
    <button type="button" className="table-action" onClick={() => setOpen(true)}><Settings2 size={14} /> Replenishment rules</button>
    {open && <Modal title="Replenishment rules" subtitle="Override Operating Layer's workspace-wide defaults only where a SKU/location needs its own minimum, arrival target or preferred mapped supplier." onClose={() => { setOpen(false); setEditing(null); setDraft(blankPolicy(defaultThreshold)); }} wide>
      <div className="policy-workspace">
        <div className="policy-list-head"><div><p className="eyebrow">Custom rules</p><h3>Sparse overrides</h3><p>No rule means Operating Layer keeps using demand, lead time and the workspace low-stock threshold automatically. Target stock is the quantity you want available when the replenishment is expected to arrive.</p></div>{canWrite && <button type="button" className="secondary" onClick={newPolicy}><Plus size={15} /> Add rule</button>}</div>
        <DataState loading={policies.isLoading} error={policies.error} empty={!policies.data?.length} emptyText="No custom replenishment rules. Every SKU/location is using the workspace defaults.">
          <div className="policy-list">{policies.data?.map(policy => <div className={`policy-row ${editing === `${policy.variant_id}:${policy.location_id}` ? "active" : ""}`} key={`${policy.variant_id}:${policy.location_id}`}>
            <div><strong>{policy.product_name} · {policy.variant_name}</strong><small className="mono">{policy.sku} · {policy.location_name}</small></div>
            <span><small>Reorder</small><strong>{policy.reorder_point}</strong></span>
            <span><small>Arrival target</small><strong>{policy.target_stock}</strong></span>
            <span><small>Preferred supplier</small><strong>{policy.preferred_supplier_name || "Automatic"}</strong></span>
            {canWrite && <div className="policy-actions"><button type="button" className="icon-button" aria-label="Edit replenishment rule" onClick={() => editPolicy(policy)}><Pencil size={14} /></button><button type="button" className="icon-button" aria-label="Delete replenishment rule" disabled={remove.isPending} onClick={() => remove.mutate(policy)}><Trash2 size={14} /></button></div>}
          </div>)}</div>
        </DataState>
        {remove.error && !editing && <ErrorText error={remove.error} />}

        {canWrite && editing && <form className="policy-editor" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
          <div className="policy-editor-head"><div><p className="eyebrow">{editing === "new" ? "New rule" : "Edit rule"}</p><h3>{editing === "new" ? "Tune a stock position" : `${selectedPolicy?.product_name || "SKU"} · ${selectedPolicy?.location_name || "location"}`}</h3></div></div>
          <div className="form-grid">
            <Field label="Product variant"><select required disabled={editing !== "new"} value={draft.variantId} onChange={event => setDraft(current => ({ ...current, variantId: event.target.value, preferredSupplierId: "" }))}><option value="">Select variant</option>{variants.map(variant => <option key={variant.id} value={variant.id}>{variant.productName} · {variant.name} — {variant.sku}</option>)}</select></Field>
            <Field label="Stock location"><select required disabled={editing !== "new"} value={draft.locationId} onChange={event => setDraft(current => ({ ...current, locationId: event.target.value }))}><option value="">Select location</option>{locations.data?.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label="Reorder point" hint="Trigger when projected stock at supplier arrival reaches this level."><input required type="number" min="0" step="1" value={draft.reorderPoint} onChange={event => setDraft(current => ({ ...current, reorderPoint: event.target.value }))} /></Field>
            <Field label="Arrival target stock" hint="Suggested quantity includes expected demand during lead time so this stock level remains when replenishment arrives."><input required type="number" min={Math.max(0, reorderPoint || 0)} step="1" value={draft.targetStock} onChange={event => setDraft(current => ({ ...current, targetStock: event.target.value }))} /></Field>
            <Field label="Preferred supplier" hint="Optional. Only suppliers already mapped to this variant can be preferred."><select value={draft.preferredSupplierId} onChange={event => setDraft(current => ({ ...current, preferredSupplierId: event.target.value }))}><option value="">Automatic / fastest mapped</option>{mappedSuppliers.map(mapping => <option key={mapping.supplier_id} value={mapping.supplier_id}>{mapping.supplier_name}{mapping.lead_time_days != null ? ` · ${mapping.lead_time_days}d` : ""}</option>)}</select></Field>
          </div>
          {draft.variantId && !mappedSuppliers.length && <p className="form-note">No suppliers are mapped to this variant yet. The rule can still control stock levels; add a supplier mapping later if you want a preferred purchasing source.</p>}
          {save.error && <ErrorText error={save.error} />}
          {remove.error && <ErrorText error={remove.error} />}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => { setEditing(null); setDraft(blankPolicy(defaultThreshold)); }}>Cancel edit</button><button className="primary" disabled={save.isPending || !valid}>Save rule</button></div>
        </form>}
      </div>
    </Modal>}
  </>;
}

function blankPolicy(defaultThreshold: number): DraftPolicy {
  const threshold = Math.max(0, Math.trunc(defaultThreshold));
  return { variantId: "", locationId: "", reorderPoint: String(threshold), targetStock: String(Math.max(threshold * 2, threshold + 1)), preferredSupplierId: "" };
}
