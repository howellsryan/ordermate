import { Hono } from "hono";
import type { Role, SessionPayload } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { can, permissionForRequest } from "./permissions";
import { TenantStore } from "./tenant-store";

export { TenantStore };

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
};

type MemberRow = { organizationId: string; role: Role; name: string; slug: string };

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

app.all("/api/auth/*", async c => createAuth(c.env, c.req.raw).handler(c.req.raw));

async function sessionFor(request: Request, env: Env) {
  const auth = createAuth(env, request);
  return auth.api.getSession({ headers: request.headers });
}

async function memberships(userId: string, env: Env): Promise<MemberRow[]> {
  const result = await env.CONTROL_DB.prepare(
    `SELECT m.organizationId, m.role, o.name, o.slug
     FROM member m JOIN organization o ON o.id = m.organizationId
     WHERE m.userId = ? ORDER BY o.name`,
  ).bind(userId).all<MemberRow>();
  return result.results;
}

app.get("/api/session", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const orgs = await memberships(session.user.id, c.env);
  const payload: SessionPayload = {
    user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image },
    organizations: orgs.map(org => ({ id: org.organizationId, name: org.name, slug: org.slug, role: org.role })),
  };
  return c.json(payload);
});

app.post("/api/organizations", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Business name is required" }, 400);
  const slugBase = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "business";
  const slug = `${slugBase}-${crypto.randomUUID().slice(0, 6)}`;
  const auth = createAuth(c.env, c.req.raw);
  const organization = await auth.api.createOrganization({
    headers: c.req.raw.headers,
    body: { name, slug, keepCurrentActiveOrganization: true },
  });
  return c.json(organization, 201);
});

app.all("/api/tenant/*", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const tenantId = c.req.header("x-ordermate-tenant");
  if (!tenantId) return c.json({ error: "Select a business first" }, 400);

  const membership = await c.env.CONTROL_DB.prepare("SELECT role FROM member WHERE userId = ? AND organizationId = ?")
    .bind(session.user.id, tenantId).first<{ role: Role }>();
  if (!membership) return c.json({ error: "Forbidden" }, 403);

  const tenantPath = c.req.path.replace(/^\/api\/tenant/, "") || "/";
  const permission = permissionForRequest(tenantPath, c.req.method);
  if (!can(membership.role, permission.resource, permission.action)) return c.json({ error: "Insufficient permission" }, 403);

  const targetUrl = new URL(c.req.url);
  targetUrl.hostname = "tenant.internal";
  targetUrl.pathname = tenantPath;

  const headers = new Headers(c.req.raw.headers);
  headers.delete("x-ordermate-tenant");
  headers.set("x-ordermate-actor-id", session.user.id);
  headers.set("x-ordermate-actor-role", membership.role);
  headers.set("x-ordermate-actor-name", session.user.name);

  const forwarded = new Request(targetUrl, {
    method: c.req.method,
    headers,
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.raw.body,
    redirect: "manual",
  });
  const namespace = c.env.TENANT_STORES.jurisdiction("eu");
  return namespace.getByName(tenantId).fetch(forwarded);
});

app.post("/api/documents", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const tenantId = c.req.header("x-ordermate-tenant");
  if (!tenantId) return c.json({ error: "Select a business first" }, 400);
  const member = await c.env.CONTROL_DB.prepare("SELECT role FROM member WHERE userId = ? AND organizationId = ?").bind(session.user.id, tenantId).first<{ role: Role }>();
  if (!member || !can(member.role, "purchasing", "create")) return c.json({ error: "Forbidden" }, 403);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "File exceeds 15 MB" }, 413);
  const purpose = String(form.get("purpose") || "document").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const key = `${tenantId}/${purpose}/${crypto.randomUUID()}-${safeName}`;
  await c.env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { tenantId, uploadedBy: session.user.id, purpose } });
  return c.json({ key, name: file.name, size: file.size }, 201);
});

app.get("/api/health", c => c.json({ ok: true, service: "ordermate" }));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      try {
        console.log("OrderMate event", message.id, message.body);
        message.ack();
      } catch (cause) {
        console.error("Queue event failed", cause);
        message.retry();
      }
    }
  },
};
