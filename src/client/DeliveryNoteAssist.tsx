import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, FileCheck2, FileText, FileUp, Sparkles } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { controlApi, date } from "./api";
import type { WarehouseScanCounts } from "./warehouse-scan";
import { ErrorText, Modal, Status } from "./ui";
import { useWorkspaceFeatures } from "./workspace-features";

type Capability = { aiDocumentExtractionEnabled: boolean };
type SourceSummary = { key: string; name: string; uploaded: string; contentType: string; status: string; purchaseOrderId: string };
type ProposalSummary = { key: string; uploaded: string; status: string; purchaseOrderId: string; purchaseOrderNumber: string; supplierName: string; lineCount: number; matchedCount: number; warningCount: number; eventId: string };
type DeliveryProposal = {
  version: 1;
  eventId: string;
  status: "ready" | "needs_review" | "accepted";
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  extracted: { supplierReference: string; purchaseOrderReference: string; documentDate: string };
  lines: Array<{
    lineId: string;
    variantId: string;
    sku: string;
    description: string;
    quantityOrdered: number;
    quantityReceived: number;
    remaining: number;
    extractedQuantity: number;
    suggestedReceiveQuantity: number;
    matchMethods: string[];
    warnings: string[];
  }>;
  unexpectedLines: Array<{
    index: number;
    description: string;
    supplierSku: string;
    sku: string;
    barcode: string;
    quantity: number | null;
    warnings: string[];
  }>;
  warnings: string[];
  acceptedAt?: string;
};

type SourceList = { sources: SourceSummary[]; truncated: boolean };
type ProposalList = { proposals: ProposalSummary[]; truncated: boolean };
type AssistProps = { tenant: OrganizationSummary; purchaseOrderId: string; onApply: (counts: WarehouseScanCounts, proposalKey: string) => void };

export default function DeliveryNoteAssist(props: AssistProps) {
  const features = useWorkspaceFeatures(props.tenant.id);
  if (!features.data || !features.enabled.has("document_assist")) return null;
  return <EnabledDeliveryNoteAssist {...props} />;
}

function EnabledDeliveryNoteAssist({ tenant, purchaseOrderId, onApply }: AssistProps) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const capabilities = useQuery({
    queryKey: ["tenant", tenant.id, "documents", "capabilities"],
    queryFn: () => controlApi<Capability>("/documents/capabilities", { headers: { "x-ordermate-tenant": tenant.id } }),
  });
  const sources = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-sources", purchaseOrderId],
    queryFn: () => controlApi<SourceList>(`/delivery-documents/sources?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`, { headers: { "x-ordermate-tenant": tenant.id } }),
  });
  const proposals = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-proposals", purchaseOrderId],
    queryFn: () => controlApi<ProposalList>(`/delivery-documents/proposals?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}`, { headers: { "x-ordermate-tenant": tenant.id } }),
    refetchInterval: 5_000,
  });
  const extractionEnabled = capabilities.data?.aiDocumentExtractionEnabled === true;

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      form.set("purchaseOrderId", purchaseOrderId);
      return controlApi<SourceSummary>("/delivery-documents", { method: "POST", headers: { "x-ordermate-tenant": tenant.id }, body: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-sources", purchaseOrderId] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-proposals", purchaseOrderId] });
    },
  });
  const extract = useMutation({
    mutationFn: (key: string) => controlApi<{ status: string }>("/delivery-documents/extract", {
      method: "POST",
      headers: { "x-ordermate-tenant": tenant.id },
      body: JSON.stringify({ key }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-sources", purchaseOrderId] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-proposals", purchaseOrderId] });
    },
  });

  const preview = async (key: string) => {
    const response = await fetch(`/api/delivery-documents/file?key=${encodeURIComponent(key)}`, { credentials: "include", headers: { "x-ordermate-tenant": tenant.id } });
    if (!response.ok) return;
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  const proposalEventIds = new Set((proposals.data?.proposals || []).map(proposal => proposal.eventId));
  const capabilityText = capabilities.isLoading
    ? "Checking document extraction policy…"
    : extractionEnabled
      ? "Cloudflare extraction is enabled for this deployment."
      : "Stored in EU R2 only; AI extraction is disabled.";

  return <section className="delivery-assist">
    <div className="delivery-assist-head"><div><p className="eyebrow">Delivery note assist</p><h3>Match a supplier delivery to this PO</h3><p>AI extracts delivered quantities only. Exact matching proposes receiving counts; you still review and commit through Warehouse.</p></div><Sparkles size={19} /></div>
    <div className="delivery-actions">
      <input ref={inputRef} hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = ""; }} />
      <button type="button" className="secondary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}><FileUp size={15} /> {upload.isPending ? "Uploading…" : "Upload delivery note"}</button>
      <span>{capabilityText}</span>
    </div>
    {capabilities.error && <ErrorText error={capabilities.error} />}
    {sources.error && <ErrorText error={sources.error} />}
    {proposals.error && <ErrorText error={proposals.error} />}
    {upload.error && <ErrorText error={upload.error} />}
    {extract.error && <ErrorText error={extract.error} />}

    {(proposals.data?.proposals.length || sources.data?.sources.length) ? <div className="delivery-history">
      {(proposals.data?.proposals || []).slice(0, 4).map(proposal => <button type="button" className="delivery-proposal-row" key={proposal.key} onClick={() => setOpenKey(proposal.key)}>
        <span className="delivery-file-icon"><FileCheck2 size={15} /></span><span><strong>{proposal.supplierName}</strong><small>{proposal.matchedCount}/{proposal.lineCount} PO lines suggested · {proposal.warningCount} warning{proposal.warningCount === 1 ? "" : "s"} · {date(proposal.uploaded)}</small></span><Status value={proposal.status} /><Eye size={14} />
      </button>)}
      {(sources.data?.sources || []).filter(source => !proposalEventIds.has(source.key.split("/").at(-1) || "")).slice(0, 4).map(source => {
        const queuedRecently = source.status === "queued" && Date.now() - new Date(source.uploaded).getTime() < 10 * 60 * 1000;
        return <div className="delivery-source-row" key={source.key}><span className="delivery-file-icon"><FileText size={15} /></span><span><strong>{source.name}</strong><small>{date(source.uploaded)} · {queuedRecently ? "Extraction queued" : source.status === "stored" ? "Stored only" : "No proposal yet"}</small></span><div><button type="button" className="table-action" onClick={() => preview(source.key)}><Eye size={13} /> Source</button>{extractionEnabled && !queuedRecently && <button type="button" className="table-action" disabled={extract.isPending} onClick={() => extract.mutate(source.key)}><Sparkles size={13} /> {source.status === "queued" ? "Retry" : "Extract"}</button>}</div></div>;
      })}
    </div> : !sources.isLoading && !proposals.isLoading ? <div className="delivery-empty"><FileText size={18} /><span>No delivery note attached to this PO yet.</span></div> : <div className="delivery-empty"><div className="loader" /><span>Loading delivery-note history…</span></div>}

    {openKey && <DeliveryProposalModal tenant={tenant} proposalKey={openKey} onClose={() => setOpenKey(null)} onApply={(counts) => { onApply(counts, openKey); setOpenKey(null); }} />}
  </section>;
}

function DeliveryProposalModal({ tenant, proposalKey, onClose, onApply }: { tenant: OrganizationSummary; proposalKey: string; onClose: () => void; onApply: (counts: WarehouseScanCounts) => void }) {
  const proposal = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-proposal", proposalKey],
    queryFn: () => controlApi<DeliveryProposal>(`/delivery-documents/proposal?key=${encodeURIComponent(proposalKey)}`, { headers: { "x-ordermate-tenant": tenant.id } }),
  });
  return <Modal title="Review delivery-note proposal" subtitle="Compare the original document, exceptions and proposed receipt quantities. Loading the proposal still does not change stock." onClose={onClose} wide>
    {proposal.isLoading ? <div className="detail-loading"><div className="loader" /></div> : proposal.error ? <ErrorText error={proposal.error} /> : proposal.data ? <DeliveryProposalReview tenant={tenant} proposal={proposal.data} onClose={onClose} onApply={onApply} /> : null}
  </Modal>;
}

function DeliveryProposalReview({ tenant, proposal, onClose, onApply }: { tenant: OrganizationSummary; proposal: DeliveryProposal; onClose: () => void; onApply: (counts: WarehouseScanCounts) => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(proposal.lines.map(line => [line.lineId, String(line.suggestedReceiveQuantity)] as const)));
  useEffect(() => setQuantities(Object.fromEntries(proposal.lines.map(line => [line.lineId, String(line.suggestedReceiveQuantity)] as const))), [proposal.eventId]);
  const valid = proposal.lines.every(line => {
    const quantity = Number(quantities[line.lineId] || 0);
    return Number.isInteger(quantity) && quantity >= 0 && quantity <= line.remaining;
  });
  const selected = proposal.lines.reduce((sum, line) => sum + Number(quantities[line.lineId] || 0), 0);

  const preview = async () => {
    const response = await fetch(`/api/delivery-documents/file?key=${encodeURIComponent(proposal.sourceKey)}`, { credentials: "include", headers: { "x-ordermate-tenant": tenant.id } });
    if (!response.ok) return;
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  const apply = () => {
    const stagedCounts = Object.fromEntries(
      proposal.lines
        .map(line => [line.lineId, Number(quantities[line.lineId] || 0)] as const)
        .filter(([, quantity]) => quantity > 0),
    );
    onApply(stagedCounts);
  };

  return <div className="delivery-review">
    <div className="delivery-evidence"><div><span>PO</span><strong>{proposal.purchaseOrderNumber}</strong><small>{proposal.supplierName} · {proposal.locationName}</small></div><div><span>Delivery reference</span><strong>{proposal.extracted.supplierReference || "Not extracted"}</strong><small>{proposal.extracted.documentDate || "No date extracted"}</small></div><div><span>Source</span><strong>{proposal.sourceName}</strong><button type="button" className="table-action" onClick={preview}><Eye size={13} /> View original</button></div><div><span>AI status</span><Status value={proposal.status} /><small>{proposal.extracted.purchaseOrderReference ? `Document PO: ${proposal.extracted.purchaseOrderReference}` : "No PO reference extracted"}</small></div></div>
    {proposal.warnings.length > 0 && <div className="delivery-warnings"><AlertTriangle size={16} /><div><strong>Document warnings</strong>{proposal.warnings.map((warning, index) => <span key={index}>{warning}</span>)}</div></div>}
    <div className="delivery-lines"><div className="delivery-lines-head"><span>Purchase-order line</span><span>Ordered / already received</span><span>Extracted</span><span>Receive now</span></div>{proposal.lines.map(line => <div className="delivery-line" key={line.lineId}><div><strong>{line.description}</strong><small className="mono">{line.sku}</small>{line.matchMethods.length > 0 && <small>Matched by {line.matchMethods.join(" + ").replaceAll("_", " ")}</small>}{line.warnings.map((warning, index) => <span className="line-warning" key={index}>{warning}</span>)}</div><span>{line.quantityOrdered} / {line.quantityReceived}</span><strong>{line.extractedQuantity}</strong><input aria-label={`Receive ${line.description}`} type="number" min="0" max={line.remaining} step="1" value={quantities[line.lineId] || "0"} onChange={event => setQuantities(current => ({ ...current, [line.lineId]: event.target.value }))} /></div>)}</div>
    {proposal.unexpectedLines.length > 0 && <div className="delivery-unexpected"><div><AlertTriangle size={16} /><strong>Unmatched / over-delivered document lines</strong></div>{proposal.unexpectedLines.map(line => <div key={`${line.index}:${line.description}`}><span>{line.description || line.sku || line.supplierSku || line.barcode || `Document line ${line.index + 1}`}</span><strong>{line.quantity ?? "?"}</strong><small>{line.warnings.join(" ")}</small></div>)}</div>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Close</button><button type="button" className="primary" disabled={!valid || selected <= 0 || proposal.status === "accepted"} onClick={apply}><FileCheck2 size={15} /> Load {selected} unit{selected === 1 ? "" : "s"} into receiving</button></div>
  </div>;
}
