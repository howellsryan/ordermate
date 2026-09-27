import { Hono } from "hono";
import { normalizeShopifyShopDomain } from "../shared/integration-contract";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { integrationInternalHeaders } from "./integration-runtime";
import {
  buildShopifyAuthorizationUrl,
  exchangeShopifyAuthorizationCode,
  missingShopifyScopes,
  refreshShopifyOfflineToken,
  shopifyScopes,
  tokenExpiryIso,
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
} from "./shopify-auth";
import type { TenantStore } from "./tenant-store-order-planning";

export type ShopifyIntegrationEnv = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SCOPES: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY: string;
  INTEGRATION_TOKEN_KEY_VERSION: string;
};

type Membership = { id: string; role: Role };
type OAuthStateRow = {
  tenant_id: string;
  external_account_id: string;
  created_by: string;
  expires_at: number;
  consumed_at: number | null;
};
type RouteRow = {
  tenant_id: string;
  connection_id: string;
  status: string;
};
type CredentialRead = {
  connection: {
    id: string;
    provider: "shopify";
    externalAccountId: string;
    displayName: string;
    status: string;
    capabilities: string[];
  };
  credential: {
    envelope: EncryptedCredentialEnvelope;
    scopes: string[];
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
  };
};

type StoredShopifyCredential = {
  accessToken: string;
  refreshToken: string;
};

const OAUTH_COOKIE = "ol_shopify_oauth_state";
const OAUTH_TTL_MS = 10 * 60 * 1000;
const SHOPIFY_CAPABILITIES = [
  "catalogue:import",
  "orders:import",
  "returns:import",
  "inventory:publish",
  "fulfilments:publish",
] as const;

class IntegrationHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const shopifyIntegrationApp = new Hono<{ Bindings: ShopifyIntegrationEnv }>();

function configured(env: ShopifyIntegrationEnv) {
  if (!env.SHOPIFY_CLIENT_ID?.trim()) throw new IntegrationHttpError("Shopify client ID is not configured", 503);
  if (!env.SHOPIFY_CLIENT_SECRET?.trim()) throw new IntegrationHttpError("Shopify client secret is not configured", 503);
  if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim()) throw new IntegrationHttpError("Integration token encryption key is not configured", 503);
  if (!env.INTEGRATION_TOKEN_KEY_VERSION?.trim()) throw new IntegrationHttpError("Integration token key version is not configured", 503);
  const scopes = shopifyScopes(env.SHOPIFY_SCOPES || "");
  if (!scopes.length) throw new IntegrationHttpError("Shopify scopes are not configured", 503);
  return scopes;
}

async function sessionContext(request: Request, env: ShopifyIntegrationEnv) {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new IntegrationHttpError("Unauthorized", 401);
  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) throw new IntegrationHttpError("Select a business first", 400);
  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) throw new IntegrationHttpError("Forbidden", 403);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new IntegrationHttpError("Only workspace owners and admins can manage integrations", 403);
  }
  return { session, tenantId, membership };
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function oauthCookie(state: string, maxAgeSeconds: number) {
  return `${OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/api/integrations/shopify/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

async function internalRequest(
  env: ShopifyIntegrationEnv,
  tenantId: string,
  path: string,
  init: RequestInit,
  actor: { id: string; role: string; name?: string },
) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(integrationInternalHeaders)) headers.set(key, value);
  headers.set("x-ordermate-actor-id", actor.id);
  headers.set("x-ordermate-actor-role", actor.role);
  if (actor.name) headers.set("x-ordermate-actor-name", actor.name);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const request = new Request(`https://tenant.internal${path}`, { ...init, headers });
  return env.TENANT_STORES.jurisdiction("eu").getByName(tenantId).fetch(request);
}

async function jsonOrThrow<T>(response: Response, fallback: string) {
  const payload = await response.json<T & { error?: string }>().catch(() => null);
  if (!response.ok) throw new IntegrationHttpError(payload?.error || fallback, response.status);
  return payload as T;
}

async function reserveRoute(env: ShopifyIntegrationEnv, shop: string, tenantId: string) {
  const existing = await env.CONTROL_DB.prepare(
    "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'shopify' AND external_account_id = ?",
  ).bind(shop).first<RouteRow>();
  if (existing) {
    if (existing.tenant_id !== tenantId) throw new IntegrationHttpError("That Shopify store is already connected to another workspace", 409);
    return existing.connection_id;
  }

  const connectionId = crypto.randomUUID();
  try {
    const timestamp = Date.now();
    await env.CONTROL_DB.prepare(
      `INSERT INTO integration_routes (provider, external_account_id, tenant_id, connection_id, status, created_at, updated_at)
       VALUES ('shopify', ?, ?, ?, 'connecting', ?, ?)`,
    ).bind(shop, tenantId, connectionId, timestamp, timestamp).run();
    return connectionId;
  } catch {
    const raced = await env.CONTROL_DB.prepare(
      "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'shopify' AND external_account_id = ?",
    ).bind(shop).first<RouteRow>();
    if (!raced || raced.tenant_id !== tenantId) throw new IntegrationHttpError("That Shopify store is already connected to another workspace", 409);
    return raced.connection_id;
  }
}

async function setRouteStatus(env: ShopifyIntegrationEnv, shop: string, tenantId: string, connectionId: string, status: string) {
  await env.CONTROL_DB.prepare(
    `UPDATE integration_routes SET status = ?, updated_at = ?
     WHERE provider = 'shopify' AND external_account_id = ? AND tenant_id = ? AND connection_id = ?`,
  ).bind(status, Date.now(), shop, tenantId, connectionId).run();
}

function normalizedOccurredAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

shopifyIntegrationApp.post("/install", async c => {
  try {
    const scopes = configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const body = await c.req.json<{ shop?: string }>().catch((): { shop?: string } => ({}));
    const shop = normalizeShopifyShopDomain(body.shop || "");
    const state = randomState();
    const stateHash = await sha256Hex(state);
    const timestamp = Date.now();
    const expiresAt = timestamp + OAUTH_TTL_MS;

    const existingRoute = await c.env.CONTROL_DB.prepare(
      "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'shopify' AND external_account_id = ?",
    ).bind(shop).first<RouteRow>();
    if (existingRoute && existingRoute.tenant_id !== context.tenantId) {
      throw new IntegrationHttpError("That Shopify store is already connected to another workspace", 409);
    }

    await c.env.CONTROL_DB.prepare("DELETE FROM integration_oauth_states WHERE expires_at <= ? OR consumed_at IS NOT NULL").bind(timestamp).run();
    await c.env.CONTROL_DB.prepare(
      `INSERT INTO integration_oauth_states (
         state_hash, provider, tenant_id, external_account_id, created_by, expires_at, created_at
       ) VALUES (?, 'shopify', ?, ?, ?, ?, ?)`,
    ).bind(stateHash, context.tenantId, shop, context.session.user.id, expiresAt, timestamp).run();

    const redirectUri = new URL("/api/integrations/shopify/callback", c.req.url).toString();
    const authorizationUrl = buildShopifyAuthorizationUrl({
      shop,
      clientId: c.env.SHOPIFY_CLIENT_ID,
      redirectUri,
      scopes,
      state,
    });
    c.header("Set-Cookie", oauthCookie(state, OAUTH_TTL_MS / 1000));
    return c.json({ authorizationUrl, shop, expiresAt });
  } catch (cause) {
    if (cause instanceof IntegrationHttpError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: cause instanceof Error ? cause.message : "Unable to start Shopify connection" }, 400);
  }
});

shopifyIntegrationApp.get("/callback", async c => {
  const clearCookie = oauthCookie("", 0);
  try {
    const scopes = configured(c.env);
    const url = new URL(c.req.url);
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const shopValue = url.searchParams.get("shop") || "";
    if (!state || !code || !shopValue) throw new IntegrationHttpError("Shopify callback is missing required parameters", 400);
    if (cookieValue(c.req.raw, OAUTH_COOKIE) !== state) throw new IntegrationHttpError("Invalid Shopify OAuth state", 403);
    if (!await verifyShopifyOAuthHmac(url, c.env.SHOPIFY_CLIENT_SECRET)) throw new IntegrationHttpError("Invalid Shopify OAuth signature", 403);
    const shop = normalizeShopifyShopDomain(shopValue);
    const stateHash = await sha256Hex(state);
    const stateRow = await c.env.CONTROL_DB.prepare(
      `SELECT tenant_id, external_account_id, created_by, expires_at, consumed_at
       FROM integration_oauth_states WHERE state_hash = ? AND provider = 'shopify'`,
    ).bind(stateHash).first<OAuthStateRow>();
    if (!stateRow || stateRow.consumed_at || stateRow.expires_at <= Date.now()) throw new IntegrationHttpError("Shopify OAuth state expired or already used", 410);
    if (stateRow.external_account_id !== shop) throw new IntegrationHttpError("Shopify callback store does not match the requested connection", 403);

    const membership = await c.env.CONTROL_DB.prepare(
      "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
    ).bind(stateRow.created_by, stateRow.tenant_id).first<Membership>();
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new IntegrationHttpError("The user who started this connection can no longer manage the workspace", 403);
    }

    const consumed = await c.env.CONTROL_DB.prepare(
      "UPDATE integration_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).bind(Date.now(), stateHash, Date.now()).run();
    if (!consumed.meta.changes) throw new IntegrationHttpError("Shopify OAuth state expired or already used", 410);

    const connectionId = await reserveRoute(c.env, shop, stateRow.tenant_id);
    const tokens = await exchangeShopifyAuthorizationCode({
      shop,
      clientId: c.env.SHOPIFY_CLIENT_ID,
      clientSecret: c.env.SHOPIFY_CLIENT_SECRET,
      code,
    });
    const missing = missingShopifyScopes(scopes, tokens.scope);
    if (missing.length) {
      await setRouteStatus(c.env, shop, stateRow.tenant_id, connectionId, "attention_required");
      throw new IntegrationHttpError(`Shopify did not grant required scopes: ${missing.join(", ")}`, 409);
    }

    const envelope = await encryptCredentialPayload({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }, c.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, c.env.INTEGRATION_TOKEN_KEY_VERSION);
    const tokenIssuedAt = Date.now();
    const response = await internalRequest(c.env, stateRow.tenant_id, "/__integrations/connections/upsert", {
      method: "POST",
      body: JSON.stringify({
        id: connectionId,
        provider: "shopify",
        externalAccountId: shop,
        displayName: shop,
        status: "active",
        capabilities: [...SHOPIFY_CAPABILITIES],
        credential: {
          envelope,
          scopes: tokens.scope,
          accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, tokenIssuedAt),
          refreshTokenExpiresAt: tokenExpiryIso(tokens.refreshTokenExpiresIn, tokenIssuedAt),
        },
      }),
    }, { id: stateRow.created_by, role: membership.role });
    await jsonOrThrow<{ ok: true }>(response, "Unable to persist Shopify connection");
    await setRouteStatus(c.env, shop, stateRow.tenant_id, connectionId, "active");

    const target = new URL("/", c.req.url);
    target.searchParams.set("integration", "shopify");
    target.searchParams.set("status", "connected");
    const redirect = Response.redirect(target.toString(), 303);
    redirect.headers.set("Set-Cookie", clearCookie);
    return redirect;
  } catch (cause) {
    const status = cause instanceof IntegrationHttpError ? cause.status : 500;
    const message = cause instanceof Error ? cause.message : "Unable to connect Shopify";
    return new Response(JSON.stringify({ error: status >= 500 ? "Unable to connect Shopify" : message }), {
      status,
      headers: { "Content-Type": "application/json", "Set-Cookie": clearCookie },
    });
  }
});

shopifyIntegrationApp.post("/refresh", async c => {
  try {
    configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const body = await c.req.json<{ connectionId?: string }>().catch((): { connectionId?: string } => ({}));
    if (!body.connectionId) throw new IntegrationHttpError("connectionId is required", 400);

    const credentialResponse = await internalRequest(
      c.env,
      context.tenantId,
      `/__integrations/credentials/${encodeURIComponent(body.connectionId)}`,
      { method: "GET" },
      { id: context.session.user.id, role: context.membership.role, name: context.session.user.name },
    );
    const stored = await jsonOrThrow<CredentialRead>(credentialResponse, "Unable to read integration credentials");
    if (stored.connection.provider !== "shopify") throw new IntegrationHttpError("Connection is not a Shopify integration", 409);

    const secrets = await decryptCredentialPayload<StoredShopifyCredential>(
      stored.credential.envelope,
      c.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
      c.env.INTEGRATION_TOKEN_KEY_VERSION,
    );
    if (!secrets.refreshToken) throw new IntegrationHttpError("Shopify refresh token is unavailable; reconnect the store", 409);

    const tokens = await refreshShopifyOfflineToken({
      shop: stored.connection.externalAccountId,
      clientId: c.env.SHOPIFY_CLIENT_ID,
      clientSecret: c.env.SHOPIFY_CLIENT_SECRET,
      refreshToken: secrets.refreshToken,
    });
    const requestedScopes = shopifyScopes(c.env.SHOPIFY_SCOPES || "");
    const missing = missingShopifyScopes(requestedScopes, tokens.scope);
    if (missing.length) throw new IntegrationHttpError(`Shopify no longer grants required scopes: ${missing.join(", ")}`, 409);

    const envelope = await encryptCredentialPayload({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }, c.env.INTEGRATION_TOKEN_ENCRYPTION_KEY, c.env.INTEGRATION_TOKEN_KEY_VERSION);
    const issuedAt = Date.now();
    const updateResponse = await internalRequest(c.env, context.tenantId, "/__integrations/connections/upsert", {
      method: "POST",
      body: JSON.stringify({
        id: stored.connection.id,
        provider: "shopify",
        externalAccountId: stored.connection.externalAccountId,
        displayName: stored.connection.displayName,
        status: "active",
        capabilities: stored.connection.capabilities,
        credential: {
          envelope,
          scopes: tokens.scope,
          accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, issuedAt),
          refreshTokenExpiresAt: tokenExpiryIso(tokens.refreshTokenExpiresIn, issuedAt),
        },
      }),
    }, { id: context.session.user.id, role: context.membership.role, name: context.session.user.name });
    await jsonOrThrow<{ ok: true }>(updateResponse, "Unable to rotate Shopify credentials");
    await setRouteStatus(c.env, stored.connection.externalAccountId, context.tenantId, stored.connection.id, "active");
    return c.json({
      ok: true,
      connectionId: stored.connection.id,
      accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, issuedAt),
      refreshTokenExpiresAt: tokenExpiryIso(tokens.refreshTokenExpiresIn, issuedAt),
    });
  } catch (cause) {
    if (cause instanceof IntegrationHttpError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: "Unable to refresh Shopify connection" }, 502);
  }
});

shopifyIntegrationApp.post("/webhooks", async c => {
  try {
    configured(c.env);
    const contentLength = Number(c.req.header("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) throw new IntegrationHttpError("Webhook payload exceeds 2 MB", 413);
    const rawBody = await c.req.raw.arrayBuffer();
    if (rawBody.byteLength > 2_000_000) throw new IntegrationHttpError("Webhook payload exceeds 2 MB", 413);
    if (!await verifyShopifyWebhookHmac(rawBody, c.req.header("x-shopify-hmac-sha256") || null, c.env.SHOPIFY_CLIENT_SECRET)) {
      throw new IntegrationHttpError("Invalid Shopify webhook signature", 401);
    }

    const shop = normalizeShopifyShopDomain(c.req.header("x-shopify-shop-domain") || "");
    const providerEventId = (c.req.header("x-shopify-webhook-id") || "").trim();
    const providerActionId = (c.req.header("x-shopify-event-id") || "").trim() || null;
    const topic = (c.req.header("x-shopify-topic") || "").trim();
    if (!providerEventId || !topic) throw new IntegrationHttpError("Shopify webhook is missing its delivery identity or topic", 400);
    const payloadJson = new TextDecoder().decode(rawBody);
    try {
      JSON.parse(payloadJson);
    } catch {
      throw new IntegrationHttpError("Shopify webhook payload is not valid JSON", 400);
    }

    const route = await c.env.CONTROL_DB.prepare(
      `SELECT tenant_id, connection_id, status FROM integration_routes
       WHERE provider = 'shopify' AND external_account_id = ?`,
    ).bind(shop).first<RouteRow>();
    if (!route || route.status !== "active") throw new IntegrationHttpError("Shopify connection route is not active", 404);

    const response = await internalRequest(c.env, route.tenant_id, "/__integrations/events/receive", {
      method: "POST",
      body: JSON.stringify({
        connectionId: route.connection_id,
        provider: "shopify",
        providerEventId,
        providerActionId,
        topic,
        externalAccountId: shop,
        occurredAt: normalizedOccurredAt(c.req.header("x-shopify-triggered-at") || null),
        apiVersion: c.req.header("x-shopify-api-version") || null,
        payloadJson,
      }),
    }, { id: `integration:shopify:${shop}`, role: "integration" });
    const receipt = await jsonOrThrow<{ id: string; duplicate: boolean }>(response, "Unable to record Shopify webhook");
    return c.json({ ok: true, eventId: receipt.id, duplicate: receipt.duplicate });
  } catch (cause) {
    if (cause instanceof IntegrationHttpError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: "Unable to receive Shopify webhook" }, 500);
  }
});
