import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { can } from "./permissions";

type Env = AuthEnv & {
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
};

type Membership = { id: string; role: Role };

type DocumentSummary = {
  key: string;
  name: string;
  size: number;
  uploaded: string;
  contentType: string;
  purpose: string;
  status: string;
};

export const documentsApp = new Hono<{ Bindings: Env }>();

async function contextFor(request: Request, env: Env, action: "read" | "create") {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;

  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) return { error: Response.json({ error: "Select a business first" }, { status: 400 }) } as const;

  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
  if (!can(membership.role, "purchasing", action)) return { error: Response.json({ error: "Insufficient permission" }, { status: 403 }) } as const;

  return { session, tenantId, membership } as const;
}

function purpose(value: FormDataEntryValue | string | null) {
  return String(value || "purchase-source").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40) || "purchase-source";
}

function documentSummary(object: R2Object): DocumentSummary {
  const metadata = object.customMetadata || {};
  return {
    key: object.key,
    name: metadata.originalName || "Source document",
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    purpose: metadata.purpose || "document",
    status: metadata.status || "uploaded",
  };
}

documentsApp.get("/", async c => {
  const context = await contextFor(c.req.raw, c.env, "read");
  if ("error" in context) return context.error;
  const requestedPurpose = (c.req.query("purpose") || "purchase-source").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);
  const listed = await c.env.DOCUMENTS.list({
    prefix: `${context.tenantId}/${requestedPurpose}/`,
    limit: 100,
    include: ["customMetadata", "httpMetadata"],
  });
  const documents = listed.objects.map(documentSummary).sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return c.json({ documents, truncated: listed.truncated, cursor: listed.truncated ? listed.cursor : undefined });
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

  const docPurpose = purpose(form.get("purpose"));
  const eventId = crypto.randomUUID();
  const key = `${context.tenantId}/${docPurpose}/${eventId}`;
  const createdAt = new Date().toISOString();
  await c.env.DOCUMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      tenantId: context.tenantId,
      uploadedBy: context.session.user.id,
      originalName: file.name.slice(0, 180),
      purpose: docPurpose,
      status: "uploaded",
      createdAt,
    },
  });

  await c.env.EVENTS_QUEUE.send({
    type: "document.uploaded",
    eventId,
    tenantId: context.tenantId,
    key,
    purpose: docPurpose,
    uploadedBy: context.session.user.id,
    createdAt,
  });

  const object = await c.env.DOCUMENTS.head(key);
  return c.json(object ? documentSummary(object) : { key, name: file.name, size: file.size, uploaded: createdAt, contentType: file.type, purpose: docPurpose, status: "uploaded" }, 201);
});
