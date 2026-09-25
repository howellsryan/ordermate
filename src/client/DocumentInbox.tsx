import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileImage, FileText, FileUp, UploadCloud } from "lucide-react";
import type { OrganizationSummary } from "../shared/types";
import { controlApi, date } from "./api";
import DocumentProposals from "./DocumentProposals";
import { ErrorText } from "./ui";

type DocumentSummary = {
  key: string;
  name: string;
  size: number;
  uploaded: string;
  contentType: string;
  purpose: string;
  status: string;
};

type DocumentList = { documents: DocumentSummary[]; truncated: boolean; cursor?: string };

export default function DocumentInbox({ tenant }: { tenant: OrganizationSummary }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const canUpload = tenant.role !== "viewer";

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant", tenant.id, "documents", "purchase-source"] });
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
      const response = await fetch(`/api/documents/file?key=${encodeURIComponent(document.key)}`, {
        credentials: "include",
        headers: { "x-ordermate-tenant": tenant.id },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(payload.error || `Preview failed (${response.status})`);
      }
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
    <p>Upload a supplier PDF or image. OrderMate stores the original in tenant-scoped EU R2, converts/extracts it with Cloudflare Workers AI, then presents a proposal for human review. AI never creates or receives stock directly.</p>

    {canUpload && <div
      className={`document-drop ${dragging ? "dragging" : ""}`}
      onDragEnter={event => { event.preventDefault(); setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
    >
      <input ref={inputRef} type="file" hidden accept="application/pdf,image/*" onChange={event => { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <UploadCloud size={24} />
      <div><strong>{upload.isPending ? "Uploading securely…" : "Drop a supplier PDF or image"}</strong><span>PDF, PNG, JPEG or other browser image formats · maximum 15 MB · extraction runs asynchronously</span></div>
      <button type="button" className="secondary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>Choose file</button>
    </div>}

    {upload.error && <ErrorText error={upload.error} />}
    {previewError && <ErrorText error={previewError} />}

    <DocumentProposals tenant={tenant} />

    <div className="source-history-heading"><span>Original source files</span><small>Immutable review evidence stored in R2</small></div>
    <div className="document-list">
      {documents.isLoading ? <div className="document-state"><div className="loader" /><span>Loading source documents…</span></div> : documents.error ? <ErrorText error={documents.error} /> : !documents.data?.documents.length ? <div className="document-state"><FileText size={22} /><strong>No source documents yet</strong><span>Upload the first supplier document when you have one.</span></div> : documents.data.documents.map(document => {
        const ImageIcon = document.contentType.startsWith("image/") ? FileImage : FileText;
        return <button className="document-row" key={document.key} onClick={() => preview(document)}><span className="document-icon"><ImageIcon size={17} /></span><span className="document-copy"><strong>{document.name}</strong><small>{date(document.uploaded)} · {fileSize(document.size)}</small></span><span className="document-status">Source</span><Eye size={15} /></button>;
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
