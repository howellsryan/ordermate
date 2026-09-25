import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Plus, Trash2, XCircle } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import DocumentInbox from "../DocumentInbox";
import { PurchaseOrderDetailModal } from "../RecordDetails";
import { date, money, tenantApi } from "../api";
import type { Location, Product, PurchaseOrder, PurchaseOrderDetail, Supplier } from "../model";
import { DataState, ErrorText, Field, Modal, PageHeader, Status, pounds } from "../ui";

type DraftLine = { id: string; variantId: string; quantity: string; cost: string; tax: string };

export default function Purchasing({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const canWrite = tenant.role !== "viewer";
  const purchaseOrders = useQuery({ queryKey: ["tenant", tenant.id, "purchase-orders"], queryFn: () => tenantApi<PurchaseOrder[]>(tenant.id, "/purchase-orders") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] });
    if (viewId) qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-order", viewId] });
  };
  const submit = useMutation({ mutationFn: (poId: string) => tenantApi(tenant.id, `/purchase-orders/${poId}/submit`, { method: "POST", body: JSON.stringify({}) }), onSuccess: refresh });

  return <>
    <PageHeader eyebrow="Incoming" title="Purchase orders" description="Plan incoming stock, preserve supplier costs and tax, then receive partially or in full into the selected location." actions={canWrite ? <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> New purchase order</button> : undefined} />
    <DocumentInbox tenant={tenant} />
    <div className="panel table-panel"><DataState loading={purchaseOrders.isLoading} error={purchaseOrders.error} empty={!purchaseOrders.data?.length} emptyText="Create your first purchase order to start tracking incoming inventory."><table><thead><tr><th>PO</th><th>Supplier</th><th>Destination</th><th>Lines</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{purchaseOrders.data?.map(po => <tr key={po.id}><td><button className="record-link" onClick={() => setViewId(po.id)}>{po.number}</button><small>{date(po.created_at)}</small></td><td>{po.supplier_name}</td><td>{po.location_name}</td><td>{po.line_count}</td><td>{money(po.total_minor, po.currency)}</td><td><Status value={po.status} /></td><td className="row-actions">{canWrite && po.status === "draft" && <button className="table-action" onClick={() => submit.mutate(po.id)} disabled={submit.isPending}>Submit</button>}{canWrite && ["ordered", "partially_received"].includes(po.status) && <button className="table-action" onClick={() => setReceivingId(po.id)}><PackageCheck size={14} /> Receive</button>}{canWrite && ["draft", "ordered", "partially_received"].includes(po.status) && <button className="table-action quiet" onClick={() => setCancelId(po.id)}><XCircle size={14} /> Cancel</button>}</td></tr>)}</tbody></table></DataState></div>
    {viewId && <PurchaseOrderDetailModal tenant={tenant} purchaseOrderId={viewId} onClose={() => setViewId(null)} />}
    {createOpen && canWrite && <PurchaseOrderModal tenant={tenant} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); refresh(); }} />}
    {receivingId && canWrite && <ReceiveModal tenant={tenant} purchaseOrderId={receivingId} onClose={() => setReceivingId(null)} onDone={() => { setReceivingId(null); refresh(); }} />}
    {cancelId && canWrite && <CancelPurchaseOrderModal tenant={tenant} purchaseOrderId={cancelId} onClose={() => setCancelId(null)} onDone={() => { setCancelId(null); refresh(); }} />}
  </>;
}

function PurchaseOrderModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const suppliers = useQuery({ queryKey: ["tenant", tenant.id, "suppliers"], queryFn: () => tenantApi<Supplier[]>(tenant.id, "/suppliers") });
  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations") });
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const variants = useMemo(() => (products.data || []).flatMap(product => product.variants.map(variant => ({ ...variant, productName: product.name }))), [products.data]);
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ id: crypto.randomUUID(), variantId: "", quantity: "1", cost: "", tax: "20" }]);

  const patchLine = (lineId: string, patch: Partial<DraftLine>) => setLines(current => current.map(line => line.id === lineId ? { ...line, ...patch } : line));
  const selectVariant = (lineId: string, variantId: string) => {
    const variant = variants.find(item => item.id === variantId);
    patchLine(lineId, { variantId, cost: variant ? (variant.cost_minor / 100).toFixed(2) : "", tax: variant ? (variant.tax_rate_bps / 100).toString() : "20" });
  };
  const mutation = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/purchase-orders", {
      method: "POST",
      body: JSON.stringify({ supplierId, locationId, notes: notes || undefined, lines: lines.map(line => ({ variantId: line.variantId, quantity: Number(line.quantity), unitCostMinor: pounds(line.cost), taxRateBps: Math.round((Number(line.tax) || 0) * 100) })) }),
    }),
    onSuccess: onCreated,
  });

  return <Modal title="New purchase order" subtitle="Costs and tax are snapshotted now. Receiving later creates the actual stock movements." onClose={onClose} wide><form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="Supplier"><select required value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select supplier</option>{suppliers.data?.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></Field><Field label="Receive into"><select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Select location</option>{locations.data?.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></Field><Field label="Notes"><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Supplier reference, delivery note…" /></Field><div />
      <div className="form-section full-span"><div><p className="eyebrow">Lines</p><h3>What are you ordering?</h3></div><button type="button" className="secondary" onClick={() => setLines(current => [...current, { id: crypto.randomUUID(), variantId: "", quantity: "1", cost: "", tax: "20" }])}><Plus size={15} /> Add line</button></div>
      <div className="line-editor full-span"><div className="line-editor-head"><span>Variant</span><span>Qty</span><span>Unit cost</span><span>Tax %</span><span /></div>{lines.map(line => <div className="line-editor-row" key={line.id}><select required value={line.variantId} onChange={event => selectVariant(line.id, event.target.value)}><option value="">Choose product variant</option>{variants.map(variant => <option value={variant.id} key={variant.id}>{variant.productName} · {variant.name} — {variant.sku}</option>)}</select><input required type="number" min="1" step="1" value={line.quantity} onChange={event => patchLine(line.id, { quantity: event.target.value })} /><input required type="number" min="0" step="0.01" value={line.cost} onChange={event => patchLine(line.id, { cost: event.target.value })} /><input required type="number" min="0" step="0.01" value={line.tax} onChange={event => patchLine(line.id, { tax: event.target.value })} /><button type="button" className="icon-button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(item => item.id !== line.id))}><Trash2 size={16} /></button></div>)}</div>
      {(!suppliers.data?.length || !locations.data?.length || !variants.length) && <p className="form-note full-span">A purchase order needs at least one supplier, location and product variant. Add those first if a selector is empty.</p>}
      {mutation.error && <ErrorText error={mutation.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !supplierId || !locationId || lines.some(line => !line.variantId)}>Create draft PO</button></div>
    </form></Modal>;
}

function ReceiveModal({ tenant, purchaseOrderId, onClose, onDone }: { tenant: OrganizationSummary; purchaseOrderId: string; onClose: () => void; onDone: () => void }) {
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId], queryFn: () => tenantApi<PurchaseOrderDetail>(tenant.id, `/purchase-orders/${purchaseOrderId}`) });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: () => {
      const lines = detail.data!.lines.map(line => ({ lineId: line.id, quantity: Number(quantities[line.id] ?? (line.quantity_ordered - line.quantity_received)) })).filter(line => line.quantity > 0);
      return tenantApi(tenant.id, `/purchase-orders/${purchaseOrderId}/receive`, { method: "POST", body: JSON.stringify({ lines }) });
    },
    onSuccess: onDone,
  });

  return <Modal title={detail.data ? `Receive ${detail.data.number}` : "Receive purchase order"} subtitle="Receive exactly what arrived. Outstanding quantities remain incoming until a later receipt." onClose={onClose} wide>{detail.isLoading ? <div className="empty-state"><div className="loader" /></div> : detail.error ? <ErrorText error={detail.error} /> : <form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><div className="receive-list">{detail.data?.lines.map(line => { const remaining = line.quantity_ordered - line.quantity_received; return <div className="receive-row" key={line.id}><div><strong>{line.description_snapshot}</strong><small className="mono">{line.sku_snapshot}</small></div><span>{line.quantity_received} received / {line.quantity_ordered} ordered</span><input aria-label={`Receive ${line.description_snapshot}`} type="number" min="0" max={remaining} step="1" disabled={remaining === 0} value={quantities[line.id] ?? String(remaining)} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} /></div>; })}</div>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !detail.data?.lines.some(line => Number(quantities[line.id] ?? (line.quantity_ordered - line.quantity_received)) > 0)}>Receive selected stock</button></div></form>}</Modal>;
}

function CancelPurchaseOrderModal({ tenant, purchaseOrderId, onClose, onDone }: { tenant: OrganizationSummary; purchaseOrderId: string; onClose: () => void; onDone: () => void }) {
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId], queryFn: () => tenantApi<PurchaseOrderDetail>(tenant.id, `/purchase-orders/${purchaseOrderId}`) });
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/purchase-orders/${purchaseOrderId}/cancel`, { method: "POST", body: JSON.stringify({}) }), onSuccess: onDone });
  const received = detail.data?.lines.reduce((sum, line) => sum + line.quantity_received, 0) ?? 0;
  const outstanding = detail.data?.lines.reduce((sum, line) => sum + (line.quantity_ordered - line.quantity_received), 0) ?? 0;
  return <Modal title={detail.data ? `Cancel ${detail.data.number}?` : "Cancel purchase order?"} subtitle="Cancellation stops the remaining supplier commitment; it never rewrites stock that has physically been received." onClose={onClose}>{detail.isLoading ? <div className="detail-loading"><div className="loader" /></div> : detail.error ? <ErrorText error={detail.error} /> : <div className="confirm-stack"><div className="confirm-facts"><span><small>Already received</small><strong>{received} units stay on hand</strong></span><span><small>Outstanding</small><strong>{outstanding} units stop showing as incoming</strong></span></div><p>No inventory movement is created for cancellation because no physical stock moves.</p>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button className="secondary" onClick={onClose}>Keep purchase order</button><button className="danger-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}><XCircle size={16} /> Cancel purchase order</button></div></div>}</Modal>;
}
