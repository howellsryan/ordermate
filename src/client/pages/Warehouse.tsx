import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Minus, PackageCheck, Plus, ScanBarcode, Truck } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import DeliveryNoteAssist from "../DeliveryNoteAssist";
import { controlApi, date, tenantApi } from "../api";
import type { Order, OrderDetail, Product, PurchaseOrder, PurchaseOrderDetail } from "../model";
import { applyWarehouseBarcodeScan, setWarehouseLineCount, type WarehouseScanCounts, type WarehouseScanTarget } from "../warehouse-scan";
import { DataState, ErrorText, PageHeader, Status } from "../ui";

type Mode = "pick" | "receive";
type Feedback = { tone: "success" | "warning" | "error"; message: string } | null;

export default function Warehouse({ tenant }: { tenant: OrganizationSummary }) {
  const canFulfil = ["owner", "admin", "manager", "fulfilment"].includes(tenant.role);
  const canReceive = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const [mode, setMode] = useState<Mode>(canFulfil ? "pick" : "receive");
  const products = useQuery({
    queryKey: ["tenant", tenant.id, "products"],
    queryFn: () => tenantApi<Product[]>(tenant.id, "/products"),
  });

  useEffect(() => {
    if (mode === "pick" && !canFulfil) setMode("receive");
    if (mode === "receive" && !canReceive) setMode("pick");
  }, [canFulfil, canReceive, mode]);

  const barcodeByVariant = useMemo(() => new Map(
    (products.data || []).flatMap(product => product.variants.map(variant => [variant.id, variant.barcode || ""] as const)),
  ), [products.data]);

  return <>
    <PageHeader
      eyebrow="Warehouse"
      title="Scan operations"
      description="Use a USB/Bluetooth scanner or type a barcode and press Enter. Scans only prepare quantities; stock changes happen through the normal audited fulfilment and receiving transactions."
    />
    <div className="warehouse-mode" role="tablist" aria-label="Warehouse workflow">
      {canFulfil && <button role="tab" aria-selected={mode === "pick"} className={mode === "pick" ? "active" : ""} onClick={() => setMode("pick")}><PackageCheck size={16} /> Pick & fulfil</button>}
      {canReceive && <button role="tab" aria-selected={mode === "receive"} className={mode === "receive" ? "active" : ""} onClick={() => setMode("receive")}><Truck size={16} /> Receive stock</button>}
    </div>
    {products.isLoading ? <div className="panel empty-state" role="status"><div className="loader" /><span>Loading barcode catalogue…</span></div> : products.error ? <ErrorText error={products.error} /> : <>
      {mode === "pick" && canFulfil && <PickingWorkspace tenant={tenant} barcodeByVariant={barcodeByVariant} />}
      {mode === "receive" && canReceive && <ReceivingWorkspace tenant={tenant} barcodeByVariant={barcodeByVariant} />}
    </>}
  </>;
}

function PickingWorkspace({ tenant, barcodeByVariant }: { tenant: OrganizationSummary; barcodeByVariant: Map<string, string> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const orders = useQuery({ queryKey: ["tenant", tenant.id, "orders"], queryFn: () => tenantApi<Order[]>(tenant.id, "/orders") });
  const openOrders = (orders.data || []).filter(order => order.status === "confirmed" && order.fulfilment_status !== "fulfilled");

  useEffect(() => {
    if (selectedId && !openOrders.some(order => order.id === selectedId)) setSelectedId(null);
  }, [selectedId, openOrders.map(order => order.id).join("|")]);

  return <div className="warehouse-layout">
    <section className="panel warehouse-queue">
      <div className="panel-heading"><div><p className="eyebrow">Pick queue</p><h3>Orders awaiting fulfilment</h3></div><span className="queue-count">{openOrders.length}</span></div>
      <DataState loading={orders.isLoading} error={orders.error} empty={!openOrders.length} emptyText="Confirmed orders will appear here when stock is ready to pick.">
        <div className="warehouse-documents">{openOrders.map(order => <button key={order.id} className={`warehouse-document ${selectedId === order.id ? "active" : ""}`} onClick={() => setSelectedId(order.id)}>
          <span><strong>{order.number}</strong><small>{order.customer_name || "Guest"} · {order.location_name}</small></span>
          <span><Status value={order.fulfilment_status} /><small>{date(order.created_at)}</small></span>
        </button>)}</div>
      </DataState>
    </section>
    <section className="panel warehouse-session">
      {selectedId ? <PickSession tenant={tenant} orderId={selectedId} barcodeByVariant={barcodeByVariant} /> : <WarehousePlaceholder icon={<PackageCheck size={30} />} title="Choose an order to start picking" text="The scanner stays document-aware: a barcode that is not on the selected order is rejected instead of silently changing another item." />}
    </section>
  </div>;
}

function PickSession({ tenant, orderId, barcodeByVariant }: { tenant: OrganizationSummary; orderId: string; barcodeByVariant: Map<string, string> }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<WarehouseScanCounts>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "order", orderId], queryFn: () => tenantApi<OrderDetail>(tenant.id, `/orders/${orderId}`) });

  useEffect(() => {
    setCounts({});
    setFeedback(null);
    queueMicrotask(() => inputRef.current?.focus());
  }, [orderId]);

  const targets: WarehouseScanTarget[] = (detail.data?.lines || []).map(line => ({
    lineId: line.id,
    variantId: line.variant_id,
    barcode: barcodeByVariant.get(line.variant_id) || "",
    remaining: Math.max(0, line.quantity - line.quantity_fulfilled),
  }));
  const picked = Object.values(counts).reduce((sum, quantity) => sum + quantity, 0);
  const outstanding = targets.reduce((sum, target) => sum + target.remaining, 0);

  const fulfil = useMutation({
    mutationFn: () => tenantApi(tenant.id, `/orders/${orderId}/fulfil`, {
      method: "POST",
      body: JSON.stringify({ lines: targets.map(target => ({ lineId: target.lineId, quantity: counts[target.lineId] || 0 })).filter(line => line.quantity > 0) }),
    }),
    onSuccess: async () => {
      setCounts({});
      setFeedback({ tone: "success", message: "Picked stock fulfilled and written to inventory history." });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "orders"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "order", orderId] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
      ]);
      inputRef.current?.focus();
    },
  });

  const scan = (barcode: string) => {
    const result = applyWarehouseBarcodeScan(targets, counts, barcode);
    setCounts(result.counts);
    if (result.outcome === "matched") {
      const line = detail.data?.lines.find(item => item.id === result.lineId);
      setFeedback({ tone: "success", message: `${line?.product_name_snapshot || "Item"} scanned.` });
    } else if (result.outcome === "complete") {
      setFeedback({ tone: "warning", message: "That item is already fully picked for this order." });
    } else if (result.outcome === "ambiguous") {
      setFeedback({ tone: "error", message: "This barcode maps to more than one variant on the order. Resolve the catalogue barcode before continuing." });
    } else {
      setFeedback({ tone: "error", message: "Wrong item: that barcode is not required on this order." });
    }
    inputRef.current?.focus();
  };

  if (detail.isLoading) return <div className="warehouse-placeholder"><div className="loader" /><span>Loading pick list…</span></div>;
  if (detail.error) return <ErrorText error={detail.error} />;
  if (!detail.data) return null;

  return <div className="scan-session">
    <div className="scan-session-head"><div><p className="eyebrow">Picking {detail.data.number}</p><h2>{detail.data.customer_name || "Guest order"}</h2><p>{detail.data.location_name} · {outstanding} unit{outstanding === 1 ? "" : "s"} outstanding</p></div><div className="scan-progress"><strong>{picked}</strong><span>picked now</span></div></div>
    <BarcodeCapture inputRef={inputRef} onScan={scan} feedback={feedback} label="Scan product barcode" />
    <div className="scan-lines">{detail.data.lines.map(line => {
      const target = targets.find(item => item.lineId === line.id)!;
      const current = counts[line.id] || 0;
      return <div className={`scan-line ${current === target.remaining && target.remaining > 0 ? "complete" : ""}`} key={line.id}>
        <div className="scan-line-copy"><strong>{line.product_name_snapshot} · {line.variant_name_snapshot}</strong><span className="mono">{line.sku_snapshot}</span><small>{barcodeByVariant.get(line.variant_id) || "No barcode assigned — use the + control"}</small>{line.modifiers.length > 0 && <small>{line.modifiers.map(modifier => modifier.name_snapshot).join(" · ")}</small>}</div>
        <div className="scan-line-required"><small>Already fulfilled</small><strong>{line.quantity_fulfilled} / {line.quantity}</strong></div>
        <LineCounter value={current} max={target.remaining} onChange={value => setCounts(existing => setWarehouseLineCount(existing, target, value))} />
      </div>;
    })}</div>
    {fulfil.error && <ErrorText error={fulfil.error} />}
    <div className="warehouse-commit"><div><strong>{picked ? `${picked} unit${picked === 1 ? "" : "s"} ready to fulfil` : "Nothing picked yet"}</strong><span>Scanning only stages counts. This button performs the audited stock movement.</span></div><button className="primary" disabled={fulfil.isPending || picked === 0} onClick={() => fulfil.mutate()}><PackageCheck size={16} /> Fulfil picked items</button></div>
  </div>;
}

function ReceivingWorkspace({ tenant, barcodeByVariant }: { tenant: OrganizationSummary; barcodeByVariant: Map<string, string> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const purchaseOrders = useQuery({ queryKey: ["tenant", tenant.id, "purchase-orders"], queryFn: () => tenantApi<PurchaseOrder[]>(tenant.id, "/purchase-orders") });
  const openPurchaseOrders = (purchaseOrders.data || []).filter(po => ["ordered", "partially_received"].includes(po.status));

  useEffect(() => {
    if (selectedId && !openPurchaseOrders.some(po => po.id === selectedId)) setSelectedId(null);
  }, [selectedId, openPurchaseOrders.map(po => po.id).join("|")]);

  return <div className="warehouse-layout">
    <section className="panel warehouse-queue">
      <div className="panel-heading"><div><p className="eyebrow">Receiving queue</p><h3>Purchase orders due in</h3></div><span className="queue-count">{openPurchaseOrders.length}</span></div>
      <DataState loading={purchaseOrders.isLoading} error={purchaseOrders.error} empty={!openPurchaseOrders.length} emptyText="Submitted purchase orders will appear here until everything is received.">
        <div className="warehouse-documents">{openPurchaseOrders.map(po => <button key={po.id} className={`warehouse-document ${selectedId === po.id ? "active" : ""}`} onClick={() => setSelectedId(po.id)}>
          <span><strong>{po.number}</strong><small>{po.supplier_name} · {po.location_name}</small></span>
          <span><Status value={po.status} /><small>{date(po.created_at)}</small></span>
        </button>)}</div>
      </DataState>
    </section>
    <section className="panel warehouse-session">
      {selectedId ? <ReceiveSession tenant={tenant} purchaseOrderId={selectedId} barcodeByVariant={barcodeByVariant} /> : <WarehousePlaceholder icon={<Truck size={30} />} title="Choose a purchase order to receive" text="Scan only what physically arrived. Partial deliveries remain incoming and can be received in a later session." />}
    </section>
  </div>;
}

function ReceiveSession({ tenant, purchaseOrderId, barcodeByVariant }: { tenant: OrganizationSummary; purchaseOrderId: string; barcodeByVariant: Map<string, string> }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<WarehouseScanCounts>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [appliedProposalKey, setAppliedProposalKey] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId], queryFn: () => tenantApi<PurchaseOrderDetail>(tenant.id, `/purchase-orders/${purchaseOrderId}`) });

  useEffect(() => {
    setCounts({});
    setFeedback(null);
    setAppliedProposalKey(null);
    queueMicrotask(() => inputRef.current?.focus());
  }, [purchaseOrderId]);

  const targets: WarehouseScanTarget[] = (detail.data?.lines || []).map(line => ({
    lineId: line.id,
    variantId: line.variant_id,
    barcode: barcodeByVariant.get(line.variant_id) || "",
    remaining: Math.max(0, line.quantity_ordered - line.quantity_received),
  }));
  const scanned = Object.values(counts).reduce((sum, quantity) => sum + quantity, 0);
  const outstanding = targets.reduce((sum, target) => sum + target.remaining, 0);

  const receive = useMutation({
    mutationFn: async () => {
      await tenantApi(tenant.id, `/purchase-orders/${purchaseOrderId}/receive`, {
        method: "POST",
        body: JSON.stringify({ lines: targets.map(target => ({ lineId: target.lineId, quantity: counts[target.lineId] || 0 })).filter(line => line.quantity > 0) }),
      });
      let completionError: string | undefined;
      if (appliedProposalKey) {
        try {
          await controlApi("/delivery-documents/proposal/complete", {
            method: "POST",
            headers: { "x-ordermate-tenant": tenant.id },
            body: JSON.stringify({ key: appliedProposalKey, purchaseOrderId }),
          });
        } catch (cause) {
          completionError = cause instanceof Error ? cause.message : "Delivery proposal status could not be updated";
        }
      }
      return { completionError };
    },
    onSuccess: async result => {
      setCounts({});
      setAppliedProposalKey(null);
      setFeedback(result.completionError
        ? { tone: "warning", message: `Stock was received successfully, but the delivery-note proposal could not be marked accepted: ${result.completionError}. Do not receive these units again.` }
        : { tone: "success", message: "Scanned delivery received and written to stock history." });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-orders"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "purchase-order", purchaseOrderId] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-proposals", purchaseOrderId] }),
      ]);
      inputRef.current?.focus();
    },
  });

  const scan = (barcode: string) => {
    const result = applyWarehouseBarcodeScan(targets, counts, barcode);
    setCounts(result.counts);
    if (result.outcome === "matched") {
      const line = detail.data?.lines.find(item => item.id === result.lineId);
      setFeedback({ tone: "success", message: `${line?.description_snapshot || "Item"} scanned into this delivery.` });
    } else if (result.outcome === "complete") {
      setFeedback({ tone: "warning", message: "The outstanding quantity for that PO line is already fully scanned." });
    } else if (result.outcome === "ambiguous") {
      setFeedback({ tone: "error", message: "This barcode maps to more than one variant on the PO. Resolve the catalogue barcode before receiving." });
    } else {
      setFeedback({ tone: "error", message: "Unexpected item: that barcode is not outstanding on this purchase order." });
    }
    inputRef.current?.focus();
  };

  if (detail.isLoading) return <div className="warehouse-placeholder"><div className="loader" /><span>Loading receiving list…</span></div>;
  if (detail.error) return <ErrorText error={detail.error} />;
  if (!detail.data) return null;

  return <div className="scan-session">
    <div className="scan-session-head"><div><p className="eyebrow">Receiving {detail.data.number}</p><h2>{detail.data.supplier_name}</h2><p>Into {detail.data.location_name} · {outstanding} unit{outstanding === 1 ? "" : "s"} still expected</p></div><div className="scan-progress"><strong>{scanned}</strong><span>staged now</span></div></div>
    <DeliveryNoteAssist tenant={tenant} purchaseOrderId={purchaseOrderId} onApply={(proposalCounts, proposalKey) => {
      setCounts(proposalCounts);
      setAppliedProposalKey(proposalKey);
      setFeedback({ tone: "success", message: "Reviewed delivery-note quantities loaded. Scan or edit them further, then press Receive scanned stock." });
      queueMicrotask(() => inputRef.current?.focus());
    }} />
    <BarcodeCapture inputRef={inputRef} onScan={scan} feedback={feedback} label="Scan delivered product barcode" />
    <div className="scan-lines">{detail.data.lines.map(line => {
      const target = targets.find(item => item.lineId === line.id)!;
      const current = counts[line.id] || 0;
      return <div className={`scan-line ${current === target.remaining && target.remaining > 0 ? "complete" : ""}`} key={line.id}>
        <div className="scan-line-copy"><strong>{line.description_snapshot}</strong><span className="mono">{line.sku_snapshot}</span><small>{barcodeByVariant.get(line.variant_id) || "No barcode assigned — use the + control"}</small></div>
        <div className="scan-line-required"><small>Already received</small><strong>{line.quantity_received} / {line.quantity_ordered}</strong></div>
        <LineCounter value={current} max={target.remaining} onChange={value => setCounts(existing => setWarehouseLineCount(existing, target, value))} />
      </div>;
    })}</div>
    {receive.error && <ErrorText error={receive.error} />}
    <div className="warehouse-commit"><div><strong>{scanned ? `${scanned} unit${scanned === 1 ? "" : "s"} ready to receive` : "Nothing scanned yet"}</strong><span>Only these staged quantities will increase on-hand stock.{appliedProposalKey ? " A reviewed delivery-note proposal is attached to this receipt." : ""}</span></div><button className="primary" disabled={receive.isPending || scanned === 0} onClick={() => receive.mutate()}><Truck size={16} /> Receive scanned stock</button></div>
  </div>;
}

function BarcodeCapture({ inputRef, onScan, feedback, label }: { inputRef: RefObject<HTMLInputElement | null>; onScan: (barcode: string) => void; feedback: Feedback; label: string }) {
  const [value, setValue] = useState("");
  return <form className="barcode-capture" onSubmit={event => { event.preventDefault(); const barcode = value.trim(); if (!barcode) return; onScan(barcode); setValue(""); }}>
    <div className="barcode-input-wrap"><ScanBarcode size={22} /><label><span>{label}</span><input ref={inputRef} value={value} onChange={event => setValue(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="text" placeholder="Scan or enter barcode…" /></label><button className="secondary" disabled={!value.trim()}>Add scan</button></div>
    <div className={`scan-feedback ${feedback?.tone || "idle"}`} aria-live="polite">{feedback ? <>{feedback.tone === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{feedback.message}</span></> : <><ScanBarcode size={15} /><span>Scanner ready. Each successful scan adds one unit.</span></>}</div>
  </form>;
}

function LineCounter({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return <div className="line-counter"><button type="button" className="icon-button" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label="Remove one scanned unit"><Minus size={14} /></button><span><strong>{value}</strong><small> / {max}</small></span><button type="button" className="icon-button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Add one unit manually"><Plus size={14} /></button></div>;
}

function WarehousePlaceholder({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="warehouse-placeholder"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>;
}
