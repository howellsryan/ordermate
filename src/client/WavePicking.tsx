import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Layers3, Minus, PackageCheck, Plus, ScanBarcode, X } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import CameraBarcodeScanner from "./CameraBarcodeScanner";
import { tenantApi } from "./api";
import type { Order, OrderDetail } from "./model";
import { priorityLabel } from "./order-priority";
import { applyWarehouseBarcodeScan, setWarehouseLineCount, type WarehouseScanCounts, type WarehouseScanTarget } from "./warehouse-scan";
import { aggregatePlanCounts, buildWaveTargets, commitWaveFulfilments, distributeWaveCounts, type WaveCommitResult } from "./wave-pick";
import { ErrorText, Modal } from "./ui";

type Feedback = { tone: "success" | "warning" | "error"; message: string } | null;

export default function WavePicking({ tenant, orders, barcodeByVariant }: {
  tenant: OrganizationSummary;
  orders: Order[];
  barcodeByVariant: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const selected = orders.filter(order => selectedIds.includes(order.id));
  const selectedLocationId = selected[0]?.location_id || null;

  const toggle = (order: Order) => {
    if (selectedIds.includes(order.id)) {
      setSelectedIds(current => current.filter(id => id !== order.id));
      return;
    }
    if (selectedIds.length >= 10) return;
    if (selectedLocationId && order.location_id !== selectedLocationId) return;
    setSelectedIds(current => [...current, order.id]);
  };

  const finish = (results: WaveCommitResult[]) => {
    const remaining = new Set(results.filter(result => result.status !== "fulfilled").map(result => result.orderId));
    setSelectedIds(current => current.filter(id => remaining.has(id)));
    if (!remaining.size) {
      setReviewOpen(false);
      setExpanded(false);
    }
  };

  if (orders.length < 2) return null;

  return <section className="panel wave-builder">
    <div className="wave-builder-head">
      <div className="wave-builder-icon"><Layers3 size={19} aria-hidden="true" /></div>
      <div><p className="eyebrow">Batch picking</p><h3>Wave pick compatible orders</h3><p>Group up to 10 orders from one stock location, scan aggregate quantities once, then fulfil each order through its normal reservation-safe endpoint.</p></div>
      <button type="button" className="secondary" onClick={() => { setExpanded(value => !value); if (expanded) setSelectedIds([]); }}><Layers3 size={15} aria-hidden="true" /> {expanded ? "Close wave" : "Build wave"}</button>
    </div>
    {expanded && <div className="wave-builder-body">
      <div className="wave-selection-note"><span>{selected.length ? `${selected.length} selected${selected[0] ? ` · ${selected[0].location_name}` : ""}` : "Choose the first order to lock the wave location."}</span><small>Higher-priority orders receive aggregate picked units first. Different locations cannot be mixed.</small></div>
      <div className="wave-order-grid">{orders.map(order => {
        const checked = selectedIds.includes(order.id);
        const wrongLocation = !!selectedLocationId && order.location_id !== selectedLocationId;
        const maxed = selectedIds.length >= 10 && !checked;
        return <label key={order.id} className={`wave-order-choice ${checked ? "selected" : ""} ${wrongLocation || maxed ? "disabled" : ""}`}>
          <input type="checkbox" checked={checked} disabled={wrongLocation || maxed} onChange={() => toggle(order)} />
          <span><strong>{order.number}</strong><small>{order.customer_name || "Guest"} · {order.location_name}</small></span>
          <b className={`order-priority order-priority-${order.priority}`}>{priorityLabel(order.priority)}</b>
        </label>;
      })}</div>
      <div className="wave-builder-actions"><span>{selected.length < 2 ? "Select at least two orders from the same location." : `${selected.length} orders ready for aggregate picking.`}</span><button type="button" className="primary" disabled={selected.length < 2} onClick={() => setReviewOpen(true)}><PackageCheck size={15} aria-hidden="true" /> Review wave</button></div>
    </div>}
    {reviewOpen && selected.length >= 2 && <WavePickModal tenant={tenant} orders={selected} barcodeByVariant={barcodeByVariant} onClose={() => setReviewOpen(false)} onCommitted={finish} />}
  </section>;
}

function WavePickModal({ tenant, orders, barcodeByVariant, onClose, onCommitted }: {
  tenant: OrganizationSummary;
  orders: Order[];
  barcodeByVariant: Map<string, string>;
  onClose: () => void;
  onCommitted: (results: WaveCommitResult[]) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [barcode, setBarcode] = useState("");
  const [counts, setCounts] = useState<WarehouseScanCounts>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const ids = orders.map(order => order.id);
  const details = useQuery({
    queryKey: ["tenant", tenant.id, "wave-pick", ...ids],
    queryFn: () => Promise.all(ids.map(orderId => tenantApi<OrderDetail>(tenant.id, `/orders/${orderId}`))),
  });

  const targets = useMemo(() => buildWaveTargets(details.data || [], barcodeByVariant), [details.data, barcodeByVariant]);
  const scanTargets: WarehouseScanTarget[] = targets.map(target => ({
    lineId: target.variantId,
    variantId: target.variantId,
    barcode: target.barcode,
    remaining: target.remaining,
  }));
  const plan = useMemo(() => distributeWaveCounts(details.data || [], counts), [details.data, counts]);
  const staged = Object.values(counts).reduce((sum, quantity) => sum + quantity, 0);
  const allocated = Object.values(aggregatePlanCounts(plan.orders)).reduce((sum, quantity) => sum + quantity, 0);
  const everySelectedOrderAffected = plan.orders.length === orders.length;

  const commit = useMutation({
    mutationFn: () => commitWaveFulfilments(plan.orders, async order => {
      await tenantApi(tenant.id, `/orders/${order.orderId}/fulfil`, {
        method: "POST",
        body: JSON.stringify({ lines: order.lines.map(line => ({ lineId: line.lineId, quantity: line.quantity })) }),
      });
    }),
    onSuccess: async results => {
      const failed = results.filter(result => result.status === "failed");
      const notAttempted = results.filter(result => result.status === "not_attempted");
      const successful = results.filter(result => result.status === "fulfilled");
      setCounts({});
      setBarcode("");
      setFeedback(failed.length
        ? { tone: "warning", message: `${successful.length} order${successful.length === 1 ? "" : "s"} fulfilled; ${failed.length} failed; ${notAttempted.length} not attempted. Successful orders have been removed from the wave. Refresh and re-scan the remaining orders before trying again.` }
        : { tone: "success", message: `${successful.length} order${successful.length === 1 ? "" : "s"} fulfilled through their canonical order transactions.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "orders"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
      ]);
      onCommitted(results);
    },
  });

  const scan = (value: string) => {
    if (commit.isPending) return;
    const result = applyWarehouseBarcodeScan(scanTargets, counts, value);
    setCounts(result.counts);
    const target = targets.find(item => item.variantId === result.lineId);
    if (result.outcome === "matched") setFeedback({ tone: "success", message: `${target?.productName || "Item"} scanned into the wave.` });
    else if (result.outcome === "complete") setFeedback({ tone: "warning", message: "The wave already contains the full outstanding quantity for that item." });
    else if (result.outcome === "ambiguous") setFeedback({ tone: "error", message: "This barcode belongs to more than one variant in the wave. Resolve the catalogue barcode before continuing." });
    else setFeedback({ tone: "error", message: "That barcode is not outstanding on any selected order." });
    setBarcode("");
    queueMicrotask(() => inputRef.current?.focus());
  };

  const sameLocation = !details.data || new Set(details.data.map(order => order.location_id)).size <= 1;
  const unallocated = Object.values(plan.unallocated).reduce((sum, quantity) => sum + quantity, 0);

  return <Modal title={`Wave pick · ${orders.length} orders`} subtitle="Scan aggregate quantities once. Before commit, OrderMate expands the picked units back into exact order lines in the urgency order shown in Warehouse." onClose={onClose} wide>
    {details.isLoading ? <div className="wave-loading" role="status" aria-live="polite"><div className="loader" /><span>Loading selected order reservations…</span></div> : details.error ? <ErrorText error={details.error} /> : !sameLocation ? <div className="wave-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>Selected orders no longer share one stock location. Close the wave and rebuild the selection.</span></div> : <div className="wave-session">
      <div className="wave-summary">
        <span><small>Orders</small><strong>{orders.length}</strong></span><span><small>Unique SKUs</small><strong>{targets.length}</strong></span><span><small>Staged</small><strong>{staged}</strong></span><span><small>Orders affected</small><strong>{plan.orders.length}</strong></span>
      </div>
      <form className="wave-scan" onSubmit={event => { event.preventDefault(); if (barcode.trim()) scan(barcode.trim()); }}>
        <ScanBarcode size={20} aria-hidden="true" /><input ref={inputRef} name="wave-barcode" aria-label="Wave barcode" value={barcode} onChange={event => setBarcode(event.target.value)} placeholder="Scan or enter barcode…" autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={commit.isPending} /><button className="secondary" disabled={commit.isPending || !barcode.trim()}>Add scan</button><CameraBarcodeScanner onScan={scan} label="Camera" disabled={commit.isPending} />
      </form>
      {feedback && <div className={`wave-feedback ${feedback.tone}`} role="status" aria-live="polite">{feedback.tone === "success" ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}<span>{feedback.message}</span></div>}
      <div className="wave-lines">{targets.map(target => {
        const value = counts[target.variantId] || 0;
        const scanTarget = scanTargets.find(item => item.variantId === target.variantId)!;
        return <div className={`wave-line ${value === target.remaining && target.remaining > 0 ? "complete" : ""}`} key={target.variantId}>
          <div><strong>{target.productName} · {target.variantName}</strong><small className="mono">{target.sku}{target.barcode ? ` · ${target.barcode}` : ""}</small></div>
          <span><small>Outstanding in wave</small><strong>{target.remaining}</strong></span>
          <div className="line-counter"><button type="button" className="icon-button" disabled={value <= 0 || commit.isPending} onClick={() => setCounts(current => setWarehouseLineCount(current, scanTarget, value - 1))} aria-label="Remove one wave unit"><Minus size={14} aria-hidden="true" /></button><span><strong>{value}</strong><small> / {target.remaining}</small></span><button type="button" className="icon-button" disabled={value >= target.remaining || commit.isPending} onClick={() => setCounts(current => setWarehouseLineCount(current, scanTarget, value + 1))} aria-label="Add one wave unit"><Plus size={14} aria-hidden="true" /></button></div>
        </div>;
      })}</div>
      <div className="wave-allocation">
        <div className="panel-heading"><div><p className="eyebrow">Commit preview</p><h3>Per-order allocation</h3></div><span>{allocated} unit{allocated === 1 ? "" : "s"}</span></div>
        {plan.orders.length ? plan.orders.map(order => <div className="wave-allocation-order" key={order.orderId}><span><strong>{order.orderNumber}</strong><small>{order.lines.length} line{order.lines.length === 1 ? "" : "s"}</small></span><b>{order.lines.reduce((sum, line) => sum + line.quantity, 0)} units</b></div>) : <p className="form-note">Scan or add quantities to see how the wave will be split across orders.</p>}
      </div>
      {staged > 0 && !everySelectedOrderAffected && <div className="wave-error" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>Every selected order must have at least one staged unit before the wave can be committed. Remove untouched orders or scan an item for them.</span></div>}
      {unallocated > 0 && <div className="wave-error" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>{unallocated} staged unit{unallocated === 1 ? "" : "s"} cannot be allocated to current outstanding lines. Refresh the wave before committing.</span></div>}
      {commit.error && <ErrorText error={commit.error} />}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={commit.isPending}><X size={15} aria-hidden="true" /> Close</button><button type="button" className="primary" disabled={commit.isPending || allocated === 0 || unallocated > 0 || !sameLocation || !everySelectedOrderAffected} onClick={() => commit.mutate()}><PackageCheck size={15} aria-hidden="true" /> Fulfil staged wave</button></div>
    </div>}
  </Modal>;
}
