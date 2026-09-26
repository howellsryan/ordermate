import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, FileWarning, PackageCheck } from "lucide-react";
import type {
  DeliveryDiscrepancyEvidence,
  DeliveryDiscrepancyRecord,
  DeliveryDiscrepancyResolutionCode,
} from "../shared/delivery-discrepancy";
import type { OrganizationSummary } from "../shared/types";
import { controlApi, date, tenantApi } from "./api";
import { DataState, ErrorText, Field, Modal, Status } from "./ui";

type Filter = "open" | "resolved";
type ProposalPointer = { sourceKey: string; sourceName: string };

const resolutionLabels: Record<DeliveryDiscrepancyResolutionCode, string> = {
  supplier_follow_up: "Supplier follow-up arranged",
  accepted_variance: "Accepted documented variance",
  corrected_document: "Corrected document / evidence",
  other: "Other resolution",
};

function evidenceFor(record: DeliveryDiscrepancyRecord): DeliveryDiscrepancyEvidence | null {
  try {
    const parsed = JSON.parse(record.evidence_json) as DeliveryDiscrepancyEvidence;
    return parsed?.version === 1 && Array.isArray(parsed.issues) ? parsed : null;
  } catch {
    return null;
  }
}

export default function DeliveryDiscrepancies({ tenant }: { tenant: OrganizationSummary }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-discrepancies", filter],
    queryFn: () => tenantApi<DeliveryDiscrepancyRecord[]>(tenant.id, `/delivery-discrepancies?status=${filter}`),
  });

  return <section className="panel discrepancy-panel">
    <div className="discrepancy-heading">
      <div><p className="eyebrow">Delivery control</p><h3>Supplier discrepancies</h3><p>Physical/document differences stay visible after stock is received, with evidence and an audited resolution rather than disappearing into the delivery-note proposal.</p></div>
      <div className="discrepancy-tabs" role="tablist" aria-label="Delivery discrepancy state">
        <button type="button" role="tab" aria-selected={filter === "open"} className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Open</button>
        <button type="button" role="tab" aria-selected={filter === "resolved"} className={filter === "resolved" ? "active" : ""} onClick={() => setFilter("resolved")}>Resolved</button>
      </div>
    </div>
    <DataState loading={query.isLoading} error={query.error} empty={!query.data?.length} emptyText={filter === "open" ? "Reviewed delivery receipts with no actionable mismatch stay out of this queue." : "Resolved delivery discrepancies will remain here as purchasing history."}>
      <div className="discrepancy-list">{query.data?.map(record => {
        const evidence = evidenceFor(record);
        const issueTypes = new Set(evidence?.issues.map(issue => issue.type) || []);
        return <button type="button" className="discrepancy-row" key={record.id} onClick={() => setOpenId(record.id)}>
          <span className={`discrepancy-icon ${record.status}`}>{record.status === "open" ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}</span>
          <span className="discrepancy-copy"><strong>{record.purchase_order_number} · {record.supplier_name}</strong><small>{record.location_name} · {record.issue_count} issue{record.issue_count === 1 ? "" : "s"} · {date(record.created_at)}</small></span>
          <span className="discrepancy-tags">{issueTypes.has("quantity_variance") && <small>quantity</small>}{issueTypes.has("unexpected_line") && <small>unexpected item</small>}{issueTypes.has("reference_mismatch") && <small>PO reference</small>}</span>
          <Status value={record.status} />
          <Eye size={15} />
        </button>;
      })}</div>
    </DataState>
    {openId && <DiscrepancyModal tenant={tenant} record={query.data?.find(item => item.id === openId) || null} onClose={() => setOpenId(null)} onResolved={() => { setOpenId(null); query.refetch(); }} />}
  </section>;
}

function DiscrepancyModal({ tenant, record, onClose, onResolved }: { tenant: OrganizationSummary; record: DeliveryDiscrepancyRecord | null; onClose: () => void; onResolved: () => void }) {
  const qc = useQueryClient();
  const evidence = useMemo(() => record ? evidenceFor(record) : null, [record?.id, record?.evidence_json]);
  const canResolve = !!record && record.status === "open" && ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const [resolutionCode, setResolutionCode] = useState<DeliveryDiscrepancyResolutionCode>("supplier_follow_up");
  const [resolutionNote, setResolutionNote] = useState("");
  const proposal = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-proposal", record?.proposal_key],
    queryFn: () => controlApi<ProposalPointer>(`/delivery-documents/proposal?key=${encodeURIComponent(record!.proposal_key)}`, { headers: { "x-ordermate-tenant": tenant.id } }),
    enabled: !!record?.proposal_key,
    retry: false,
  });

  const resolve = useMutation({
    mutationFn: () => tenantApi(tenant.id, `/delivery-discrepancies/${record!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolutionCode, resolutionNote }),
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "delivery-discrepancies"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "attention"] }),
        qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "audit"] }),
      ]);
      onResolved();
    },
  });

  const previewSource = async () => {
    if (!proposal.data?.sourceKey) return;
    const response = await fetch(`/api/delivery-documents/file?key=${encodeURIComponent(proposal.data.sourceKey)}`, { credentials: "include", headers: { "x-ordermate-tenant": tenant.id } });
    if (!response.ok) return;
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = window.document.createElement("a");
    anchor.href = blobUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  if (!record) return null;
  return <Modal title={`Delivery discrepancy · ${record.purchase_order_number}`} subtitle="The inventory receipt already happened. Resolve only the supplier/document follow-up recorded here; resolving this record never changes stock." onClose={onClose} wide>
    <div className="discrepancy-detail">
      <div className="discrepancy-summary">
        <Summary label="Supplier" value={record.supplier_name} />
        <Summary label="Location" value={record.location_name} />
        <Summary label="Document reference" value={evidence?.documentReference || "—"} />
        <Summary label="State" value={record.status} />
      </div>

      <div className="discrepancy-evidence-head"><div><p className="eyebrow">Recorded evidence</p><h3>{record.issue_count} actionable issue{record.issue_count === 1 ? "" : "s"}</h3></div>{proposal.data?.sourceKey && <button type="button" className="secondary" onClick={previewSource}><Eye size={14} /> View original delivery note</button>}</div>
      {proposal.error && <div className="discrepancy-source-note"><FileWarning size={15} /><span>The R2 proposal/source could not be loaded, but the operational discrepancy evidence below remains available.</span></div>}

      <div className="discrepancy-issues">{evidence?.issues.map((issue, index) => {
        if (issue.type === "reference_mismatch") return <div className="discrepancy-issue" key={index}><FileWarning size={17} /><div><strong>Purchase-order reference mismatch</strong><span>Document references <b>{issue.documentPurchaseOrderReference}</b>; receipt was reviewed against <b>{issue.expectedPurchaseOrderNumber}</b>.</span></div></div>;
        if (issue.type === "unexpected_line") return <div className="discrepancy-issue" key={index}><AlertTriangle size={17} /><div><strong>Unexpected / over-delivered document line</strong><span>{issue.description || issue.sku || issue.supplierSku || issue.barcode || "Unidentified item"}{issue.quantity == null ? "" : ` · quantity ${issue.quantity}`}</span>{issue.warnings.map((warning, warningIndex) => <small key={warningIndex}>{warning}</small>)}</div></div>;
        return <div className="discrepancy-issue" key={index}><PackageCheck size={17} /><div><strong>Physical quantity differs from delivery note</strong><span>{issue.description} · <span className="mono">{issue.sku}</span></span><small>Document {issue.documentQuantity} · physically received {issue.receivedQuantity} · variance {issue.receivedQuantity - issue.documentQuantity > 0 ? "+" : ""}{issue.receivedQuantity - issue.documentQuantity}</small></div></div>;
      }) || <div className="discrepancy-source-note"><AlertTriangle size={15} /><span>The stored evidence could not be parsed. Use the audit trail and source proposal before resolving.</span></div>}</div>

      {record.status === "resolved" ? <div className="discrepancy-resolution complete"><CheckCircle2 size={18} /><div><strong>{record.resolution_code ? resolutionLabels[record.resolution_code] : "Resolved"}</strong><span>{record.resolution_note || "No resolution note recorded."}</span><small>{record.resolved_at ? `Resolved ${date(record.resolved_at)}` : ""}</small></div></div> : canResolve ? <div className="discrepancy-resolution-form">
        <div><p className="eyebrow">Resolve purchasing follow-up</p><h3>Close the operational issue</h3><p>This does not amend the PO or inventory. Record what happened so the discrepancy remains auditable.</p></div>
        <Field label="Resolution"><select value={resolutionCode} onChange={event => setResolutionCode(event.target.value as DeliveryDiscrepancyResolutionCode)}>{Object.entries(resolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Resolution note"><textarea rows={3} maxLength={2000} value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} placeholder="What was agreed or corrected?" /></Field>
        {resolve.error && <ErrorText error={resolve.error} />}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Keep open</button><button type="button" className="primary" disabled={resolve.isPending || resolutionNote.trim().length < 3} onClick={() => resolve.mutate()}><CheckCircle2 size={15} /> {resolve.isPending ? "Resolving…" : "Resolve discrepancy"}</button></div>
      </div> : <div className="discrepancy-resolution read-only"><AlertTriangle size={17} /><span>This discrepancy is open. Your role can review it but cannot resolve purchasing issues.</span></div>}
    </div>
  </Modal>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}
