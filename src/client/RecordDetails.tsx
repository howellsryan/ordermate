import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrganizationSummary } from "../shared/types";
import { calendarDate, date, isOverdueDate, money, tenantApi } from "./api";
import type { OrderDetail, PurchaseOrderDetail } from "./model";
import { ErrorText, Modal, Status } from "./ui";

export function OrderDetailModal({ tenant, orderId, onClose }: { tenant: OrganizationSummary; orderId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["tenant", tenant.id, "order", orderId],
    queryFn: () => tenantApi<OrderDetail>(tenant.id, `/orders/${orderId}`),
  });
  const order = detail.data;

  return <Modal title={order?.number || "Order details"} subtitle="The commercial snapshot captured by this order, including fulfilment and return progress." onClose={onClose} wide>
    {detail.isLoading ? <DetailLoading /> : detail.error ? <ErrorText error={detail.error} /> : order ? <div className="record-detail">
      <div className="record-summary">
        <Summary label="Customer" value={order.customer_name || "Guest"} />
        <Summary label="Location" value={order.location_name} />
        <Summary label="Created" value={date(order.created_at)} />
        <Summary label="Total" value={money(order.total_minor, order.currency)} strong />
      </div>
      <div className="record-status-row"><span>Order <Status value={order.status} /></span><span>Fulfilment <Status value={order.fulfilment_status} /></span></div>
      <div className="detail-lines">
        <div className="detail-lines-head"><span>Item</span><span>Qty</span><span>Fulfilled</span><span>Returned</span><span>Unit</span></div>
        {order.lines.map(line => <div className="detail-line" key={line.id}>
          <div><strong>{line.product_name_snapshot} · {line.variant_name_snapshot}</strong><small className="mono">{line.sku_snapshot}</small>{line.modifiers.length > 0 && <span className="line-modifiers">{line.modifiers.map(modifier => `${modifier.name_snapshot} × ${modifier.quantity}`).join(" · ")}</span>}</div>
          <span>{line.quantity}</span><span>{line.quantity_fulfilled}</span><span>{line.quantity_returned}</span><span>{money(line.unit_price_minor, order.currency)}</span>
        </div>)}
      </div>
      <div className="record-totals"><span><small>Net</small><strong>{money(order.subtotal_minor, order.currency)}</strong></span><span><small>Tax</small><strong>{money(order.tax_minor, order.currency)}</strong></span><span><small>Total</small><strong>{money(order.total_minor, order.currency)}</strong></span></div>
    </div> : null}
  </Modal>;
}

export function PurchaseOrderDetailModal({ tenant, purchaseOrderId, onClose }: { tenant: OrganizationSummary; purchaseOrderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId],
    queryFn: () => tenantApi<PurchaseOrderDetail>(tenant.id, `/purchase-orders/${purchaseOrderId}`),
  });
  const po = detail.data;
  const canWrite = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const canEditDue = !!po && canWrite && !["received", "cancelled"].includes(po.status);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");

  useEffect(() => {
    setExpectedDeliveryDate(po?.expected_delivery_date || "");
  }, [po?.id, po?.expected_delivery_date]);

  const saveExpected = useMutation({
    mutationFn: () => tenantApi<{ ok: true; expectedDeliveryDate: string | null }>(tenant.id, `/purchase-orders/${purchaseOrderId}/expected-delivery`, {
      method: "PATCH",
      body: JSON.stringify({ expectedDeliveryDate: expectedDeliveryDate || null }),
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-orders"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] }),
      ]);
    },
  });

  const overdue = !!po && ["ordered", "partially_received"].includes(po.status) && isOverdueDate(po.expected_delivery_date);

  return <Modal title={po?.number || "Purchase order details"} subtitle="Supplier commitments, snapshotted costs and receiving progress for this purchase order." onClose={onClose} wide>
    {detail.isLoading ? <DetailLoading /> : detail.error ? <ErrorText error={detail.error} /> : po ? <div className="record-detail">
      <div className="record-summary po-summary">
        <Summary label="Supplier" value={po.supplier_name} />
        <Summary label="Destination" value={po.location_name} />
        <Summary label="Expected" value={po.expected_delivery_date ? calendarDate(po.expected_delivery_date) : "Not set"} />
        <Summary label="Total" value={money(po.total_minor, po.currency)} strong />
      </div>
      <div className="record-status-row"><span>Status <Status value={po.status} /></span>{overdue && <span className="po-overdue-flag">Expected {calendarDate(po.expected_delivery_date)} · overdue</span>}</div>
      {canEditDue && <div className="po-due-editor">
        <div><strong>Expected delivery</strong><small>{po.status === "draft" ? "Set a supplier-confirmed date now, or leave blank and OrderMate will derive it on submission when every line has a known supplier lead time." : "Update this when the supplier confirms a revised arrival date."}</small></div>
        <input aria-label="Expected delivery date" type="date" value={expectedDeliveryDate} onChange={event => setExpectedDeliveryDate(event.target.value)} />
        <button className="secondary" disabled={saveExpected.isPending || expectedDeliveryDate === (po.expected_delivery_date || "")} onClick={() => saveExpected.mutate()}>{saveExpected.isPending ? "Saving…" : expectedDeliveryDate ? "Save expected date" : "Clear expected date"}</button>
      </div>}
      {saveExpected.error && <ErrorText error={saveExpected.error} />}
      <div className="detail-lines">
        <div className="detail-lines-head po"><span>Item</span><span>Ordered</span><span>Received</span><span>Outstanding</span><span>Unit cost</span></div>
        {po.lines.map(line => <div className="detail-line po" key={line.id}>
          <div><strong>{line.description_snapshot}</strong><small className="mono">{line.sku_snapshot}</small></div>
          <span>{line.quantity_ordered}</span><span>{line.quantity_received}</span><span>{line.quantity_ordered - line.quantity_received}</span><span>{money(line.unit_cost_minor, po.currency)}</span>
        </div>)}
      </div>
      <div className="record-totals"><span><small>Net</small><strong>{money(po.subtotal_minor, po.currency)}</strong></span><span><small>Tax</small><strong>{money(po.tax_minor, po.currency)}</strong></span><span><small>Total</small><strong>{money(po.total_minor, po.currency)}</strong></span></div>
    </div> : null}
  </Modal>;
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`summary-cell ${strong ? "summary-strong" : ""}`}><small>{label}</small><strong>{value}</strong></div>;
}

function DetailLoading() {
  return <div className="detail-loading"><div className="loader" /><span>Loading record…</span></div>;
}
