import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, PackagePlus, UploadCloud } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import type {
  CatalogueImportCommitResponse,
  CatalogueImportPlan,
  CatalogueImportRow,
} from "../shared/catalogue-import";
import { tenantApi } from "./api";
import {
  downloadCatalogueImportTemplate,
  parseCatalogueCsvFile,
  type ParsedCatalogueCsv,
} from "./catalogue-import-csv";
import { ErrorText, Modal } from "./ui";

export default function CatalogueImportModal({ tenant, onClose, onCommitted }: { tenant: OrganizationSummary; onClose: () => void; onCommitted: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCatalogueCsv | null>(null);
  const [plan, setPlan] = useState<CatalogueImportPlan | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [committed, setCommitted] = useState<CatalogueImportCommitResponse | null>(null);

  const preview = useMutation({
    mutationFn: (rows: CatalogueImportRow[]) => tenantApi<CatalogueImportPlan>(tenant.id, "/imports/catalogue/preview", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
    onSuccess: result => {
      setPlan(result);
      setReviewed(false);
    },
  });
  const commit = useMutation({
    mutationFn: () => tenantApi<CatalogueImportCommitResponse>(tenant.id, "/imports/catalogue/commit", {
      method: "POST",
      body: JSON.stringify({ rows: parsed!.rows, expectedFingerprint: plan!.fingerprint }),
    }),
    onSuccess: result => {
      setCommitted(result);
      onCommitted();
    },
  });

  const load = async (file?: File | null) => {
    if (!file || preview.isPending || commit.isPending) return;
    setFileName(file.name);
    setPlan(null);
    setCommitted(null);
    setReviewed(false);
    const next = await parseCatalogueCsvFile(file);
    setParsed(next);
    if (!next.errors.length) preview.mutate(next.rows);
  };

  const retryPreview = () => {
    if (!parsed?.rows.length || parsed.errors.length) return;
    commit.reset();
    preview.mutate(parsed.rows);
  };

  return <Modal title="Import catalogue from CSV" subtitle="Create new products, variants, supplier mappings and opening stock from one reviewed file. OrderMate validates everything before one atomic commit." onClose={onClose} wide>
    {committed ? <div className="import-complete">
      <span><CheckCircle2 size={28} /></span>
      <div><p className="eyebrow">Import committed</p><h3>{committed.summary.productsToCreate} products · {committed.summary.variantsToCreate} variants</h3><p>Opening stock and supplier mappings were committed with the catalogue in the same tenant transaction. Import reference: <code>{committed.importId}</code>.</p></div>
      <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
    </div> : <div className="catalogue-import">
      <section className="import-source">
        <div className="import-source-head"><div><p className="eyebrow">1 · Source file</p><h3>Use the OrderMate template</h3><p>Required columns are <code>product_name</code>, <code>variant_name</code> and <code>sku</code>. Add arbitrary option dimensions with headers such as <code>option:Size</code>.</p></div><button type="button" className="secondary" onClick={downloadCatalogueImportTemplate}><Download size={15} /> Download template</button></div>
        <div className={`import-drop ${dragging ? "dragging" : ""}`} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files[0]); }}>
          <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={event => { void load(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <UploadCloud size={24} />
          <div><strong>{fileName || "Drop your catalogue CSV"}</strong><span>Maximum 5 MB · up to 2,000 data rows · create-only onboarding</span></div>
          <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>Choose CSV</button>
        </div>
      </section>

      {parsed && <section className="import-review">
        <div className="import-section-title"><div><p className="eyebrow">2 · Browser parse</p><h3>{parsed.rows.length} rows read</h3></div>{parsed.errors.length ? <span className="import-state bad"><AlertTriangle size={14} /> {parsed.errors.length} error{parsed.errors.length === 1 ? "" : "s"}</span> : <span className="import-state good"><CheckCircle2 size={14} /> CSV structure valid</span>}</div>
        {(parsed.errors.length > 0 || parsed.warnings.length > 0) && <IssueList errors={parsed.errors} warnings={parsed.warnings} />}
      </section>}

      {(preview.isPending || plan) && <section className="import-review">
        <div className="import-section-title"><div><p className="eyebrow">3 · Tenant dry-run</p><h3>{preview.isPending ? "Checking live OrderMate data…" : plan?.canCommit ? "Ready for review" : "Fix the CSV before importing"}</h3></div>{preview.isPending ? <div className="loader" /> : plan?.canCommit ? <span className="import-state good"><CheckCircle2 size={14} /> No blocking conflicts</span> : <span className="import-state bad"><AlertTriangle size={14} /> {plan?.errors.length || 0} blocking</span>}</div>
        {plan && <>
          <div className="import-summary">
            <Summary label="Products" value={plan.summary.productsToCreate} />
            <Summary label="Variants" value={plan.summary.variantsToCreate} />
            <Summary label="New categories" value={plan.summary.categoriesToCreate} />
            <Summary label="New suppliers" value={plan.summary.suppliersToCreate} />
            <Summary label="Supplier mappings" value={plan.summary.supplierMappingsToCreate} />
            <Summary label="Opening stock units" value={plan.summary.openingStockUnits} />
          </div>
          {(plan.errors.length > 0 || plan.warnings.length > 0) && <IssueList errors={plan.errors} warnings={plan.warnings} />}
          <div className="import-products">{plan.products.slice(0, 20).map(product => <div key={product.name} className="import-product"><div><strong>{product.name}</strong><small>{product.category?.name || "No category"} · {product.variants.length} variant{product.variants.length === 1 ? "" : "s"}</small></div><span>{product.variants.reduce((sum, variant) => sum + (variant.openingStock?.quantity || 0), 0)} opening units</span></div>)}</div>
          {plan.products.length > 20 && <small className="import-note">Showing the first 20 product groups. The dry-run covers all {plan.products.length}.</small>}
        </>}
      </section>}

      {preview.error && <ErrorText error={preview.error} />}
      {commit.error && <div className="import-commit-error"><ErrorText error={commit.error} /><button type="button" className="secondary" onClick={retryPreview}>Run a fresh dry-run</button></div>}

      {plan?.canCommit && <section className="import-confirm">
        <div><p className="eyebrow">4 · Commit</p><h3>One transaction, no partial import</h3><p>Commit revalidates this exact file against current tenant state. If the reviewed preview has gone stale or any write fails, nothing from this import is kept.</p></div>
        <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the dry-run, opening stock and supplier changes.</label>
      </section>}

      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button>{plan?.canCommit && <button className="primary" disabled={!reviewed || commit.isPending} onClick={() => commit.mutate()}><PackagePlus size={16} /> {commit.isPending ? "Importing atomically…" : `Import ${plan.summary.variantsToCreate} variants`}</button>}</div>
    </div>}
  </Modal>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}

function IssueList({ errors, warnings }: { errors: Array<{ rowNumber?: number; message: string }>; warnings: Array<{ rowNumber?: number; message: string }> }) {
  return <div className="import-issues">
    {errors.map((issue, index) => <div className="import-issue error" key={`e-${index}`}><AlertTriangle size={13} /><span><strong>{issue.rowNumber ? `Row ${issue.rowNumber}` : "File"}</strong>{issue.message}</span></div>)}
    {warnings.map((issue, index) => <div className="import-issue warning" key={`w-${index}`}><FileSpreadsheet size={13} /><span><strong>{issue.rowNumber ? `Row ${issue.rowNumber}` : "Note"}</strong>{issue.message}</span></div>)}
  </div>;
}
