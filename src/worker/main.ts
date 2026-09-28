import { normalizeShopifyShopDomain } from "../shared/integration-contract";
import type { WorkspaceFeatureKey } from "../shared/features";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import baseWorker from "./index";
import { processDocumentUploaded, type DocumentUploadedEvent } from "./document-extraction";
import { processDeliveryNoteUploaded, type DeliveryNoteUploadedEvent } from "./delivery-note-extraction";
import { documentsApp } from "./documents";
import { deliveryDocumentsApp } from "./delivery-documents";
import { movementHistoryApp } from "./movement-history";
import { operationsApp } from "./operations";
import { operationsAssistantApp } from "./operations-assistant";
import { can } from "./permissions";
import { shopifyCatalogueApp, type ShopifyCatalogueEnv } from "./shopify-catalogue";
import { shopifyIntegrationApp, type ShopifyIntegrationEnv } from "./shopify-integration";
import {
  isShopifyOrderReceivedEvent,
  processShopifyOrderReceived,
  shopifyOrderGidFromWebhookPayload,
  type ShopifyOrderProcessingEnv,
  type ShopifyOrderReceivedEvent,
} from "./shopify-orders";
import { TenantStore } from "./tenant-store-order-planning";
import { workspaceFeatureEnabled } from "./workspace-feature-access";

export { TenantStore };

type Env = AuthEnv & ShopifyIntegrationEnv & ShopifyCatalogueEnv & ShopifyOrderProcessingEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  DOCUMENTS: R2Bucket;
  EVENTS_QUEUE: Queue;
  AI: Ai;
  AI_DOCUMENT_EXTRACTION_ENABLED: string;
  AI_OPERATIONS_ASSISTANT_ENABLED: string;
  APP_ENV: string;
};

type Membership = { id: string; role: Role };
type QueueEnvelope = { type?: string; eventId?: string };
type ShopifyRouteRow = { tenant_id: string; connection_id: string; status: string };

const SHOPIFY_ORDER_TOPICS = new Set<ShopifyOrderReceivedEvent["topic"]>(["orders/create", "orders/updated", "orders/cancelled"]);

function secureApiResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("Cache-Control", "no-store");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  return secured;
}

function stagingSafePage(response: Response, env: Env) {
  if (env.APP_ENV !== "staging") return response;
  const safe = new Response(response.body, response);
  safe.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  safe.headers.set("Cache-Control", "no-store");
  return safe;
}

function robotsResponse(url: URL, env: Env) {
  const staging = env.APP_ENV === "staging";
  const body = staging
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": staging ? "no-store" : "public, max-age=3600",
      ...(staging ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
    },
  });
}

function sitemapResponse(url: URL, env: Env) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${url.origin}/</loc>\n    <lastmod>2026-09-26</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
  const staging = env.APP_ENV === "staging";
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": staging ? "no-store" : "public, max-age=3600",
      ...(staging ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
    },
  });
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isCustomApi(pathname: string) {
  return pathname.startsWith("/api/tenant")
    || pathname.startsWith("/api/ops")
    || pathname.startsWith("/api/documents")
    || pathname.startsWith("/api/delivery-documents")
    || pathname.startsWith("/api/integrations")
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

async function enforceRoutedWorkspaceFeature(request: Request, env: Env, key: WorkspaceFeatureKey, label: string) {
  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) return null;
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const membership = await env.CONTROL_DB.prepare("SELECT id, role FROM member WHERE userId = ? AND organizationId = ?")
    .bind(session.user.id, tenantId)
    .first<Membership>();
  if (!membership) return null;
  const stub = env.TENANT_STORES.jurisdiction("eu").getByName(tenantId);
  const enabled = await workspaceFeatureEnabled(stub, key, { id: session.user.id, role: membership.role, name: session.user.name });
  return enabled ? null : Response.json({ error: `${label} is disabled or unavailable for this workspace.` }, { status: 404 });
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

function isDeliveryNoteUploadedEvent(value: unknown): value is DeliveryNoteUploadedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.type === "delivery_note.uploaded"
    && typeof event.eventId === "string"
    && typeof event.tenantId === "string"
    && typeof event.key === "string"
    && event.purpose === "delivery-source"
    && typeof event.purchaseOrderId === "string"
    && typeof event.uploadedBy === "string"
    && typeof event.createdAt === "string";
}

async function queueShopifyOrderReceipt(request: Request, response: Response, env: Env) {
  const topic = request.headers.get("x-shopify-topic") as ShopifyOrderReceivedEvent["topic"] | null;
  if (!topic || !SHOPIFY_ORDER_TOPICS.has(topic)) return;
  const receipt = await response.clone().json<{ eventId?: string }>().catch(() => ({}));
  if (!receipt.eventId) throw new Error("Shopify webhook receipt did not return an event ID");
  const rawShop = request.headers.get("x-shopify-shop-domain") || "";
  const shop = normalizeShopifyShopDomain(rawShop);
  const route = await env.CONTROL_DB.prepare(
    "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'shopify' AND external_account_id = ?",
  ).bind(shop).first<ShopifyRouteRow>();
  if (!route || route.status !== "active") throw new Error("Shopify route became unavailable after webhook receipt");
  const payload = await request.json<Record<string, unknown>>().catch(() => ({}));
  const queued: ShopifyOrderReceivedEvent = {
    type: "shopify.order.received",
    eventId: receipt.eventId,
    tenantId: route.tenant_id,
    connectionId: route.connection_id,
    shop,
    topic,
    orderGid: shopifyOrderGidFromWebhookPayload(payload),
  };
  await env.EVENTS_QUEUE.send(queued);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/robots.txt") return robotsResponse(url, env);
    if (request.method === "GET" && url.pathname === "/sitemap.xml") return sitemapResponse(url, env);

    const crossOrigin = rejectCrossOriginMutation(request, url);
    if (crossOrigin) return crossOrigin;
    const denied = await enforceControlPlaneRead(request, env, url);
    if (denied) return secureApiResponse(denied);

    if (url.pathname === "/api/integrations/shopify/catalogue" || url.pathname.startsWith("/api/integrations/shopify/catalogue/")) {
      const publicPath = url.pathname;
      url.pathname = url.pathname.replace(/^\/api\/integrations\/shopify\/catalogue/, "") || "/";
      const response = await shopifyCatalogueApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    if (url.pathname === "/api/integrations/shopify" || url.pathname.startsWith("/api/integrations/shopify/")) {
      const publicPath = url.pathname;
      const webhookSnapshot = publicPath === "/api/integrations/shopify/webhooks" ? request.clone() : null;
      url.pathname = url.pathname.replace(/^\/api\/integrations\/shopify/, "") || "/";
      const response = await shopifyIntegrationApp.fetch(new Request(url, request), env, ctx);
      if (webhookSnapshot && response.ok) {
        try {
          await queueShopifyOrderReceipt(webhookSnapshot, response, env);
        } catch (cause) {
          console.error("Operating Layer Shopify order enqueue failed", cause instanceof Error ? cause.message : "unknown error");
          return secureApiResponse(Response.json({ error: "Unable to enqueue Shopify order processing" }, { status: 503 }));
        }
      }
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    if (url.pathname === "/api/ops/assistant") {
      const publicPath = url.pathname;
      url.pathname = "/";
      const response = await operationsAssistantApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
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
    if (url.pathname === "/api/delivery-documents" || url.pathname.startsWith("/api/delivery-documents/")) {
      const publicPath = url.pathname;
      const featureDenied = await enforceRoutedWorkspaceFeature(request, env, "document_assist", "Document assist");
      if (featureDenied) return secureApiResponse(featureDenied);
      url.pathname = url.pathname.replace(/^\/api\/delivery-documents/, "") || "/";
      const response = await deliveryDocumentsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    if (url.pathname === "/api/documents" || url.pathname.startsWith("/api/documents/")) {
      const publicPath = url.pathname;
      url.pathname = url.pathname.replace(/^\/api\/documents/, "") || "/";
      const response = await documentsApp.fetch(new Request(url, request), env, ctx);
      return secureApiResponse(maskUnexpectedApiError(publicPath, response));
    }
    const response = await baseWorker.fetch(request, env, ctx);
    if (url.pathname.startsWith("/api/")) return secureApiResponse(maskUnexpectedApiError(url.pathname, response));
    return stagingSafePage(response, env);
  },

  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const envelope = message.body && typeof message.body === "object" ? message.body as QueueEnvelope : {};
      try {
        if (isDocumentUploadedEvent(message.body)) {
          if (env.AI_DOCUMENT_EXTRACTION_ENABLED === "true") {
            await processDocumentUploaded(message.body, env);
          } else {
            console.log("Operating Layer event skipped: AI document extraction disabled", envelope.eventId || message.id);
          }
        } else if (isDeliveryNoteUploadedEvent(message.body)) {
          if (env.AI_DOCUMENT_EXTRACTION_ENABLED === "true") {
            await processDeliveryNoteUploaded(message.body, env);
          } else {
            console.log("Operating Layer event skipped: AI delivery-note extraction disabled", envelope.eventId || message.id);
          }
        } else if (isShopifyOrderReceivedEvent(message.body)) {
          const result = await processShopifyOrderReceived(message.body, env);
          if (result.retryDelivery) throw new Error(result.error || `Shopify order event ${message.body.eventId} requested retry`);
        } else {
          throw new Error(`Unsupported queue event type: ${envelope.type || "unknown"}`);
        }
        console.log("Operating Layer event processed", envelope.type || "unknown", envelope.eventId || message.id);
        message.ack();
      } catch (cause) {
        console.error("Operating Layer event failed", envelope.type || "unknown", envelope.eventId || message.id, cause instanceof Error ? cause.message : "unknown error");
        message.retry();
      }
    }
  },
};
