import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, RotateCcw, ScanBarcode, Search, X } from "lucide-react";
import type { StocktakeResponse } from "../../shared/stocktake";
import type { OrganizationSummary } from "../../shared/types";
import CameraBarcodeScanner from "../CameraBarcodeScanner";
import { tenantApi } from "../api";
import type { InventoryRow, Location } from "../model";
import { DataState, ErrorText, Field, PageHeader } from "../ui";

type Snapshot = { onHand: number; reserved: number };
type Feedback = { tone: "success" | "warning" | "error"; message: string } | null;

export default function Stocktake({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const scanInput = useRef<HTMLInputElement>(null);
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [reason, setReason] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [completed, setCompleted] = useState<StocktakeResponse | null>(null);

  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations") });
  const inventory = useQuery({ queryKey: ["tenant", tenant.id, "inventory"], queryFn: () => tenantApi<InventoryRow[]>(tenant.id, "/inventory") });

  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId(locations.data[0].id);
  }, [locationId, locations.data]);

  useEffect(() => {
    setCounts({});
    setSnapshots({});
    setFeedback(null);
    setCompleted(null);
    queueMicrotask(() => scanInput.current?.focus());
  }, [locationId]);

  const locationRows = useMemo(() => (inventory.data || []).filter(row => row.location_id === locationId), [inventory.data, locationId]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return [...locationRows]
      .filter(row => !needle || [row.product_name, row.variant_name, row.sku, row.barcode].some(value => String(value || "").toLocaleLowerCase().includes(needle)))
      .sort((a, b) => Number(counts[b.variant_id] !== undefined) - Number(counts[a.variant_id] !== undefined) || a.product_name.localeCompare(b.product_name) || a.variant_name.localeCompare(b.variant_name));
  }, [locationRows, search, counts]);

  const setCount = (row: InventoryRow, value: string) => {
    if (value === "") {
      setCounts(current => { const next = { ...current }; delete next[row.variant_id]; return next; });
      setSnapshots(current => { const next = { ...current }; delete next[row.variant_id]; return next; });
      return;
    }
    setSnapshots(current => current[row.variant_id] ? current : { ...current, [row.variant_id]: { onHand: row.on_hand, reserved: row.reserved } });
    setCounts(current => ({ ...current, [row.variant_id]: value }));
  };

  const countedRows = locationRows.filter(row => counts[row.variant_id] !== undefined);
  const reviewedLines = countedRows.map(row => {
    const snapshot = snapshots[row.variant_id] || { onHand: row.on_hand, reserved: row.reserved };
    const counted = Number(counts[row.variant_id]);
    return { row, snapshot, counted, variance: counted - snapshot.onHand };
  });
  const invalidLines = reviewedLines.filter(line => !Number.isInteger(line.counted) || line.counted < 0 || line.counted > 1_000_000 || line.counted < line.snapshot.reserved);
  const totalVariance = reviewedLines.reduce((sum, line) => Number.isFinite(line.variance) ? sum + line.variance : sum, 0);
  const changedLines = reviewedLines.filter(line => Number.isFinite(line.variance) && line.variance !== 0).length;

  const scan = (rawBarcode: string) => {
    const barcode = rawBarcode.trim();
    if (!barcode) return;
    const matches = locationRows.filter(row => (row.barcode || "").trim() === barcode);
    if (!matches.length) {
      setFeedback({ tone: "error", message: "No SKU at this location has that barcode." });
    } else if (matches.length > 1) {
      setFeedback({ tone: "error", message: "That barcode belongs to more than one SKU. Fix the catalogue barcode before counting it." });
    } else {
      const row = matches[0];
      const next = Number(counts[row.variant_id] ?? 0) + 1;
      setCount(row, String(next));
      setFeedback({ tone: "success", message: `${row.product_name} · ${row.variant_name} counted: ${next}.` });
    }
    setScanValue("");
    scanInput.current?.focus();
  };

  const commit = useMutation({
    mutationFn: () => tenantApi<StocktakeResponse>(tenant.id, "/inventory/stocktake", {
      method: "POST",
      body: JSON.stringify({
        locationId,
        reason: reason.trim() || undefined,
        lines: reviewedLines.map(line => ({
          variantId: line.row.variant_id,
          expectedOnHand: line.snapshot.onHand,
          expectedReserved: line.snapshot.reserved,
          countedOnHand: line.counted,
        })),
      }),
    }),
    onSuccess: async result => {
      setCompleted(result);
      setCounts({});
      setSnapshots({});
      setFeedback({ tone: "success", message: `Cycle count ${result.stocktakeId.slice(0, 8)} committed to inventory history.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "activity"] }),
      ]);
      scanInput.current?.focus();
    },
  });

  const restart = async () => {
    setCounts({});
    setSnapshots({});
    setCompleted(null);
    setFeedback(null);
    await inventory.refetch();
    scanInput.current?.focus();
  };

  return <>
    <PageHeader eyebrow="Inventory control" title="Cycle count" description="Count only the SKUs you physically check. Blank rows are untouched; zero is an explicit reviewed count. OrderMate compares your count with the stock position you started from before applying any variance." />

    <section className="panel stocktake-controls">
      <div className="stocktake-fields">
        <Field label="Stock location"><select value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Select location</option>{locations.data?.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
        <Field label="Count reason" hint="Optional; written onto any variance movements."><input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Aisle A weekly count" /></Field>
      </div>
      <div className="stocktake-rule"><ClipboardCheck size={18} /><div><strong>Partial count, by design</strong><span>Only rows with a counted quantity are submitted. OrderMate never assumes an uncounted item is zero.</span></div></div>
    </section>

    {locationId && <section className="panel stocktake-scan">
      <form onSubmit={event => { event.preventDefault(); scan(scanValue); }}>
        <div className="barcode-input-wrap"><ScanBarcode size={22} /><label><span>Scan physical units</span><input ref={scanInput} value={scanValue} onChange={event => setScanValue(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Scan or enter barcode…" /></label><button className="secondary" disabled={!scanValue.trim()}>Add scan</button></div>
      </form>
      <div className="stocktake-scan-tools"><CameraBarcodeScanner onScan={scan} label="Scan with camera" /><span>Each successful scan adds one physical unit to that SKU's counted quantity.</span></div>
      <div className={`scan-feedback ${feedback?.tone || "idle"}`} aria-live="polite">{feedback ? <>{feedback.tone === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{feedback.message}</span></> : <><ScanBarcode size={15} /><span>Scanner ready. You can also type a counted quantity directly in the table.</span></>}</div>
    </section>}

    <section className="panel stocktake-list">
      <div className="stocktake-list-head"><div><p className="eyebrow">Count sheet</p><h3>{locations.data?.find(location => location.id === locationId)?.name || "Choose a location"}</h3></div><label className="stocktake-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product, SKU or barcode" /></label></div>
      <DataState loading={inventory.isLoading || locations.isLoading} error={inventory.error || locations.error} empty={!!locationId && !visibleRows.length} emptyText="No inventory SKUs match this location/search.">
        <div className="stocktake-table-wrap"><table className="stocktake-table"><thead><tr><th>Item</th><th>System</th><th>Reserved</th><th>Counted</th><th>Variance</th><th /></tr></thead><tbody>{visibleRows.map(row => {
          const countedValue = counts[row.variant_id];
          const snapshot = snapshots[row.variant_id] || { onHand: row.on_hand, reserved: row.reserved };
          const counted = countedValue === undefined || countedValue === "" ? null : Number(countedValue);
          const variance = counted == null || !Number.isFinite(counted) ? null : counted - snapshot.onHand;
          const belowReserved = counted != null && counted < snapshot.reserved;
          return <tr key={row.variant_id} className={countedValue !== undefined ? "counted" : ""}>
            <td><strong>{row.product_name} · {row.variant_name}</strong><small className="mono">{row.sku}{row.barcode ? ` · ${row.barcode}` : " · no barcode"}</small>{row.tracked === 0 && <small>Never stocked here — counting it will establish the location/SKU position.</small>}</td>
            <td><strong>{snapshot.onHand}</strong><small>on hand</small></td>
            <td><strong>{snapshot.reserved}</strong><small>{snapshot.reserved ? "must remain covered" : "none"}</small></td>
            <td><input aria-label={`Counted on hand for ${row.product_name} ${row.variant_name}`} type="number" min="0" max="1000000" step="1" value={countedValue ?? ""} placeholder="—" onChange={event => setCount(row, event.target.value)} /></td>
            <td><span className={`stocktake-variance ${variance == null ? "neutral" : variance > 0 ? "positive" : variance < 0 ? "negative" : "neutral"}`}>{variance == null ? "—" : `${variance > 0 ? "+" : ""}${variance}`}</span>{belowReserved && <small className="stocktake-blocker">Below reserved</small>}</td>
            <td>{countedValue !== undefined && <button className="icon-button" type="button" title="Remove from this count" aria-label={`Remove ${row.product_name} from count`} onClick={() => setCount(row, "")}><X size={14} /></button>}</td>
          </tr>;
        })}</tbody></table></div>
      </DataState>
    </section>

    {commit.error && <div className="stocktake-error"><ErrorText error={commit.error} /><button className="secondary" onClick={restart}><RotateCcw size={14} /> Reload location & restart reviewed count</button></div>}
    {completed && <div className="panel stocktake-complete"><CheckCircle2 size={22} /><div><strong>Cycle count committed</strong><span>{completed.countedLines} SKU{completed.countedLines === 1 ? "" : "s"} reviewed · {completed.changedLines} variance{completed.changedLines === 1 ? "" : "s"} changed stock · net variance {completed.totalVariance > 0 ? "+" : ""}{completed.totalVariance} units</span><small className="mono">Reference {completed.stocktakeId}</small></div></div>}

    <div className="panel stocktake-commit"><div><span><small>Counted SKUs</small><strong>{reviewedLines.length}</strong></span><span><small>Changed SKUs</small><strong>{changedLines}</strong></span><span><small>Net variance</small><strong>{totalVariance > 0 ? "+" : ""}{totalVariance}</strong></span></div><div><small>{invalidLines.length ? `${invalidLines.length} counted row${invalidLines.length === 1 ? " is" : "s are"} invalid or below reserved stock.` : "A final server check rejects stale stock positions before anything is written."}</small><button className="primary" disabled={commit.isPending || !locationId || !reviewedLines.length || invalidLines.length > 0} onClick={() => commit.mutate()}><ClipboardCheck size={16} /> Commit reviewed count</button></div></div>
  </>;
}
