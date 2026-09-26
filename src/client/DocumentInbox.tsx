import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileImage, FileText, FileUp, LockKeyhole, Sparkles, UploadCloud } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { controlApi, date, errorFrom } from "./api";
import { isDemoTenant } from "./demo-store";
import DocumentProposals from "./DocumentProposals";
import { ErrorText } from "./ui";

type DocumentSummary = { key: string; name: string; size: number; uploaded: string; contentType: string; purpose: string; status: string };
type DocumentList = { documents: DocumentSummary[]; truncated: boolean; cursor?: string };
type DocumentCapabilities = { aiDocumentExtractionEnabled: boolean; aiProcessingResidency: string; storedSourceResidency: string };
type ExtractionQueueResult = { status: "queued" | "already_queued" | "already_processed"; eventId: string };

export default function DocumentInbox({ tenant }: { tenant: OrganizationSummary }) {
  return isDemoTenant(tenant.id) ? <LocalDemoDocumentInbox /> : <LiveDocumentInbox tenant={tenant} />;
}

function LocalDemoDocumentInbox() {
  return <section className="panel document-inbox demo-document-local">
    <div className="panel-heading"><div><p className="eyebrow">Source documents</p><h3>Purchasing inbox</h3></div><LockKeyhole size={21} /></div>
    <div className="document-compliance"><LockKeyhole size={17} /><div><strong>Browser-only demo boundary</strong><span>Supplier file upload and AI extraction are intentionally unavailable in guest mode because a PDF or image would have to leave localStorage/browser memory to use the production document pipeline.</span></div></div>
    <div className="document-state"><FileText size={22} /><strong>No cloud document storage in guest mode</strong><span>Use the seeded purchase orders, receiving, supplier mappings and catalogue CSV import to exercise the operational flow. Sign in to a real workspace to use R2-backed source documents and reviewed extraction proposals.</span></div>
  </section>;
}

function LiveDocumentInbox({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [queuedKeys, setQueuedKeys] = useState<Set<string>>(() => new Set());
  const canUpload = ["owner", "admin", "manager", "inventory"].includes(tenant.role);

  const capabilities = useQuery({
    queryKey: ["tenant", tenant.id, "documents", "capabilities"],
    queryFn: () => controlApi<DocumentCapabilities>("/documents/capabilities", { headers: { "x-ordermate-tenant": tenant.id } }),
  });
  const extractionEnabled = capabilities.data?.aiDocumentExtractionEnabled === true;
  const documents = useQuery({
    queryKey: ["tenant", tenant.id, "documents", "purchase-source"],
    queryFn: () => controlApi<DocumentList>("/documents?purpose=purchase-source", { headers: { "x-ordermate-tenant": tenant.id } }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", "purchase-source");
      return controlApi<DocumentSummary>("/documents", { method: "POST", headers: { "x-ordermate-tenant": tenant.id }, body: form });
    },
    onSuccess: document => {
      if (document.status === "queued") setQueuedKeys(current => new Set(current).add(document.key));
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "documents", "purchase-source"] });
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "documents", "proposals"] });
    },
  });

  const extract = useMutation({
    mutationFn: (key: string) => controlApi<ExtractionQueueResult>("/documents/extract", {
      method: "POST",
      headers: { "x-ordermate-tenant": tenant.id },
      body: JSON.stringify({ key }),
    }),
    onSuccess: (result, key) => {
      if (result.status !== "already_processed") setQueuedKeys(current => new Set(current).add(key));
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "documents", "proposals"] });
    },
  });

  const chooseFile = (file?: File | null) => {
    if (!file || upload.isPending) return;
    upload.mutate(file);
  };

  const preview = async (document: DocumentSummary) => {
    setPreviewError(null);
    try {
      const response = await fetch(`/api/documents/file?key=${encodeURIComponent(document.key)}`, { credentials: "include", headers: { "x-ordermate-tenant": tenant.id } });
      if (!response.ok) throw await errorFrom(response);
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = blobUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (cause) {
      setPreviewError(cause);
    }
  };

  return <section className="panel document-inbox">
    <div className="panel-heading"><div><p className="eyebrow">Source documents</p><h3>Purchasing inbox</h3></div><FileUp size={21} /></div>
    <p>{extractionEnabled ? "Upload a supplier PDF or image. Operating Layer stores the original in tenant-scoped EU R2, extracts it with Cloudflare Workers AI, then presents a proposal for human review. AI never creates or receives stock directly." : "Supplier PDFs and images are stored in tenant-scoped EU R2. AI extraction is disabled in this deployment until its global Workers AI processing posture is explicitly accepted for your compliance requirements."}</p>

    {!capabilities.isLoading && !extractionEnabled && <div className="document-compliance"><LockKeyhole size={17} /><div><strong>AI extraction disabled by default</strong><span>Source storage remains EU-jurisdictional. Set the Wrangler variable AI_DOCUMENT_EXTRACTION_ENABLED to true only after accepting that Workers AI currently cannot be restricted with Regional Services. Documents stored now can be selectively extracted later if the flag is enabled.</span></div></div>}
    {capabilities.error && <ErrorText error={capabilities.error} />}

    {canUpload && <div className={`document-drop ${dragging ? "dragging" : ""}`} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
      <input ref={inputRef} type="file" hidden accept="application/pdf,image/*" onChange={event => { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <UploadCloud size={24} />
      <div><strong>{upload.isPending ? "Uploading securely…" : "Drop a supplier PDF or image"}</strong><span>PDF, PNG, JPEG or other browser image formats · maximum 15 MB · {extractionEnabled ? "extraction runs asynchronously" : "stored only; AI extraction disabled"}</span></div>
      <button type="button" className="secondary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>Choose file</button>
    </div>}

    {upload.error && <ErrorText error={upload.error} />}
    {extract.error && <ErrorText error={extract.error} />}
    {previewError !== null && <ErrorText error={previewError} />}

    <DocumentProposals tenant={tenant} />

    <div className="source-history-heading"><span>Original source files</span><small>Immutable review evidence stored in EU R2</small></div>
    <div className="document-list">
      {documents.isLoading ? <div className="document-state"><div className="loader" /><span>Loading source documents…</span></div> : documents.error ? <ErrorText error={documents.error} /> : !documents.data?.documents.length ? <div className="document-state"><FileText size={22} /><strong>No source documents yet</strong><span>Upload the first supplier document when you have one.</span></div> : documents.data.documents.map(document => {
        const ImageIcon = document.contentType.startsWith("image/") ? FileImage : FileText;
        const queued = document.status === "queued" || queuedKeys.has(document.key);
        return <div className="document-row" key={document.key}>
          <span className="document-icon"><ImageIcon size={17} /></span>
          <span className="document-copy"><strong>{document.name}</strong><small>{date(document.uploaded)} · {fileSize(document.size)}</small></span>
          <span className="document-status">Source</span>
          <span className="document-actions">
            {canUpload && extractionEnabled && !queued && <button type="button" className="table-action" disabled={extract.isPending} onClick={() => extract.mutate(document.key)}><Sparkles size={13} /> Extract</button>}
            {canUpload && extractionEnabled && queued && <span className="document-queued"><Sparkles size={12} /> Queued</span>}
            <button type="button" className="icon-button" aria-label={`Preview ${document.name}`} onClick={() => preview(document)}><Eye size={15} /></button>
          </span>
        </div>;
      })}
    </div>
    {documents.data?.truncated && <small className="document-note">Showing the first 100 source documents. Pagination will be enabled before this limit becomes operationally relevant.</small>}
  </section>;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
