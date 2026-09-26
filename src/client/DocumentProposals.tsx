import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, FileCheck2, Sparkles, WandSparkles } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { controlApi, date, money, tenantApi } from "./api";
import type { Location, Product, Supplier, SupplierVariant } from "./model";
import { normalizeSupplierSku, reviewedSupplierSkuConflicts, supplierLearningDecision } from "./supplier-learning";
import { DataState, ErrorText, Field, Modal, Status, pounds } from "./ui";

type ProposalSummary = {
  key: string;
  uploaded: string;
  status: string;
  supplierName: string;
  lineCount: number;
  matchedCount: number;
  warningCount: number;
  eventId: string;
};

type ProposalList = { proposals: ProposalSummary[]; truncated: boolean; cursor?: string };

type ProposalLine = {
  index: number;
  description: string;
  supplierSku: string;
  barcode: string;
  quantity: number | null;
  unitCostMinor: number | null;
  mappedLastCostMinor: number | null;
  taxRateBps: number | null;
  defaultTaxRateBps: number | null;
  variantMatch: null | {
    variantId: string;
    productId: string;
    productName: string;
    variantName: string;
    sku: string;
    method: "supplier_sku" | "barcode" | "internal_sku";
  };
  warnings: string[];
};

type PurchaseProposal = {
  version: 1;
  eventId: string;
  status: "ready" | "needs_review" | "accepted";
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  extracted: { supplierName: string; supplierReference: string; documentDate: string; currency: string };
  tenantCurrency: string;
  supplierMatch: null | { supplierId: string; supplierName: string; method: "supplier_name" | "supplier_sku" };
  lines: ProposalLine[];
  warnings: string[];
  purchaseOrderId?: string;
  acceptedAt?: string;
};

type ReviewLine = { index: number; variantId: string; quantity: string; cost: string; tax: string };

type CreatedDraft = {
  id: string;
  number: string;
  completionError?: string;
  learnedMappings?: number;
  learningWarnings?: string[];
};

export default function DocumentProposals({ tenant }: { tenant: OrganizationSummary }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["tenant", tenant.id, "documents", "proposals"],
    queryFn: () => controlApi<ProposalList>("/documents/proposals", { headers: { "x-ordermate-tenant": tenant.id } }),
    refetchInterval: 5_000,
  });

  return <section className="proposal-section">
    <div className="proposal-heading"><div><p className="eyebrow">AI review queue</p><h4>Extracted purchase-order proposals</h4></div><WandSparkles size={18} /></div>
    <DataState loading={query.isLoading} error={query.error} empty={!query.data?.proposals.length} emptyText="No extracted proposals yet. When an eligible source document is queued for extraction, its structured review proposal will appear here.">
      <div className="proposal-list">{query.data?.proposals.map(proposal => {
        const accepted = proposal.status === "accepted";
        return <button className="proposal-row" key={proposal.key} onClick={() => setOpenKey(proposal.key)}>
          <span className={`proposal-icon ${accepted ? "proposal-icon-ok" : proposal.status === "ready" ? "proposal-icon-ready" : "proposal-icon-review"}`}>{accepted ? <CheckCircle2 size={17} /> : proposal.status === "ready" ? <Sparkles size={17} /> : <AlertTriangle size={17} />}</span>
          <span className="proposal-copy"><strong>{proposal.supplierName || "Unmatched supplier"}</strong><small>{proposal.matchedCount}/{proposal.lineCount} lines matched · {proposal.warningCount} warning{proposal.warningCount === 1 ? "" : "s"} · {date(proposal.uploaded)}</small></span>
          <Status value={accepted ? "accepted" : proposal.status === "ready" ? "ready" : "needs_review"} />
          <Eye size={15} />
        </button>;
      })}</div>
    </DataState>
    {openKey && <ProposalModal tenant={tenant} proposalKey={openKey} onClose={() => setOpenKey(null)} />}
  </section>;
}

function ProposalModal({ tenant, proposalKey, onClose }: { tenant: OrganizationSummary; proposalKey: string; onClose: () => void }) {
  const proposal = useQuery({
    queryKey: ["tenant", tenant.id, "documents", "proposal", proposalKey],
    queryFn: () => controlApi<PurchaseProposal>(`/documents/proposal?key=${encodeURIComponent(proposalKey)}`, { headers: { "x-ordermate-tenant": tenant.id } }),
  });

  return <Modal title="Review extracted purchase order" subtitle="AI extracted the document; exact Operating Layer matching is deterministic. Nothing below changes purchasing or inventory until you create the draft." onClose={onClose} wide>
    {proposal.isLoading ? <div className="detail-loading"><div className="loader" /></div> : proposal.error ? <ErrorText error={proposal.error} /> : proposal.data ? <ProposalReview tenant={tenant} proposalKey={proposalKey} proposal={proposal.data} onClose={onClose} /> : null}
  </Modal>;
}

function ProposalReview({ tenant, proposalKey, proposal, onClose }: { tenant: OrganizationSummary; proposalKey: string; proposal: PurchaseProposal; onClose: () => void }) {
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ["tenant", tenant.id, "suppliers"], queryFn: () => tenantApi<Supplier[]>(tenant.id, "/suppliers") });
  const locations = useQuery({ queryKey: ["tenant", tenant.id, "locations"], queryFn: () => tenantApi<Location[]>(tenant.id, "/locations") });
  const products = useQuery({ queryKey: ["tenant", tenant.id, "products"], queryFn: () => tenantApi<Product[]>(tenant.id, "/products") });
  const mappings = useQuery({ queryKey: ["tenant", tenant.id, "supplier-variants"], queryFn: () => tenantApi<SupplierVariant[]>(tenant.id, "/supplier-variants") });
  const variants = useMemo(() => (products.data || []).filter(product => product.status === "active").flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => ({ ...variant, productName: product.name }))), [products.data]);
  const [supplierId, setSupplierId] = useState(proposal.supplierMatch?.supplierId || "");
  const [locationId, setLocationId] = useState("");
  const [created, setCreated] = useState<CreatedDraft | null>(proposal.purchaseOrderId ? { id: proposal.purchaseOrderId, number: "Existing draft" } : null);
  const [learnOverrides, setLearnOverrides] = useState<Record<number, boolean>>({});
  const [reviewLines, setReviewLines] = useState<ReviewLine[]>(() => proposal.lines.map(line => ({
    index: line.index,
    variantId: line.variantMatch?.variantId || "",
    quantity: line.quantity == null ? "" : String(line.quantity),
    cost: moneyInput(line.unitCostMinor ?? line.mappedLastCostMinor),
    tax: bpsInput(line.taxRateBps ?? line.defaultTaxRateBps),
  })));
  const reviewedSkuConflicts = useMemo(() => reviewedSupplierSkuConflicts(proposal.lines.map(sourceLine => ({
    index: sourceLine.index,
    supplierSku: sourceLine.supplierSku,
    variantId: reviewLines.find(line => line.index === sourceLine.index)?.variantId || "",
  }))), [proposal.lines, reviewLines]);

  const currencyMismatch = !!proposal.extracted.currency && proposal.extracted.currency !== proposal.tenantCurrency;
  const canCreate = ["owner", "admin", "manager", "inventory"].includes(tenant.role);
  const allLinesValid = reviewLines.length > 0 && reviewLines.every(line => line.variantId && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0 && line.cost !== "" && Number(line.cost) >= 0 && line.tax !== "" && Number(line.tax) >= 0 && Number(line.tax) <= 100);

  const create = useMutation({
    mutationFn: async () => {
      const po = await tenantApi<{ id: string; number: string }>(tenant.id, "/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          locationId,
          notes: `Created from reviewed document proposal ${proposal.eventId}${proposal.extracted.supplierReference ? ` · supplier reference ${proposal.extracted.supplierReference}` : ""}`,
          lines: reviewLines.map(line => ({ variantId: line.variantId, quantity: Number(line.quantity), unitCostMinor: pounds(line.cost), taxRateBps: Math.round(Number(line.tax) * 100) })),
        }),
      });

      const learningWarnings: string[] = [];
      let learnedMappings = 0;
      if (mappings.data && !mappings.error) {
        const learned = new Set<string>();
        for (const sourceLine of proposal.lines) {
          const line = reviewLines.find(item => item.index === sourceLine.index);
          if (!line || !sourceLine.supplierSku.trim()) continue;
          const reviewedConflict = reviewedSkuConflicts.has(normalizeSupplierSku(sourceLine.supplierSku));
          const decision = supplierLearningDecision(mappings.data, supplierId, line.variantId, sourceLine.supplierSku, reviewedConflict);
          const remember = learnOverrides[sourceLine.index] ?? decision.defaultSelected;
          if (!remember || decision.disabled) continue;

          const key = `${supplierId}\u0000${line.variantId}\u0000${normalizeSupplierSku(sourceLine.supplierSku)}`;
          if (learned.has(key)) continue;
          learned.add(key);

          try {
            await tenantApi(tenant.id, "/supplier-variants", {
              method: "POST",
              body: JSON.stringify({
                supplierId,
                variantId: line.variantId,
                supplierSku: sourceLine.supplierSku.trim(),
                lastCostMinor: pounds(line.cost),
                leadTimeDays: decision.currentMapping?.lead_time_days ?? undefined,
              }),
            });
            learnedMappings += 1;
          } catch (cause) {
            learningWarnings.push(`${sourceLine.supplierSku.trim()}: ${cause instanceof Error ? cause.message : "mapping could not be saved"}`);
          }
        }
      } else if (proposal.lines.some(line => line.supplierSku.trim())) {
        learningWarnings.push("Supplier SKU learning was unavailable during this review. The draft PO is still valid; mappings can be added later from Supplier catalogue.");
      }

      let completionError: string | undefined;
      try {
        await controlApi("/documents/proposal/complete", {
          method: "POST",
          headers: { "x-ordermate-tenant": tenant.id },
          body: JSON.stringify({ key: proposalKey, purchaseOrderId: po.id }),
        });
      } catch (cause) {
        completionError = cause instanceof Error ? cause.message : "Proposal status could not be updated";
      }
      return { ...po, completionError, learnedMappings, learningWarnings };
    },
    onSuccess: result => {
      setCreated(result);
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id] });
    },
  });

  const previewSource = async () => {
    const response = await fetch(`/api/documents/file?key=${encodeURIComponent(proposal.sourceKey)}`, { credentials: "include", headers: { "x-ordermate-tenant": tenant.id } });
    if (!response.ok) return;
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = window.document.createElement("a");
    anchor.href = blobUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  if (created) return <div className="proposal-created">
    <span className="proposal-created-icon"><FileCheck2 size={26} /></span>
    <div><p className="eyebrow">Draft created</p><h3>{created.number}</h3><p>The reviewed extraction is now a normal Operating Layer draft purchase order. Stock has not changed; submit and receive it through the standard workflow.</p>{created.learnedMappings ? <p>{created.learnedMappings} reviewed supplier SKU mapping{created.learnedMappings === 1 ? " was" : "s were"} remembered for future document matching.</p> : null}{created.learningWarnings?.map((warning, index) => <div className="proposal-sidecar-warning" key={`learning-${index}`}><AlertTriangle size={15} /><span><strong>The PO was created successfully.</strong> Supplier SKU learning warning: {warning}</span></div>)}{created.completionError && <div className="proposal-sidecar-warning"><AlertTriangle size={15} /><span><strong>The PO was created successfully.</strong> The proposal sidecar could not be marked accepted: {created.completionError}. Do not create the PO again from this proposal.</span></div>}</div>
    <div className="modal-actions"><button className="primary" onClick={onClose}>Close</button></div>
  </div>;

  return <div className="proposal-review">
    <div className="proposal-evidence">
      <div><span>Source</span><strong>{proposal.sourceName}</strong><button className="table-action" onClick={previewSource}><Eye size={13} /> View source</button></div>
      <div><span>Extracted supplier</span><strong>{proposal.extracted.supplierName || "Not found"}</strong><small>{proposal.supplierMatch ? `Exact match by ${proposal.supplierMatch.method.replaceAll("_", " ")}` : "Choose a supplier below"}</small></div>
      <div><span>Reference</span><strong>{proposal.extracted.supplierReference || "—"}</strong><small>{proposal.extracted.documentDate || "No document date extracted"}</small></div>
      <div><span>Currency</span><strong>{proposal.extracted.currency || "Not found"}</strong><small>Workspace {proposal.tenantCurrency}</small></div>
    </div>

    {(proposal.warnings.length > 0 || currencyMismatch) && <div className="proposal-warnings"><AlertTriangle size={17} /><div><strong>Review document-level warnings</strong>{proposal.warnings.map((warning, index) => <span key={index}>{warning}</span>)}</div></div>}

    <div className="proposal-commercial">
      <Field label="Supplier"><select required value={supplierId} onChange={event => { setSupplierId(event.target.value); setLearnOverrides({}); }}><option value="">Select supplier</option>{suppliers.data?.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
      <Field label="Receive into"><select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Select stock location</option>{locations.data?.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
    </div>

    {mappings.error && <div className="proposal-sidecar-warning"><AlertTriangle size={15} /><span><strong>Supplier SKU learning is temporarily unavailable.</strong> You can still create the reviewed draft PO; add mappings later from Supplier catalogue.</span></div>}

    <div className="proposal-lines"><div className="proposal-lines-head"><span>Extracted evidence</span><span>Operating Layer variant</span><span>Qty</span><span>Net unit cost</span><span>Tax %</span></div>{proposal.lines.map(sourceLine => {
      const line = reviewLines.find(item => item.index === sourceLine.index)!;
      const patch = (value: Partial<ReviewLine>) => setReviewLines(current => current.map(item => item.index === line.index ? { ...item, ...value } : item));
      const reviewedConflict = reviewedSkuConflicts.has(normalizeSupplierSku(sourceLine.supplierSku));
      const learning = supplierLearningDecision(mappings.data || [], supplierId, line.variantId, sourceLine.supplierSku, reviewedConflict);
      const remember = learnOverrides[sourceLine.index] ?? learning.defaultSelected;
      return <div className={`proposal-line ${sourceLine.warnings.length ? "proposal-line-warning" : ""}`} key={sourceLine.index}>
        <div className="proposal-line-evidence"><strong>{sourceLine.description || `Line ${sourceLine.index + 1}`}</strong><small>{[sourceLine.supplierSku && `Supplier SKU ${sourceLine.supplierSku}`, sourceLine.barcode && `Barcode ${sourceLine.barcode}`, sourceLine.variantMatch && `Matched by ${sourceLine.variantMatch.method.replaceAll("_", " ")}`].filter(Boolean).join(" · ") || "No identifying code extracted"}</small>{sourceLine.warnings.map((warning, index) => <span key={index}>{warning}</span>)}{sourceLine.supplierSku && supplierId && line.variantId ? <label className={`proposal-learn ${learning.disabled ? "disabled" : ""}`}><input type="checkbox" checked={remember} disabled={learning.disabled || mappings.isLoading || !!mappings.error} onChange={event => setLearnOverrides(current => ({ ...current, [sourceLine.index]: event.target.checked }))} /><span>{learning.label}</span></label> : null}</div>
        <select aria-label={`Variant for extracted line ${sourceLine.index + 1}`} required value={line.variantId} onChange={event => { patch({ variantId: event.target.value }); setLearnOverrides(current => { const next = { ...current }; delete next[sourceLine.index]; return next; }); }}><option value="">Select variant</option>{variants.map(variant => <option value={variant.id} key={variant.id}>{variant.productName} · {variant.name} — {variant.sku}</option>)}</select>
        <input aria-label={`Quantity for extracted line ${sourceLine.index + 1}`} required type="number" min="1" step="1" value={line.quantity} onChange={event => patch({ quantity: event.target.value })} />
        <input aria-label={`Unit cost for extracted line ${sourceLine.index + 1}`} required type="number" min="0" step="0.01" value={line.cost} onChange={event => patch({ cost: event.target.value })} />
        <input aria-label={`Tax rate for extracted line ${sourceLine.index + 1}`} required type="number" min="0" max="100" step="0.01" value={line.tax} onChange={event => patch({ tax: event.target.value })} />
      </div>;
    })}</div>

    {currencyMismatch && <div className="proposal-block"><AlertTriangle size={16} /><span>Operating Layer will not create this AI-assisted draft because the extracted document currency differs from the workspace currency. Create a manual PO after converting/reviewing the costs.</span></div>}
    {create.error && <ErrorText error={create.error} />}
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button>{canCreate && <button className="primary" disabled={create.isPending || mappings.isLoading || currencyMismatch || !supplierId || !locationId || !allLinesValid} onClick={() => create.mutate()}><FileCheck2 size={16} /> Create reviewed draft PO</button>}</div>
  </div>;
}

function moneyInput(minor: number | null) {
  return minor == null ? "" : (minor / 100).toFixed(2);
}

function bpsInput(bps: number | null) {
  return bps == null ? "" : (bps / 100).toString();
}
