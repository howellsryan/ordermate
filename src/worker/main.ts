import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import baseWorker from "./index";
import { documentsApp } from "./documents";
import { operationsApp } from "./operations";
import { can } from "./permissions";
import { TenantStore } from "./tenant-store";

export { TenantStore };

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
};

type Membership = { id: string; role: Role };

function secureApiResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "no-store");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  return secured;
}

async function enforceControlPlaneRead(request: Request, env: Env, url: URL) {
  const match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/members$/);
  if (request.method !== "GET" || !match) return null;

  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = decodeURIComponent(match[1]);
  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, organizationId).first<Membership>();
  if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!can(membership.role, "members", "read")) return Response.json({ error: "Insufficient permission" }, { status: 403 });
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    const denied = await enforceControlPlaneRead(request, env, url);
    if (denied) return secureApiResponse(denied);

    if (url.pathname === "/api/ops" || url.pathname.startsWith("/api/ops/")) {
      url.pathname = url.pathname.replace(/^\/api\/ops/, "") || "/";
      const response = await operationsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(response);
    }

    if (url.pathname === "/api/documents" || url.pathname.startsWith("/api/documents/")) {
      url.pathname = url.pathname.replace(/^\/api\/documents/, "") || "/";
      const response = await documentsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(response);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch, env: Env) {
    return baseWorker.queue(batch, env);
  },
};
