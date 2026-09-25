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
type PurchaseOrder = { id: string; number: string; status: string };
type SourceSummary = { key: string; name: string; uploaded: string; contentType: string; status: string; purchaseOrderId: string };
type ProposalSummary = { key: string; uploaded: string; status: string; purchaseOrderId: string; purchaseOrderNumber: string; supplierName: string; lineCount: number; matchedCount: number; warningCount: number; eventId: string };

const SOURCE_PURPOSE = "delivery-source";
const PROPOSAL_PURPOSE = "delivery-proposal";
const REQUEST_PURPOSE = "delivery-extraction-request";
const QUEUE_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export const deliveryDocumentsApp = new Hono<{ Bindings: Env }>();

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

function sourceSummary(object: R2Object): SourceSummary {
  const metadata = object.customMetadata || {};
  return {
    key: object.key,
    name: metadata.originalName || "Delivery note",
    uploaded: object.uploaded.toISOString(),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    status: metadata.status || "stored",
    purchaseOrderId: metadata.purchaseOrderId || "",
  };
}

function proposalSummary(object: R2Object): ProposalSummary {
  const metadata = object.customMetadata || {};
  return {
    key: object.key,
    uploaded: object.uploaded.toISOString(),
    status: metadata.status || "needs_review",
    purchaseOrderId: metadata.purchaseOrderId || "",
    purchaseOrderNumber: metadata.purchaseOrderNumber || "",
    supplierName: metadata.supplierName || "Supplier",
    lineCount: Number(metadata.lineCount || 0),
    matchedCount: Number(metadata.matchedCount || 0),
    warningCount: Number(metadata.warningCount || 0),
    eventId: metadata.eventId || object.key.split("/").at(-1)?.replace(/\.json$/, "") || "",
  };
}

function sourceEventId(tenantId: string, key: string) {
  const prefix = `${tenantId}/${SOURCE_PURPOSE}/`;
  if (!key.startsWith(prefix)) return null;
  const eventId = key.slice(prefix.length);
  return eventId && !eventId.includes("/") ? eventId : null;
}

async function getPurchaseOrder(env: Env, tenantId: string, purchaseOrderId: string, actor: { id: string; role: Role }) {
  const stub = env.TENANT_STORES.jurisdiction("eu").getByName(tenantId);
  const response = await stub.fetch(new Request(`https://tenant.internal/purchase-orders/${encodeURIComponent(purchaseOrderId)}`, {
    headers: { "x-ordermate-actor-id": actor.id, "x-ordermate-actor-role": actor.role },
  }));
  if (!response.ok) return null;
  return response.json<PurchaseOrder>();
}

async function queueExtraction(env: Env, tenantId: string, key: string, eventId: string, purchaseOrderId: string, uploadedBy: string, createdAt: string) {
  const proposalKey = `${tenantId}/${PROPOSAL_PURPOSE}/${eventId}.json`;
  if (await env.DOCUMENTS.head(proposalKey)) return "already_processed" as const;

  const markerKey = `${tenantId}/${REQUEST_PURPOSE}/${eventId}.json`;
  const marker = await env.DOCUMENTS.head(markerKey);
  if (marker && Date.now() - marker.uploaded.getTime() < QUEUE_DEDUPE_WINDOW_MS) return "already_queued" as const;

  await env.DOCUMENTS.put(markerKey, JSON.stringify({ eventId, purchaseOrderId, queuedAt: new Date().toISOString() }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { eventId, purchaseOrderId },
  });
  try {
    await env.EVENTS_QUEUE.send({
      type: "delivery_note.uploaded",
      eventId,
      tenantId,
      key,
      purpose: SOURCE_PURPOSE,
      purchaseOrderId,
      uploadedBy,
      createdAt,
    });
  } catch (cause) {
    await env.DOCUMENTS.delete(markerKey).catch(() => undefined);
    throw cause;
  }
  return "queued" as const;
}

deliveryDocumentsApp.get("/sources", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const purchaseOrderId = c.req.query("purchaseOrderId") || "";
  if (!purchaseOrderId) return c.json({ error: "Purchase order is required" }, 400);
  const listed = await c.env.DOCUMENTS.list({ prefix: `${context.tenantId}/${SOURCE_PURPOSE}/`, limit: 100, include: ["customMetadata", "httpMetadata"] });
  const sources = listed.objects.map(sourceSummary).filter(source => source.purchaseOrderId === purchaseOrderId).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return c.json({ sources, truncated: listed.truncated });
});

deliveryDocumentsApp.get("/file", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const key = c.req.query("key") || "";
  const allowedPrefix = `${context.tenantId}/${SOURCE_PURPOSE}/`;
  if (!key.startsWith(allowedPrefix)) return c.json({ error: "Delivery note not found" }, 404);
  const object = await c.env.DOCUMENTS.get(key);
  if (!object || object.customMetadata?.tenantId !== context.tenantId) return c.json({ error: "Delivery note not found" }, 404);
  const headers = new Headers({ "cache-control": "private, no-store" });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", "inline");
  return new Response(object.body, { headers });
});

deliveryDocumentsApp.get("/proposals", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const purchaseOrderId = c.req.query("purchaseOrderId") || "";
  if (!purchaseOrderId) return c.json({ error: "Purchase order is required" }, 400);
  const listed = await c.env.DOCUMENTS.list({ prefix: `${context.tenantId}/${PROPOSAL_PURPOSE}/`, limit: 100, include: ["customMetadata"] });
  const proposals = listed.objects.map(proposalSummary).filter(proposal => proposal.purchaseOrderId === purchaseOrderId).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return c.json({ proposals, truncated: listed.truncated });
});

deliveryDocumentsApp.get("/proposal", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const key = c.req.query("key") || "";
  const allowedPrefix = `${context.tenantId}/${PROPOSAL_PURPOSE}/`;
  if (!key.startsWith(allowedPrefix) || !key.endsWith(".json")) return c.json({ error: "Delivery proposal not found" }, 404);
  const object = await c.env.DOCUMENTS.get(key);
  if (!object) return c.json({ error: "Delivery proposal not found" }, 404);
  return c.json(await object.json<unknown>());
});

deliveryDocumentsApp.post("/extract", async c => {
  const context = await contextFor(c.req.raw, c.env, "update");
  if ("error" in context) return context.error;
  if (c.env.AI_DOCUMENT_EXTRACTION_ENABLED !== "true") return c.json({ error: "AI document extraction is disabled for this deployment" }, 409);
  const body = await c.req.json<{ key?: string }>();
  const key = body.key || "";
  const eventId = sourceEventId(context.tenantId, key);
  if (!eventId) return c.json({ error: "Delivery note not found" }, 404);
  const source = await c.env.DOCUMENTS.head(key);
  const purchaseOrderId = source?.customMetadata?.purchaseOrderId || "";
  if (!source || source.customMetadata?.tenantId !== context.tenantId || source.customMetadata?.purpose !== SOURCE_PURPOSE || !purchaseOrderId) return c.json({ error: "Delivery note not found" }, 404);
  const result = await queueExtraction(c.env, context.tenantId, key, eventId, purchaseOrderId, context.session.user.id, source.customMetadata?.createdAt || source.uploaded.toISOString());
  return c.json({ status: result, eventId });
});

deliveryDocumentsApp.post("/proposal/complete", async c => {
  const context = await contextFor(c.req.raw, c.env, "update");
  if ("error" in context) return context.error;
  const body = await c.req.json<{ key?: string; purchaseOrderId?: string }>();
  const key = body.key || "";
  const purchaseOrderId = body.purchaseOrderId || "";
  const allowedPrefix = `${context.tenantId}/${PROPOSAL_PURPOSE}/`;
  if (!key.startsWith(allowedPrefix) || !key.endsWith(".json") || !purchaseOrderId) return c.json({ error: "Proposal and purchase order are required" }, 400);
  const object = await c.env.DOCUMENTS.get(key);
  if (!object || object.customMetadata?.purchaseOrderId !== purchaseOrderId) return c.json({ error: "Delivery proposal does not belong to this purchase order" }, 409);
  const purchaseOrder = await getPurchaseOrder(c.env, context.tenantId, purchaseOrderId, { id: context.session.user.id, role: context.membership.role });
  if (!purchaseOrder) return c.json({ error: "Purchase order could not be verified in this business" }, 409);
  const proposal = await object.json<Record<string, unknown>>();
  const acceptedAt = new Date().toISOString();
  await c.env.DOCUMENTS.put(key, JSON.stringify({ ...proposal, status: "accepted", acceptedAt }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { ...(object.customMetadata || {}), status: "accepted", acceptedAt },
  });
  return c.json({ ok: true });
});

deliveryDocumentsApp.post("/", async c => {
  const context = await contextFor(c.req.raw, c.env, "update");
  if ("error" in context) return context.error;
  const form = await c.req.formData();
  const file = form.get("file");
  const purchaseOrderId = String(form.get("purchaseOrderId") || "").trim();
  if (!(file instanceof File)) return c.json({ error: "Choose a PDF or image delivery note" }, 400);
  if (!purchaseOrderId) return c.json({ error: "Purchase order is required" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "File exceeds 15 MB" }, 413);
  if (!(file.type === "application/pdf" || file.type.startsWith("image/"))) return c.json({ error: "Only PDF and image delivery notes are supported" }, 415);

  const purchaseOrder = await getPurchaseOrder(c.env, context.tenantId, purchaseOrderId, { id: context.session.user.id, role: context.membership.role });
  if (!purchaseOrder) return c.json({ error: "Purchase order not found" }, 404);
  if (!["ordered", "partially_received"].includes(purchaseOrder.status)) return c.json({ error: "Purchase order is not open for receiving" }, 409);

  const extractionEnabled = c.env.AI_DOCUMENT_EXTRACTION_ENABLED === "true";
  const eventId = crypto.randomUUID();
  const key = `${context.tenantId}/${SOURCE_PURPOSE}/${eventId}`;
  const createdAt = new Date().toISOString();
  await c.env.DOCUMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      tenantId: context.tenantId,
      purchaseOrderId,
      uploadedBy: context.session.user.id,
      originalName: file.name.slice(0, 180),
      purpose: SOURCE_PURPOSE,
      status: extractionEnabled ? "queued" : "stored",
      createdAt,
    },
  });
  if (extractionEnabled) await queueExtraction(c.env, context.tenantId, key, eventId, purchaseOrderId, context.session.user.id, createdAt);
  const object = await c.env.DOCUMENTS.head(key);
  return c.json(object ? sourceSummary(object) : { key, name: file.name, uploaded: createdAt, contentType: file.type, status: extractionEnabled ? "queued" : "stored", purchaseOrderId }, 201);
});
