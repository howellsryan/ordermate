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
type Membership = { id: string; role: Role };
type ManagedRole = Exclude<Role, "owner">;

const managedRoles: ManagedRole[] = ["admin", "manager", "inventory", "fulfilment", "viewer"];
const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
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

async function membershipFor(userId: string, organizationId: string, env: Env) {
  return env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(userId, organizationId).first<Membership>();
}

function canManageMembers(role: Role) {
  return role === "owner" || role === "admin";
}

function isManagedRole(value: unknown): value is ManagedRole {
  return typeof value === "string" && managedRoles.includes(value as ManagedRole);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function inviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
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

app.get("/api/organizations/:organizationId/members", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const organizationId = c.req.param("organizationId");
  const membership = await membershipFor(session.user.id, organizationId, c.env);
  if (!membership) return c.json({ error: "Forbidden" }, 403);

  const members = await c.env.CONTROL_DB.prepare(
    `SELECT m.id, m.userId, u.name, u.email, m.role, m.createdAt
     FROM member m JOIN user u ON u.id = m.userId
     WHERE m.organizationId = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
  ).bind(organizationId).all<{ id: string; userId: string; name: string; email: string; role: Role; createdAt: number }>();

  let pendingInvites: Array<{ id: string; email: string; role: ManagedRole; expiresAt: number; createdAt: number }> = [];
  if (canManageMembers(membership.role)) {
    const pending = await c.env.CONTROL_DB.prepare(
      `SELECT id, email, role, expiresAt, createdAt FROM workspace_invite
       WHERE organizationId = ? AND acceptedAt IS NULL AND expiresAt > ?
       ORDER BY createdAt DESC`,
    ).bind(organizationId, Date.now()).all<{ id: string; email: string; role: ManagedRole; expiresAt: number; createdAt: number }>();
    pendingInvites = pending.results;
  }

  return c.json({ members: members.results, pendingInvites, canManage: canManageMembers(membership.role) });
});

app.post("/api/organizations/:organizationId/invites", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const organizationId = c.req.param("organizationId");
  const membership = await membershipFor(session.user.id, organizationId, c.env);
  if (!membership || !canManageMembers(membership.role)) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ email?: string; role?: string }>();
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "A valid email address is required" }, 400);
  if (!isManagedRole(body.role)) return c.json({ error: "Choose a valid role" }, 400);

  const existing = await c.env.CONTROL_DB.prepare(
    `SELECT m.id FROM member m JOIN user u ON u.id = m.userId
     WHERE m.organizationId = ? AND lower(u.email) = ?`,
  ).bind(organizationId, email).first<{ id: string }>();
  if (existing) return c.json({ error: "That person is already a member" }, 409);

  await c.env.CONTROL_DB.prepare(
    "DELETE FROM workspace_invite WHERE organizationId = ? AND lower(email) = ? AND acceptedAt IS NULL",
  ).bind(organizationId, email).run();

  const token = inviteToken();
  const tokenHash = await sha256(token);
  const createdAt = Date.now();
  const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
  const id = crypto.randomUUID();
  await c.env.CONTROL_DB.prepare(
    `INSERT INTO workspace_invite (id, tokenHash, organizationId, email, role, expiresAt, createdBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, tokenHash, organizationId, email, body.role, expiresAt, session.user.id, createdAt).run();

  const origin = new URL(c.req.url).origin;
  return c.json({ id, inviteUrl: `${origin}/?invite=${encodeURIComponent(token)}`, expiresAt }, 201);
});

app.patch("/api/organizations/:organizationId/members/:memberId", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const organizationId = c.req.param("organizationId");
  const membership = await membershipFor(session.user.id, organizationId, c.env);
  if (!membership || !canManageMembers(membership.role)) return c.json({ error: "Forbidden" }, 403);

  const body = await c.req.json<{ role?: string }>();
  if (!isManagedRole(body.role)) return c.json({ error: "Choose a valid role" }, 400);
  const memberId = c.req.param("memberId");
  const target = await c.env.CONTROL_DB.prepare(
    "SELECT role FROM member WHERE id = ? AND organizationId = ?",
  ).bind(memberId, organizationId).first<{ role: Role }>();
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner") return c.json({ error: "Ownership cannot be changed from this screen" }, 409);

  const auth = createAuth(c.env, c.req.raw);
  await auth.api.updateMemberRole({
    headers: c.req.raw.headers,
    body: { memberId, organizationId, role: body.role },
  });
  return c.json({ ok: true });
});

app.post("/api/invites/accept", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Sign in with the invited Google account first" }, 401);
  const body = await c.req.json<{ token?: string }>();
  if (!body.token || body.token.length < 40) return c.json({ error: "Invalid invite link" }, 400);

  const tokenHash = await sha256(body.token);
  const invite = await c.env.CONTROL_DB.prepare(
    `SELECT id, organizationId, email, role, expiresAt, acceptedAt
     FROM workspace_invite WHERE tokenHash = ?`,
  ).bind(tokenHash).first<{ id: string; organizationId: string; email: string; role: ManagedRole; expiresAt: number; acceptedAt: number | null }>();
  if (!invite || invite.acceptedAt) return c.json({ error: "This invite is no longer available" }, 410);
  if (invite.expiresAt <= Date.now()) return c.json({ error: "This invite has expired" }, 410);
  if (session.user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
    return c.json({ error: `This invite was created for ${invite.email}. Sign in with that Google account.` }, 403);
  }

  const existing = await membershipFor(session.user.id, invite.organizationId, c.env);
  if (!existing) {
    const auth = createAuth(c.env, c.req.raw);
    try {
      await auth.api.addMember({
        body: { userId: session.user.id, organizationId: invite.organizationId, role: invite.role },
      });
    } catch (cause) {
      const raced = await membershipFor(session.user.id, invite.organizationId, c.env);
      if (!raced) throw cause;
    }
  }

  await c.env.CONTROL_DB.prepare(
    "UPDATE workspace_invite SET acceptedAt = ? WHERE id = ? AND acceptedAt IS NULL",
  ).bind(Date.now(), invite.id).run();
  return c.json({ ok: true, organizationId: invite.organizationId });
});

app.all("/api/tenant/*", async c => {
  const session = await sessionFor(c.req.raw, c.env);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const tenantId = c.req.header("x-ordermate-tenant");
  if (!tenantId) return c.json({ error: "Select a business first" }, 400);

  const membership = await membershipFor(session.user.id, tenantId, c.env);
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
  const member = await membershipFor(session.user.id, tenantId, c.env);
  if (!member || !can(member.role, "purchasing", "create")) return c.json({ error: "Forbidden" }, 403);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "File exceeds 15 MB" }, 413);
  const purpose = String(form.get("purpose") || "document").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const key = `${tenantId}/${purpose}/${crypto.randomUUID()}-${safeName}`;
  await c.env.DOCUMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { tenantId, uploadedBy: session.user.id, purpose },
  });
  return c.json({ key, name: file.name, size: file.size }, 201);
});

app.get("/api/health", c => c.json({ ok: true, service: "ordermate" }));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, _env: Env) {
    for (const message of batch.messages) {
      try {
        console.log("Operating Layer event", message.id, message.body);
        message.ack();
      } catch (cause) {
        console.error("Queue event failed", cause);
        message.retry();
      }
    }
  },
};
