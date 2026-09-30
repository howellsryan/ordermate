import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { integrationInternalHeaders } from "./integration-runtime";
import type { TenantStore } from "./tenant-store-order-planning";
import {
  buildXeroAuthorizationUrl,
  exchangeXeroAuthorizationCode,
  fetchXeroConnections,
  refreshTokenExpiryIso,
  refreshXeroToken,
  resolveXeroConnection,
  tokenExpiryIso,
  xeroScopes,
} from "./xero-auth";

export type XeroIntegrationEnv = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  XERO_CLIENT_ID: string;
  XERO_CLIENT_SECRET: string;
  XERO_SCOPES: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY: string;
  INTEGRATION_TOKEN_KEY_VERSION: string;
};

type Membership = { id: string; role: Role };
type OAuthStateRow = {
  tenant_id: string;
  created_by: string;
  expires_at: number;
  consumed_at: number | null;
};
type RouteRow = { tenant_id: string; connection_id: string; status: string };
type CredentialRead = {
  connection: {
    id: string;
    provider: "xero";
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
type StoredXeroCredential = { accessToken: string; refreshToken: string };

const OAUTH_COOKIE = "ol_xero_oauth_state";
const OAUTH_TTL_MS = 10 * 60 * 1000;

class XeroIntegrationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const xeroIntegrationApp = new Hono<{ Bindings: XeroIntegrationEnv }>();

function configured(env: XeroIntegrationEnv) {
  if (!env.XERO_CLIENT_ID?.trim()) throw new XeroIntegrationError("Xero client ID is not configured", 503);
  if (!env.XERO_CLIENT_SECRET?.trim()) throw new XeroIntegrationError("Xero client secret is not configured", 503);
  if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim()) throw new XeroIntegrationError("Integration token encryption key is not configured", 503);
  if (!env.INTEGRATION_TOKEN_KEY_VERSION?.trim()) throw new XeroIntegrationError("Integration token key version is not configured", 503);
  const scopes = xeroScopes(env.XERO_SCOPES || "");
  if (!scopes.includes("offline_access")) throw new XeroIntegrationError("Xero scopes must include offline_access", 503);
  if (!scopes.some(scope => scope.startsWith("accounting."))) throw new XeroIntegrationError("Xero requires at least one accounting scope", 503);
  return scopes;
}

function capabilities(scopes: string[]) {
  const values = new Set(scopes);
  const result: string[] = [];
  if (values.has("accounting.contacts") || values.has("accounting.contacts.read")) result.push("contacts:export");
  if (values.has("accounting.invoices") || values.has("accounting.transactions")) result.push("sales:export", "purchases:export");
  if (values.has("accounting.payments") || values.has("accounting.transactions")) result.push("payments:import");
  return [...new Set(result)];
}

async function sessionContext(request: Request, env: XeroIntegrationEnv) {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new XeroIntegrationError("Unauthorized", 401);
  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) throw new XeroIntegrationError("Select a business first", 400);
  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) throw new XeroIntegrationError("Forbidden", 403);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new XeroIntegrationError("Only workspace owners and admins can manage integrations", 403);
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
  return `${OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/api/integrations/xero/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

async function internalRequest(
  env: XeroIntegrationEnv,
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
  return env.TENANT_STORES.jurisdiction("eu").getByName(tenantId).fetch(new Request(`https://tenant.internal${path}`, { ...init, headers }));
}

async function jsonOrThrow<T>(response: Response, fallback: string) {
  const payload = await response.json<T & { error?: string }>().catch(() => null);
  if (!response.ok) throw new XeroIntegrationError(payload?.error || fallback, response.status);
  return payload as T;
}

async function reserveRoute(env: XeroIntegrationEnv, tenantId: string, xeroTenantId: string) {
  const existing = await env.CONTROL_DB.prepare(
    "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'xero' AND external_account_id = ?",
  ).bind(xeroTenantId).first<RouteRow>();
  if (existing) {
    if (existing.tenant_id !== tenantId) throw new XeroIntegrationError("That Xero organisation is already connected to another workspace", 409);
    return existing.connection_id;
  }
  const connectionId = crypto.randomUUID();
  try {
    const timestamp = Date.now();
    await env.CONTROL_DB.prepare(
      `INSERT INTO integration_routes (provider, external_account_id, tenant_id, connection_id, status, created_at, updated_at)
       VALUES ('xero', ?, ?, ?, 'connecting', ?, ?)`,
    ).bind(xeroTenantId, tenantId, connectionId, timestamp, timestamp).run();
    return connectionId;
  } catch {
    const raced = await env.CONTROL_DB.prepare(
      "SELECT tenant_id, connection_id, status FROM integration_routes WHERE provider = 'xero' AND external_account_id = ?",
    ).bind(xeroTenantId).first<RouteRow>();
    if (!raced || raced.tenant_id !== tenantId) throw new XeroIntegrationError("That Xero organisation is already connected to another workspace", 409);
    return raced.connection_id;
  }
}

async function setRouteStatus(env: XeroIntegrationEnv, tenantId: string, xeroTenantId: string, connectionId: string, status: string) {
  await env.CONTROL_DB.prepare(
    `UPDATE integration_routes SET status = ?, updated_at = ?
     WHERE provider = 'xero' AND external_account_id = ? AND tenant_id = ? AND connection_id = ?`,
  ).bind(status, Date.now(), xeroTenantId, tenantId, connectionId).run();
}

async function loadCredential(env: XeroIntegrationEnv, context: Awaited<ReturnType<typeof sessionContext>>, connectionId: string) {
  const actor = { id: context.session.user.id, role: context.membership.role, name: context.session.user.name };
  const response = await internalRequest(env, context.tenantId, `/__integrations/credentials/${encodeURIComponent(connectionId)}`, { method: "GET" }, actor);
  const stored = await jsonOrThrow<CredentialRead>(response, "Unable to read Xero credentials");
  if (stored.connection.provider !== "xero") throw new XeroIntegrationError("Connection is not a Xero integration", 409);
  const secrets = await decryptCredentialPayload<StoredXeroCredential>(
    stored.credential.envelope,
    env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    env.INTEGRATION_TOKEN_KEY_VERSION,
  );
  if (!secrets.accessToken || !secrets.refreshToken) throw new XeroIntegrationError("Xero credentials are incomplete; reconnect Xero", 409);
  return { stored, secrets, actor };
}

async function persistTokens(
  env: XeroIntegrationEnv,
  tenantId: string,
  stored: CredentialRead["connection"],
  tokens: Awaited<ReturnType<typeof refreshXeroToken>>,
  actor: { id: string; role: string; name?: string },
) {
  const envelope = await encryptCredentialPayload(
    { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    env.INTEGRATION_TOKEN_KEY_VERSION,
  );
  const issuedAt = Date.now();
  const response = await internalRequest(env, tenantId, "/__integrations/connections/upsert", {
    method: "POST",
    body: JSON.stringify({
      id: stored.id,
      provider: "xero",
      externalAccountId: stored.externalAccountId,
      displayName: stored.displayName,
      status: "active",
      capabilities: capabilities(tokens.scope.length ? tokens.scope : stored.capabilities),
      credential: {
        envelope,
        scopes: tokens.scope,
        accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, issuedAt),
        refreshTokenExpiresAt: refreshTokenExpiryIso(issuedAt),
      },
    }),
  }, actor);
  await jsonOrThrow<{ ok: true }>(response, "Unable to persist Xero credentials");
  return { envelope, issuedAt };
}

xeroIntegrationApp.post("/install", async c => {
  try {
    const scopes = configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const state = randomState();
    const stateHash = await sha256Hex(state);
    const timestamp = Date.now();
    const expiresAt = timestamp + OAUTH_TTL_MS;
    await c.env.CONTROL_DB.prepare("DELETE FROM integration_oauth_states WHERE expires_at <= ? OR consumed_at IS NOT NULL").bind(timestamp).run();
    await c.env.CONTROL_DB.prepare(
      `INSERT INTO integration_oauth_states (
         state_hash, provider, tenant_id, external_account_id, created_by, expires_at, created_at
       ) VALUES (?, 'xero', ?, 'pending', ?, ?, ?)`,
    ).bind(stateHash, context.tenantId, context.session.user.id, expiresAt, timestamp).run();
    const redirectUri = new URL("/api/integrations/xero/callback", c.req.url).toString();
    const authorizationUrl = buildXeroAuthorizationUrl({
      clientId: c.env.XERO_CLIENT_ID,
      redirectUri,
      scopes,
      state,
    });
    c.header("Set-Cookie", oauthCookie(state, OAUTH_TTL_MS / 1000));
    return c.json({ authorizationUrl, expiresAt });
  } catch (cause) {
    if (cause instanceof XeroIntegrationError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: cause instanceof Error ? cause.message : "Unable to start Xero connection" }, 400);
  }
});

xeroIntegrationApp.get("/callback", async c => {
  const clearCookie = oauthCookie("", 0);
  try {
    configured(c.env);
    const url = new URL(c.req.url);
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const providerError = url.searchParams.get("error");
    if (providerError) throw new XeroIntegrationError(url.searchParams.get("error_description") || `Xero authorization failed: ${providerError}`, 400);
    if (!state || !code) throw new XeroIntegrationError("Xero callback is missing required parameters", 400);
    if (cookieValue(c.req.raw, OAUTH_COOKIE) !== state) throw new XeroIntegrationError("Invalid Xero OAuth state", 403);
    const stateHash = await sha256Hex(state);
    const stateRow = await c.env.CONTROL_DB.prepare(
      `SELECT tenant_id, created_by, expires_at, consumed_at
       FROM integration_oauth_states WHERE state_hash = ? AND provider = 'xero'`,
    ).bind(stateHash).first<OAuthStateRow>();
    if (!stateRow || stateRow.consumed_at || stateRow.expires_at <= Date.now()) throw new XeroIntegrationError("Xero OAuth state expired or already used", 410);
    const membership = await c.env.CONTROL_DB.prepare(
      "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
    ).bind(stateRow.created_by, stateRow.tenant_id).first<Membership>();
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new XeroIntegrationError("The user who started this connection can no longer manage the workspace", 403);
    }
    const consumed = await c.env.CONTROL_DB.prepare(
      "UPDATE integration_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).bind(Date.now(), stateHash, Date.now()).run();
    if (!consumed.meta.changes) throw new XeroIntegrationError("Xero OAuth state expired or already used", 410);

    const redirectUri = new URL("/api/integrations/xero/callback", c.req.url).toString();
    const tokens = await exchangeXeroAuthorizationCode({
      clientId: c.env.XERO_CLIENT_ID,
      clientSecret: c.env.XERO_CLIENT_SECRET,
      code,
      redirectUri,
    });
    if (!tokens.scope.includes("offline_access")) throw new XeroIntegrationError("Xero did not grant offline_access; reconnect and approve background access", 409);
    const connections = await fetchXeroConnections(tokens.accessToken);
    const xero = resolveXeroConnection(connections, tokens.authenticationEventId);
    const connectionId = await reserveRoute(c.env, stateRow.tenant_id, xero.tenantId);
    const envelope = await encryptCredentialPayload(
      { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      c.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
      c.env.INTEGRATION_TOKEN_KEY_VERSION,
    );
    const issuedAt = Date.now();
    const actor = { id: stateRow.created_by, role: membership.role };
    const response = await internalRequest(c.env, stateRow.tenant_id, "/__integrations/connections/upsert", {
      method: "POST",
      body: JSON.stringify({
        id: connectionId,
        provider: "xero",
        externalAccountId: xero.tenantId,
        displayName: xero.tenantName,
        status: "active",
        capabilities: capabilities(tokens.scope),
        credential: {
          envelope,
          scopes: tokens.scope,
          accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, issuedAt),
          refreshTokenExpiresAt: refreshTokenExpiryIso(issuedAt),
        },
      }),
    }, actor);
    await jsonOrThrow<{ ok: true }>(response, "Unable to persist Xero connection");
    await setRouteStatus(c.env, stateRow.tenant_id, xero.tenantId, connectionId, "active");

    const target = new URL("/", c.req.url);
    target.searchParams.set("integration", "xero");
    target.searchParams.set("status", "connected");
    return new Response(null, {
      status: 303,
      headers: { Location: target.toString(), "Set-Cookie": clearCookie },
    });
  } catch (cause) {
    const status = cause instanceof XeroIntegrationError ? cause.status : 500;
    const message = cause instanceof Error ? cause.message : "Unable to connect Xero";
    return new Response(JSON.stringify({ error: status >= 500 ? "Unable to connect Xero" : message }), {
      status,
      headers: { "Content-Type": "application/json", "Set-Cookie": clearCookie },
    });
  }
});

xeroIntegrationApp.post("/refresh", async c => {
  try {
    configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const body = await c.req.json<{ connectionId?: string }>().catch((): { connectionId?: string } => ({}));
    if (!body.connectionId) throw new XeroIntegrationError("connectionId is required", 400);
    const { stored, secrets, actor } = await loadCredential(c.env, context, body.connectionId);
    const tokens = await refreshXeroToken({
      clientId: c.env.XERO_CLIENT_ID,
      clientSecret: c.env.XERO_CLIENT_SECRET,
      refreshToken: secrets.refreshToken,
    });
    await persistTokens(c.env, context.tenantId, stored.connection, tokens, actor);
    await setRouteStatus(c.env, context.tenantId, stored.connection.externalAccountId, stored.connection.id, "active");
    return c.json({
      ok: true,
      connectionId: stored.connection.id,
      accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn),
      refreshTokenExpiresAt: refreshTokenExpiryIso(),
      capabilities: capabilities(tokens.scope),
    });
  } catch (cause) {
    if (cause instanceof XeroIntegrationError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: "Unable to refresh Xero connection" }, 502);
  }
});

xeroIntegrationApp.post("/health", async c => {
  try {
    configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const body = await c.req.json<{ connectionId?: string }>().catch((): { connectionId?: string } => ({}));
    if (!body.connectionId) throw new XeroIntegrationError("connectionId is required", 400);
    const { stored, secrets } = await loadCredential(c.env, context, body.connectionId);
    let accessToken = secrets.accessToken;
    let scopes = stored.credential.scopes;
    if (new Date(stored.credential.accessTokenExpiresAt).getTime() <= Date.now() + 60_000) {
      const tokens = await refreshXeroToken({
        clientId: c.env.XERO_CLIENT_ID,
        clientSecret: c.env.XERO_CLIENT_SECRET,
        refreshToken: secrets.refreshToken,
      });
      await persistTokens(c.env, context.tenantId, stored.connection, tokens, { id: context.session.user.id, role: context.membership.role, name: context.session.user.name });
      accessToken = tokens.accessToken;
      scopes = tokens.scope;
    }
    const connections = await fetchXeroConnections(accessToken);
    const connection = connections.find(candidate => candidate.tenantId === stored.connection.externalAccountId);
    if (!connection) throw new XeroIntegrationError("Xero organisation is no longer connected; reconnect Xero", 409);
    return c.json({
      ok: true,
      connectionId: stored.connection.id,
      tenantId: connection.tenantId,
      tenantName: connection.tenantName,
      tenantType: connection.tenantType,
      updatedDateUtc: connection.updatedDateUtc,
      scopes,
      capabilities: capabilities(scopes),
    });
  } catch (cause) {
    if (cause instanceof XeroIntegrationError) return c.json({ error: cause.message }, cause.status as 400);
    return c.json({ error: "Unable to verify Xero connection" }, 502);
  }
});
