import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import baseWorker from "./index";
import { processDocumentUploaded, type DocumentUploadedEvent } from "./document-extraction";
import { documentsApp } from "./documents";
import { movementHistoryApp } from "./movement-history";
import { operationsApp } from "./operations";
import { can } from "./permissions";
import { TenantStore } from "./tenant-store-runtime";

export { TenantStore };

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
  AI: Ai;
  AI_DOCUMENT_EXTRACTION_ENABLED: string;
};

type Membership = { id: string; role: Role };
type QueueEnvelope = { type?: string; eventId?: string };

function secureApiResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "no-store");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  return secured;
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isCustomApi(pathname: string) {
  return pathname.startsWith("/api/tenant")
    || pathname.startsWith("/api/ops")
    || pathname.startsWith("/api/documents")
    || pathname.startsWith("/api/organizations")
    || pathname.startsWith("/api/invites");
}

function rejectCrossOriginMutation(request: Request, url: URL) {
  if (!isUnsafeMethod(request.method) || !isCustomApi(url.pathname)) return null;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || origin && origin !== url.origin) {
    return secureApiResponse(Response.json({ error: "Cross-origin mutation rejected" }, { status: 403 }));
  }
  return null;
}

function maskUnexpectedApiError(pathname: string, response: Response) {
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/") || response.status < 500) return response;
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}

async function enforceControlPlaneRead(request: Request, env: Env, url: URL) {
  const match = url.pathname.match(/^\/api\/organizations\/([^/]+)\/members$/);
  if (request.method !== "GET" || !match) return null;
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = decodeURIComponent(match[1]);
  const membership = await env.CONTROL_DB.prepare("SELECT id, role FROM member WHERE userId = ? AND organizationId = ?").bind(session.user.id, organizationId).first<Membership>();
  if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!can(membership.role, "members", "read")) return Response.json({ error: "Insufficient permission" }, { status: 403 });
  return null;
}

function isDocumentUploadedEvent(value: unknown): value is DocumentUploadedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.type === "document.uploaded"
    && typeof event.eventId === "string"
    && typeof event.tenantId === "string"
    && typeof event.key === "string"
    && event.purpose === "purchase-source"
    && typeof event.uploadedBy === "string"
    && typeof event.createdAt === "string";
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const crossOrigin = rejectCrossOriginMutation(request, url);
    if (crossOrigin) return crossOrigin;
    const denied = await enforceControlPlaneRead(request, env, url);
    if (denied) return secureApiResponse(denied);

    if (url.pathname === "/api/ops/movements") {
      const publicPath = url.pathname;
      url.pathname = "/";
      const response = await movementHistoryApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    if (url.pathname === "/api/ops" || url.pathname.startsWith("/api/ops/")) {
      const publicPath = url.pathname;
      url.pathname = url.pathname.replace(/^\/api\/ops/, "") || "/";
      const response = await operationsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    if (url.pathname === "/api/documents" || url.pathname.startsWith("/api/documents/")) {
      const publicPath = url.pathname;
      url.pathname = url.pathname.replace(/^\/api\/documents/, "") || "/";
      const response = await documentsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    const response = await baseWorker.fetch(request, env, ctx);
    return url.pathname.startsWith("/api/") ? secureApiResponse(maskUnexpectedApiError(url.pathname, response)) : response;
  },

  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const envelope = message.body && typeof message.body === "object" ? message.body as QueueEnvelope : {};
      try {
        if (isDocumentUploadedEvent(message.body)) {
          if (env.AI_DOCUMENT_EXTRACTION_ENABLED === "true") {
            await processDocumentUploaded(message.body, env);
          } else {
            console.log("OrderMate event skipped: AI document extraction disabled", envelope.eventId || message.id);
          }
        }
        console.log("OrderMate event processed", envelope.type || "unknown", envelope.eventId || message.id);
        message.ack();
      } catch (cause) {
        console.error("OrderMate event failed", envelope.type || "unknown", envelope.eventId || message.id, cause instanceof Error ? cause.message : "unknown error");
        message.retry();
      }
    }
  },
};
