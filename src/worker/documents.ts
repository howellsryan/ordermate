import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { can } from "./permissions";
import type { TenantStore } from "./tenant-store-runtime";

type Env = AuthEnv & {
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  AI_DOCUMENT_EXTRACTION_ENABLED: string;
};

type Membership = { id: string; role: Role };
type DocumentSummary = { key: string; name: string; size: number; uploaded: string; contentType: string; purpose: string; status: string };
type ProposalSummary = { key: string; uploaded: string; status: string; supplierName: string; lineCount: number; matchedCount: number; warningCount: number; eventId: string };

const PURPOSE = "purchase-source";
const PROPOSAL_PURPOSE = "purchase-proposal";
const EXTRACTION_REQUEST_PURPOSE = "purchase-extraction-request";
const QUEUE_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const documentsApp = new Hono<{ Bindings: Env }>();

async function contextFor(request: Request, env: Env, action: "read" | "create" | "update") {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) return { error: Response.json({ error: "Select a business first" }, { status: 400 }) } as const;
  const membership = await env.CONTROL_DB.prepare("SELECT id, role FROM member WHERE userId = ? AND organizationId = ?").bind(session.user.id, tenantId).first<Membership>();
  if (!membership) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
  if (!can(membership.role, "purchasing", action)) return { error: Response.json({ error: "Insufficient permission" }, { status: 403 }) } as const;
  return { session, tenantId, membership } as const;
}

function documentSummary(object: R2Object): DocumentSummary {
  const metadata = object.customMetadata || {};
  return {
    key: object.key,
    name: metadata.originalName || "Source document",
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    purpose: PURPOSE,
    status: metadata.status || "stored",
  };
}

function proposalSummary(object: R2Object): ProposalSummary {
  const metadata = object.customMetadata || {};
  return {
    key: object.key,
    uploaded: object.uploaded.toISOString(),
    status: metadata.status || "needs_review",
    supplierName: metadata.supplierName || "Unmatched supplier",
    lineCount: Number(metadata.lineCount || 0),
    matchedCount: Number(metadata.matchedCount || 0),
    warningCount: Number(metadata.warningCount || 0),
    eventId: metadata.eventId || object.key.split("/").at(-1)?.replace(/\.json$/, "") || "",
  };
}

function sourceEventId(tenantId: string, key: string) {
  const prefix = `${tenantId}/${PURPOSE}/`;
  if (!key.startsWith(prefix)) return null;
  const eventId = key.slice(prefix.length);
  return eventId && !eventId.includes("/") ? eventId : null;
}

async function queueExtraction(env: Env, tenantId: string, key: string, eventId: string, uploadedBy: string, createdAt: string) {
  const proposalKey = `${tenantId}/${PROPOSAL_PURPOSE}/${eventId}.json`;
  if (await env.DOCUMENTS.head(proposalKey)) return "already_processed" as const;

  const markerKey = `${tenantId}/${EXTRACTION_REQUEST_PURPOSE}/${eventId}.json`;
  const marker = await env.DOCUMENTS.head(markerKey);
  if (marker && Date.now() - marker.uploaded.getTime() < QUEUE_DEDUPE_WINDOW_MS) return "already_queued" as const;

  await env.DOCUMENTS.put(markerKey, JSON.stringify({ eventId, queuedAt: new Date().toISOString() }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { eventId },
  });
  try {
    await env.EVENTS_QUEUE.send({
      type: "document.uploaded",
      eventId,
      tenantId,
      key,
      purpose: PURPOSE,
      uploadedBy,
      createdAt,
    });
  } catch (cause) {
    await env.DOCUMENTS.delete(markerKey).catch(() => undefined);
    throw cause;
  }
  return "queued" as const;
}

documentsApp.get("/capabilities", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  return c.json({
    aiDocumentExtractionEnabled: c.env.AI_DOCUMENT_EXTRACTION_ENABLED === "true",
    aiProcessingResidency: "cloudflare-global",
    storedSourceResidency: "eu",
  });
});

documentsApp.get("/", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const listed = await c.env.DOCUMENTS.list({ prefix: `${context.tenantId}/${PURPOSE}/`, limit: 100, include: ["customMetadata", "httpMetadata"] });
  const documents = listed.objects.map(documentSummary).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return c.json({ documents, truncated: listed.truncated, cursor: listed.truncated ? listed.cursor : undefined });
});

documentsApp.get("/file", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const key = c.req.query("key") || "";
  const allowedPrefix = `${context.tenantId}/${PURPOSE}/`;
  if (!key.startsWith(allowedPrefix)) return c.json({ error: "Document not found" }, 404);
  const object = await c.env.DOCUMENTS.get(key);
  if (!object) return c.json({ error: "Document not found" }, 404);
  const headers = new Headers({ "cache-control": "private, no-store" });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", "inline");
  return new Response(object.body, { headers });
});

documentsApp.get("/proposals", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const listed = await c.env.DOCUMENTS.list({ prefix: `${context.tenantId}/${PROPOSAL_PURPOSE}/`, limit: 100, include: ["customMetadata"] });
  const proposals = listed.objects.map(proposalSummary).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return c.json({ proposals, truncated: listed.truncated, cursor: listed.truncated ? listed.cursor : undefined });
});

documentsApp.get("/proposal", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const key = c.req.query("key") || "";
  const allowedPrefix = `${context.tenantId}/${PROPOSAL_PURPOSE}/`;
  if (!key.startsWith(allowedPrefix) || !key.endsWith(".json")) return c.json({ error: "Proposal not found" }, 404);
  const object = await c.env.DOCUMENTS.get(key);
  if (!object) return c.json({ error: "Proposal not found" }, 404);
  return c.json(await object.json<unknown>());
});

documentsApp.post("/extract", async c => {
  const context = await contextFor(c.req.raw, c.env, "update");
  if ("error" in context) return context.error;
  if (c.env.AI_DOCUMENT_EXTRACTION_ENABLED !== "true") return c.json({ error: "AI document extraction is disabled for this deployment" }, 409);

  const body = await c.req.json<{ key?: string }>();
  const key = body.key || "";
  const eventId = sourceEventId(context.tenantId, key);
  if (!eventId) return c.json({ error: "Source document not found" }, 404);

  const source = await c.env.DOCUMENTS.head(key);
  if (!source || source.customMetadata?.tenantId !== context.tenantId || source.customMetadata?.purpose !== PURPOSE) return c.json({ error: "Source document not found" }, 404);

  const result = await queueExtraction(
    c.env,
    context.tenantId,
    key,
    eventId,
    context.session.user.id,
    source.customMetadata?.createdAt || source.uploaded.toISOString(),
  );
  return c.json({ status: result, eventId });
});

documentsApp.post("/proposal/complete", async c => {
  const context = await contextFor(c.req.raw, c.env, "update");
  if ("error" in context) return context.error;
  const body = await c.req.json<{ key?: string; purchaseOrderId?: string }>();
  const key = body.key || "";
  const purchaseOrderId = body.purchaseOrderId || "";
  const allowedPrefix = `${context.tenantId}/${PROPOSAL_PURPOSE}/`;
  if (!key.startsWith(allowedPrefix) || !key.endsWith(".json") || !purchaseOrderId) return c.json({ error: "Proposal and purchase order are required" }, 400);

  const proposalObject = await c.env.DOCUMENTS.get(key);
  if (!proposalObject) return c.json({ error: "Proposal not found" }, 404);
  const proposal = await proposalObject.json<Record<string, unknown>>();
  const stub = c.env.TENANT_STORES.jurisdiction("eu").getByName(context.tenantId);
  const poResponse = await stub.fetch(new Request(`https://tenant.internal/purchase-orders/${encodeURIComponent(purchaseOrderId)}`, {
    headers: { "x-ordermate-actor-id": context.session.user.id, "x-ordermate-actor-role": context.membership.role },
  }));
  if (!poResponse.ok) return c.json({ error: "Purchase order could not be verified in this business" }, 409);

  const acceptedAt = new Date().toISOString();
  const metadata = proposalObject.customMetadata || {};
  await c.env.DOCUMENTS.put(key, JSON.stringify({ ...proposal, status: "accepted", purchaseOrderId, acceptedAt }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { ...metadata, status: "accepted", purchaseOrderId, acceptedAt },
  });
  return c.json({ ok: true });
});

documentsApp.post("/", async c => {
  const context = await contextFor(c.req.raw, c.env, "create");
  if ("error" in context) return context.error;
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Choose a PDF or image to upload" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "File exceeds 15 MB" }, 413);
  const allowedType = file.type === "application/pdf" || file.type.startsWith("image/");
  if (!allowedType) return c.json({ error: "Only PDF and image source documents are supported" }, 415);

  const extractionEnabled = c.env.AI_DOCUMENT_EXTRACTION_ENABLED === "true";
  const eventId = crypto.randomUUID();
  const key = `${context.tenantId}/${PURPOSE}/${eventId}`;
  const createdAt = new Date().toISOString();
  await c.env.DOCUMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      tenantId: context.tenantId,
      uploadedBy: context.session.user.id,
      originalName: file.name.slice(0, 180),
      purpose: PURPOSE,
      status: extractionEnabled ? "queued" : "stored",
      createdAt,
    },
  });

  if (extractionEnabled) {
    await queueExtraction(c.env, context.tenantId, key, eventId, context.session.user.id, createdAt);
  }

  const object = await c.env.DOCUMENTS.head(key);
  return c.json(object ? documentSummary(object) : { key, name: file.name, size: file.size, uploaded: createdAt, contentType: file.type, purpose: PURPOSE, status: extractionEnabled ? "queued" : "stored" }, 201);
});
