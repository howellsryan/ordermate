import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import { OrderDetailModal } from "../RecordDetails";
import { date, money, tenantApi } from "../api";
import type { Customer, InventoryRow, Location, Order, OrderDetail, Product } from "../model";
import { DataState, ErrorText, Field, Modal, PageHeader, Status } from "../ui";

type DraftLine = { id: string; variantId: string; quantity: string; modifierIds: string[] };

export default function Orders({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [viewId, setViewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fulfilId, setFulfilId] = useState<string | null>(null);
  const [returnId, setReturnId] = useState<string | null>(null);
  const canCreate = ["owner", "admin", "manager"].includes(tenant.role);
  const canUpdateLifecycle = ["owner", "admin", "manager", "fulfilment"].includes(tenant.role);
  const orders = useQuery({ queryKey: ["tenant", tenant.id, "orders"], queryFn: () => tenantApi<Order[]>(tenant.id, "/orders") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "orders"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] });
    if (viewId) qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "order", viewId] });
  };
  const transition = useMutation({ mutationFn: ({ orderId, action }: { orderId: string; action: "confirm" | "cancel" }) => tenantApi(tenant.id, `/orders/${orderId}/${action}`, { method: "POST", body: JSON.stringify({}) }), onSuccess: refresh });

  return <>
    <PageHeader eyebrow="Sales" title="Orders" description="Draft orders snapshot commercial values, confirmation reserves stock, fulfilment consumes it, and returns can put physical stock back." actions={canCreate ? <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> New order</button> : undefined} />
    <div className="panel table-panel"><DataState loading={orders.isLoading} error={orders.error} empty={!orders.data?.length} emptyText="Create the first order to exercise reservation and fulfilment."><table><thead><tr><th>Order</th><th>Customer</th><th>Location</th><th>Total</th><th>Order</th><th>Fulfilment</th><th /></tr></thead><tbody>{orders.data?.map(order => <tr key={order.id}><td><button className="record-link" onClick={() => setViewId(order.id)}>{order.number}</button><small>{date(order.created_at)}</small></td><td>{order.customer_name || "Guest"}</td><td>{order.location_name}</td><td>{money(order.total_minor, order.currency)}</td><td><Status value={order.status} /></td><td><Status value={order.fulfilment_status} /></td><td className="row-actions">{canUpdateLifecycle && order.status === "draft" && <button className="table-action" disabled={transition.isPending} onClick={() => transition.mutate({ orderId: order.id, action: "confirm" })}>Confirm</button>}{canUpdateLifecycle && order.status === "confirmed" && <button className="table-action" onClick={() => setFulfilId(order.id)}><PackageCheck size={14} /> Fulfil</button>}{canUpdateLifecycle && ["draft", "confirmed"].includes(order.status) && <button className="table-action quiet" disabled={transition.isPending} onClick={() => transition.mutate({ orderId: order.id, action: "cancel" })}>Cancel</button>}{canUpdateLifecycle && ["fulfilled", "partially_fulfilled", "partially_returned"].includes(order.fulfilment_status) && <button className="table-action quiet" onClick={() => setReturnId(order.id)}><RotateCcw size={14} /> Return</button>}</td></tr>)}</tbody></table></DataState></div>
    {transition.error && <div className="floating-error"><ErrorText error={transition.error} /></div>}
    {viewId && <OrderDetailModal tenant={tenant} orderId={viewId} onClose={() => setViewId(null)} />}
    {createOpen && canCreate && <OrderModal tenant={tenant} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); refresh(); }} />}
    {fulfilId && canUpdateLifecycle && <FulfilModal tenant={tenant} orderId={fulfilId} onClose={() => setFulfilId(null)} onDone={() => { setFulfilId(null); refresh(); }} />}
    {returnId && canUpdateLifecycle && <ReturnModal tenant={tenant} orderId={returnId} onClose={() => setReturnId(null)} onDone={() => { setReturnId(null); refresh(); }} />}
  </>;
}

function OrderModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const customers = useQuery({ queryKey: ["tenant", tenant.id, "customers"], queryFn: () => tenantApi<Customer[]>(tenant.id, "/customers") });
  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations") });
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const inventory = useQuery({ queryKey: ["tenant", tenant.id, "inventory"], queryFn: () => tenantApi<InventoryRow[]>(tenant.id, "/inventory") });
  const variants = useMemo(() => (products.data || []).flatMap(product => product.variants.map(variant => ({ ...variant, productName: product.name, modifiers: product.modifiers }))), [products.data]);
  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ id: crypto.randomUUID(), variantId: "", quantity: "1", modifierIds: [] }]);
  const patchLine = (lineId: string, patch: Partial<DraftLine>) => setLines(current => current.map(line => line.id === lineId ? { ...line, ...patch } : line));
  const mutation = useMutation({
    mutationFn: () => tenantApi(tenant.id, "/orders", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerId || undefined,
        locationId,
        notes: notes || undefined,
        lines: lines.map(line => ({ variantId: line.variantId, quantity: Number(line.quantity), modifiers: line.modifierIds.map(modifierId => ({ modifierId, quantity: 1 })) })),
      }),
    }),
    onSuccess: onCreated,
  });
  const availableFor = (variantId: string) => inventory.data?.find(row => row.variant_id === variantId && row.location_id === locationId)?.available ?? 0;

  return <Modal title="New order" subtitle="This creates a draft with price, tax, SKU and modifier snapshots. Confirm it when you are ready to reserve stock." onClose={onClose} wide><form className="form-grid" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="Customer"><select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Guest / no saved customer</option>{customers.data?.map(customer => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></Field><Field label="Fulfil from"><select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Select stock location</option>{locations.data?.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></Field><Field label="Notes"><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Internal order notes" /></Field><div />
      <div className="form-section full-span"><div><p className="eyebrow">Lines</p><h3>What is being ordered?</h3></div><button type="button" className="secondary" onClick={() => setLines(current => [...current, { id: crypto.randomUUID(), variantId: "", quantity: "1", modifierIds: [] }])}><Plus size={15} /> Add line</button></div>
      <div className="order-compose full-span">{lines.map((line, index) => { const selected = variants.find(variant => variant.id === line.variantId); const available = line.variantId && locationId ? availableFor(line.variantId) : null; return <div className="order-compose-line" key={line.id}><div className="line-number">{index + 1}</div><div className="order-line-fields"><Field label="Product variant"><select required value={line.variantId} onChange={event => patchLine(line.id, { variantId: event.target.value, modifierIds: [] })}><option value="">Choose variant</option>{variants.map(variant => <option value={variant.id} key={variant.id}>{variant.productName} · {variant.name} — {variant.sku} · {money(variant.price_minor)}</option>)}</select></Field><Field label="Quantity" hint={available === null ? undefined : `${available} currently available at this location`}><input required type="number" min="1" step="1" value={line.quantity} onChange={event => patchLine(line.id, { quantity: event.target.value })} /></Field></div>{selected?.modifiers.length ? <div className="modifier-picks"><span>Add-ons</span>{selected.modifiers.map(modifier => <label key={modifier.id}><input type="checkbox" checked={line.modifierIds.includes(modifier.id)} onChange={event => patchLine(line.id, { modifierIds: event.target.checked ? [...line.modifierIds, modifier.id] : line.modifierIds.filter(id => id !== modifier.id) })} />{modifier.name} {modifier.price_delta_minor ? `(${modifier.price_delta_minor > 0 ? "+" : ""}${money(modifier.price_delta_minor)})` : ""}</label>)}</div> : null}<button type="button" className="icon-button line-remove" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(item => item.id !== line.id))} aria-label="Remove line"><Trash2 size={16} /></button></div>; })}</div>
      {mutation.error && <ErrorText error={mutation.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !locationId || lines.some(line => !line.variantId)}>Create draft order</button></div>
    </form></Modal>;
}

function FulfilModal({ tenant, orderId, onClose, onDone }: { tenant: OrganizationSummary; orderId: string; onClose: () => void; onDone: () => void }) {
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "order", orderId], queryFn: () => tenantApi<OrderDetail>(tenant.id, `/orders/${orderId}`) });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/orders/${orderId}/fulfil`, { method: "POST", body: JSON.stringify({ lines: detail.data!.lines.map(line => ({ lineId: line.id, quantity: Number(quantities[line.id] ?? (line.quantity - line.quantity_fulfilled)) })).filter(line => line.quantity > 0) }) }), onSuccess: onDone });
  return <Modal title={detail.data ? `Fulfil ${detail.data.number}` : "Fulfil order"} subtitle="Fulfil only what actually leaves the location. Remaining quantities stay reserved for the next fulfilment." onClose={onClose} wide>{detail.isLoading ? <div className="empty-state"><div className="loader" /></div> : detail.error ? <ErrorText error={detail.error} /> : <form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><div className="receive-list">{detail.data?.lines.map(line => { const remaining = line.quantity - line.quantity_fulfilled; return <div className="receive-row" key={line.id}><div><strong>{line.product_name_snapshot} · {line.variant_name_snapshot}</strong><small className="mono">{line.sku_snapshot}</small></div><span>{line.quantity_fulfilled} fulfilled / {line.quantity} ordered</span><input aria-label={`Fulfil ${line.product_name_snapshot}`} type="number" min="0" max={remaining} step="1" disabled={remaining === 0} value={quantities[line.id] ?? String(remaining)} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} /></div>; })}</div>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !detail.data?.lines.some(line => Number(quantities[line.id] ?? (line.quantity - line.quantity_fulfilled)) > 0)}>Complete fulfilment</button></div></form>}</Modal>;
}

function ReturnModal({ tenant, orderId, onClose, onDone }: { tenant: OrganizationSummary; orderId: string; onClose: () => void; onDone: () => void }) {
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "order", orderId], queryFn: () => tenantApi<OrderDetail>(tenant.id, `/orders/${orderId}`) });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, `/orders/${orderId}/return`, { method: "POST", body: JSON.stringify({ notes: notes || undefined, lines: detail.data!.lines.map(line => ({ lineId: line.id, quantity: Number(quantities[line.id] || 0), restock: restock[line.id] ?? true })).filter(line => line.quantity > 0) }) }), onSuccess: onDone });
  return <Modal title={detail.data ? `Return against ${detail.data.number}` : "Return items"} subtitle="Returned quantity is independent from restocking. Damaged or unsellable items can be returned commercially without increasing on-hand stock." onClose={onClose} wide>{detail.isLoading ? <div className="empty-state"><div className="loader" /></div> : detail.error ? <ErrorText error={detail.error} /> : <form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><div className="receive-list">{detail.data?.lines.map(line => { const returnable = line.quantity_fulfilled - line.quantity_returned; return <div className="return-row" key={line.id}><div><strong>{line.product_name_snapshot} · {line.variant_name_snapshot}</strong><small>{returnable} returnable · {line.quantity_returned} already returned</small></div><input aria-label={`Return ${line.product_name_snapshot}`} type="number" min="0" max={returnable} step="1" value={quantities[line.id] || "0"} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} /><label className="restock-check"><input type="checkbox" checked={restock[line.id] ?? true} onChange={event => setRestock(current => ({ ...current, [line.id]: event.target.checked }))} /> Restock</label></div>; })}</div><Field label="Return notes"><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Reason, condition, reference…" /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !Object.values(quantities).some(value => Number(value) > 0)}>Record return</button></div></form>}</Modal>;
}
