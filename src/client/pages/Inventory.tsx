import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Barcode, Camera, MapPin, Plus, ScanLine, Store } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import InventoryHistory from "../InventoryHistory";
import { tenantApi } from "../api";
import type { InventoryRow, Location } from "../model";
import { DataState, ErrorText, Field, Modal, PageHeader } from "../ui";

type InventorySettings = { low_stock_threshold: number };

export default function Inventory({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const [locationOpen, setLocationOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const canCreateLocation = ["owner", "admin", "inventory"].includes(tenant.role);
  const canUpdateStock = ["owner", "admin", "manager", "inventory", "fulfilment"].includes(tenant.role);
  const inventory = useQuery({ queryKey: ["tenant", tenant.id, "inventory"], queryFn: () => tenantApi<InventoryRow[]>(tenant.id, "/inventory") });
  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations") });
  const settings = useQuery({ queryKey: ["tenant", tenant.id, "settings"], queryFn: () => tenantApi<InventorySettings>(tenant.id, "/settings") });
  const threshold = settings.data?.low_stock_threshold ?? 5;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "inventory-movements"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "replenishment"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "dashboard"] });
    qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] });
  };

  return <>
    <PageHeader eyebrow="Stock" title="Inventory" description="On hand, reserved, available and incoming stock stay separate. Every physical change leaves an auditable movement." actions={<><button className="secondary" onClick={() => setScanOpen(true)}><ScanLine size={17} /> Scan barcode</button>{canCreateLocation && <button className="secondary" onClick={() => setLocationOpen(true)}><Store size={17} /> Add location</button>}{canUpdateStock && <button className="secondary" onClick={() => setTransferOpen(true)}><ArrowRightLeft size={17} /> Transfer</button>}{canUpdateStock && <button className="primary" onClick={() => setAdjustOpen(true)}><Plus size={17} /> Adjust stock</button>}</>} />
    <div className="panel table-panel"><DataState loading={inventory.isLoading} error={inventory.error} empty={!inventory.data?.length} emptyText="Create a product and stock location to begin tracking inventory."><table><thead><tr><th>Item</th><th>Location</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Incoming</th></tr></thead><tbody>{inventory.data?.map((row, index) => {
      const tracked = row.tracked !== 0;
      return <tr key={`${row.variant_id}:${row.location_id}:${index}`} className={tracked ? "" : "inventory-untracked"}><td><strong>{row.product_name} <span className="muted">· {row.variant_name}</span></strong><small className="mono">{row.sku}{row.barcode ? ` · ${row.barcode}` : ""}</small></td><td>{row.location_name}{!tracked && <small>Not stocked here yet</small>}</td><td>{tracked ? row.on_hand : <span className="muted">—</span>}</td><td>{tracked ? row.reserved : <span className="muted">—</span>}</td><td>{tracked ? <strong className={row.available <= threshold ? "danger-text" : ""}>{row.available}</strong> : <span className="muted">—</span>}</td><td>{tracked ? row.incoming : <span className="muted">—</span>}</td></tr>;
    })}</tbody></table></DataState></div>
    <InventoryHistory tenant={tenant} />
    {locationOpen && canCreateLocation && <LocationModal tenant={tenant} onClose={() => setLocationOpen(false)} onCreated={() => { setLocationOpen(false); refresh(); qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "locations"] }); }} />}
    {adjustOpen && canUpdateStock && <AdjustModal tenant={tenant} rows={inventory.data || []} onClose={() => setAdjustOpen(false)} onDone={() => { setAdjustOpen(false); refresh(); }} />}
    {transferOpen && canUpdateStock && <TransferModal tenant={tenant} rows={inventory.data || []} locations={locations.data || []} onClose={() => setTransferOpen(false)} onDone={() => { setTransferOpen(false); refresh(); }} />}
    {scanOpen && <BarcodeModal tenant={tenant} onClose={() => setScanOpen(false)} />}
  </>;
}

function LocationModal({ tenant, onClose, onCreated }: { tenant: OrganizationSummary; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/locations", { method: "POST", body: JSON.stringify({ name, code }) }), onSuccess: onCreated });
  return <Modal title="Add stock location" subtitle="Warehouses, shops, offices and stock rooms all use the same location model." onClose={onClose}><form onSubmit={event => { event.preventDefault(); mutation.mutate(); }} className="form-grid"><Field label="Location name"><input required value={name} onChange={event => setName(event.target.value)} placeholder="Derby warehouse" /></Field><Field label="Short code"><input required value={code} onChange={event => setCode(event.target.value)} placeholder="DER" maxLength={30} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending}>Add location</button></div></form></Modal>;
}

function AdjustModal({ tenant, rows, onClose, onDone }: { tenant: OrganizationSummary; rows: InventoryRow[]; onClose: () => void; onDone: () => void }) {
  const unique = Array.from(new Map(rows.map(row => [`${row.variant_id}:${row.location_id}`, row])).values());
  const [selection, setSelection] = useState(unique[0] ? `${unique[0].variant_id}:${unique[0].location_id}` : "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => { const [variantId, locationId] = selection.split(":"); return tenantApi(tenant.id, "/inventory/adjust", { method: "POST", body: JSON.stringify({ variantId, locationId, quantityDelta: Number(delta), reason }) }); }, onSuccess: onDone });
  return <Modal title="Adjust stock" subtitle="Adjustments are never silent. OrderMate records the item, location, reason and person responsible." onClose={onClose}><form onSubmit={event => { event.preventDefault(); mutation.mutate(); }} className="form-grid one"><Field label="Variant / location"><select required value={selection} onChange={event => setSelection(event.target.value)}>{unique.map(row => <option key={`${row.variant_id}:${row.location_id}`} value={`${row.variant_id}:${row.location_id}`}>{row.product_name} · {row.variant_name} — {row.location_name} ({row.tracked === 0 ? "not stocked" : `${row.available} available`})</option>)}</select></Field><Field label="Quantity change" hint="Positive receives stock; negative records a reduction."><input required type="number" step="1" value={delta} onChange={event => setDelta(event.target.value)} placeholder="e.g. -3" /></Field><Field label="Reason"><input required value={reason} onChange={event => setReason(event.target.value)} placeholder="Cycle count correction, damage, found stock…" /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !selection}>Record adjustment</button></div></form></Modal>;
}

function TransferModal({ tenant, rows, locations, onClose, onDone }: { tenant: OrganizationSummary; rows: InventoryRow[]; locations: Location[]; onClose: () => void; onDone: () => void }) {
  const sources = rows.filter(row => row.tracked !== 0 && row.available > 0);
  const [sourceKey, setSourceKey] = useState(sources[0] ? `${sources[0].variant_id}:${sources[0].location_id}` : "");
  const source = sources.find(row => `${row.variant_id}:${row.location_id}` === sourceKey);
  const destinations = locations.filter(location => location.id !== source?.location_id);
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  useEffect(() => { if (!destinations.some(location => location.id === toLocationId)) setToLocationId(destinations[0]?.id || ""); }, [sourceKey, locations.length]);
  const mutation = useMutation({ mutationFn: () => tenantApi(tenant.id, "/inventory/transfer", { method: "POST", body: JSON.stringify({ variantId: source?.variant_id, fromLocationId: source?.location_id, toLocationId, quantity: Number(quantity) }) }), onSuccess: onDone });
  return <Modal title="Transfer stock" subtitle="A transfer creates paired movement records — stock never teleports between locations." onClose={onClose}><form className="form-grid one" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}><Field label="From"><select required value={sourceKey} onChange={event => setSourceKey(event.target.value)}>{sources.map(row => <option key={`${row.variant_id}:${row.location_id}`} value={`${row.variant_id}:${row.location_id}`}>{row.product_name} · {row.variant_name} — {row.location_name} ({row.available} available)</option>)}</select></Field><Field label="To"><select required value={toLocationId} onChange={event => setToLocationId(event.target.value)}><option value="" disabled>Select destination</option>{destinations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field><Field label="Quantity"><input required type="number" min="1" max={source?.available || 1} value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>{mutation.error && <ErrorText error={mutation.error} />}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={mutation.isPending || !source || !toLocationId}>Transfer stock</button></div></form></Modal>;
}

type BarcodeResult = { product_name: string; variant_name: string; sku: string; barcode: string; levels: Array<{ location_name: string; on_hand: number; reserved: number; available: number }> };

function BarcodeModal({ tenant, onClose }: { tenant: OrganizationSummary; onClose: () => void }) {
  const [barcode, setBarcode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<BarcodeResult | null>(null);
  const lookup = useMutation({ mutationFn: (value: string) => tenantApi<BarcodeResult>(tenant.id, `/inventory/barcode/${encodeURIComponent(value.trim())}`), onSuccess: data => { setResult(data); setBarcode(""); setTimeout(() => input.current?.focus(), 0); } });
  useEffect(() => input.current?.focus(), []);
  return <Modal title="Barcode lookup" subtitle="Built for keyboard-wedge USB/Bluetooth scanners today. Scan continuously without touching the mouse; mobile camera capture can use the same lookup contract." onClose={onClose}><form className="scanner-form" onSubmit={event => { event.preventDefault(); if (barcode.trim()) lookup.mutate(barcode); }}><div className="scanner-input"><Barcode size={22} /><input ref={input} value={barcode} onChange={event => setBarcode(event.target.value)} placeholder="Scan or enter barcode" autoComplete="off" inputMode="numeric" /><button className="primary" disabled={lookup.isPending || !barcode.trim()}><ScanLine size={16} /> Lookup</button></div>{lookup.error && <ErrorText error={lookup.error} />}</form>{result && <div className="scan-result"><div className="scan-result-title"><div className="list-icon"><Camera size={19} /></div><div><strong>{result.product_name} · {result.variant_name}</strong><small className="mono">{result.sku} · {result.barcode}</small></div></div><div className="stock-cards">{result.levels.map(level => <div key={level.location_name}><MapPin size={15} /><span><strong>{level.location_name}</strong><small>{level.available} available · {level.on_hand} on hand · {level.reserved} reserved</small></span></div>)}</div></div>}</Modal>;
}
