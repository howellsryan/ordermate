import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { integrationInternalHeaders } from "./integration-runtime";
import { missingShopifyScopes, refreshShopifyOfflineToken, shopifyScopes, tokenExpiryIso } from "./shopify-auth";
import type { TenantStore } from "./tenant-store-order-planning";

export type ShopifyCatalogueEnv = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SCOPES: string;
  SHOPIFY_API_VERSION: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY: string;
  INTEGRATION_TOKEN_KEY_VERSION: string;
};

type Membership = { id: string; role: Role };
type StoredCredential = {
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
type ShopifySecrets = { accessToken: string; refreshToken: string };
type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type GraphqlEnvelope<T> = { data?: T; errors?: Array<{ message?: string }> };

type VariantNode = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  updatedAt: string;
  product: { id: string; title: string; status: string };
};
type LocationNode = {
  id: string;
  name: string;
  deactivatedAt: string | null;
  address: { formatted: string[] } | null;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 250;

class ShopifyCatalogueError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export const shopifyCatalogueApp = new Hono<{ Bindings: ShopifyCatalogueEnv }>();

function configured(env: ShopifyCatalogueEnv) {
  if (!env.SHOPIFY_CLIENT_ID?.trim()) throw new ShopifyCatalogueError("Shopify client ID is not configured", 503);
  if (!env.SHOPIFY_CLIENT_SECRET?.trim()) throw new ShopifyCatalogueError("Shopify client secret is not configured", 503);
  if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim()) throw new ShopifyCatalogueError("Integration token encryption key is not configured", 503);
  if (!env.INTEGRATION_TOKEN_KEY_VERSION?.trim()) throw new ShopifyCatalogueError("Integration token key version is not configured", 503);
  if (!/^\d{4}-\d{2}$/.test(env.SHOPIFY_API_VERSION || "")) throw new ShopifyCatalogueError("Shopify API version is not configured", 503);
  return shopifyScopes(env.SHOPIFY_SCOPES || "");
}

async function sessionContext(request: Request, env: ShopifyCatalogueEnv) {
  const auth = createAuth(env, request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ShopifyCatalogueError("Unauthorized", 401);
  const tenantId = request.headers.get("x-ordermate-tenant");
  if (!tenantId) throw new ShopifyCatalogueError("Select a business first", 400);
  const membership = await env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) throw new ShopifyCatalogueError("Forbidden", 403);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ShopifyCatalogueError("Only workspace owners and admins can sync integrations", 403);
  }
  return { session, tenantId, membership };
}

async function tenantRequest(
  env: ShopifyCatalogueEnv,
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
  if (!response.ok) throw new ShopifyCatalogueError(payload?.error || fallback, response.status);
  return payload as T;
}

export async function shopifyAdminGraphql<T>(input: {
  shop: string;
  accessToken: string;
  apiVersion: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(input.shop)) throw new ShopifyCatalogueError("Invalid Shopify shop domain", 400);
  if (!/^\d{4}-\d{2}$/.test(input.apiVersion)) throw new ShopifyCatalogueError("Invalid Shopify API version", 500);
  const response = await (input.fetchImpl ?? fetch)(`https://${input.shop}/admin/api/${input.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shopify-Access-Token": input.accessToken,
    },
    body: JSON.stringify({ query: input.query, variables: input.variables || {} }),
  });
  if (!response.ok) throw new ShopifyCatalogueError(`Shopify Admin API request failed (${response.status})`, response.status === 401 || response.status === 403 ? 409 : 502);
  const envelope = await response.json<GraphqlEnvelope<T>>();
  if (envelope.errors?.length) {
    const message = envelope.errors.map(error => error.message).filter(Boolean).join("; ") || "Shopify GraphQL request failed";
    throw new ShopifyCatalogueError(message, 502);
  }
  if (!envelope.data) throw new ShopifyCatalogueError("Shopify GraphQL response did not include data", 502);
  return envelope.data;
}

const VARIANTS_QUERY = `#graphql
  query OperatingLayerVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      nodes {
        id
        title
        sku
        barcode
        updatedAt
        product { id title status }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  query OperatingLayerLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after, includeInactive: true) {
      nodes {
        id
        name
        deactivatedAt
        address { formatted }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchShopifyVariants(input: {
  shop: string;
  accessToken: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}) {
  const nodes: VariantNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: { productVariants: { nodes: VariantNode[]; pageInfo: PageInfo } } = await shopifyAdminGraphql({
      ...input,
      query: VARIANTS_QUERY,
      variables: { first: PAGE_SIZE, after },
    });
    nodes.push(...data.productVariants.nodes);
    if (!data.productVariants.pageInfo.hasNextPage) return nodes;
    after = data.productVariants.pageInfo.endCursor;
    if (!after) throw new ShopifyCatalogueError("Shopify variant pagination ended without a cursor", 502);
  }
  throw new ShopifyCatalogueError(`Shopify catalogue exceeds the ${PAGE_SIZE * MAX_PAGES} variant discovery limit`, 413);
}

export async function fetchShopifyLocations(input: {
  shop: string;
  accessToken: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}) {
  const nodes: LocationNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: { locations: { nodes: LocationNode[]; pageInfo: PageInfo } } = await shopifyAdminGraphql({
      ...input,
      query: LOCATIONS_QUERY,
      variables: { first: PAGE_SIZE, after },
    });
    nodes.push(...data.locations.nodes);
    if (!data.locations.pageInfo.hasNextPage) return nodes;
    after = data.locations.pageInfo.endCursor;
    if (!after) throw new ShopifyCatalogueError("Shopify location pagination ended without a cursor", 502);
  }
  throw new ShopifyCatalogueError(`Shopify account exceeds the ${PAGE_SIZE * MAX_PAGES} location discovery limit`, 413);
}

function expiresSoon(value: string, windowMs = 60_000) {
  const expiresAt = new Date(value).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + windowMs;
}

async function loadUsableCredential(env: ShopifyCatalogueEnv, context: Awaited<ReturnType<typeof sessionContext>>, connectionId: string) {
  const actor = { id: context.session.user.id, role: context.membership.role, name: context.session.user.name };
  const response = await tenantRequest(env, context.tenantId, `/__integrations/credentials/${encodeURIComponent(connectionId)}`, { method: "GET" }, actor);
  const stored = await jsonOrThrow<StoredCredential>(response, "Unable to read Shopify credentials");
  if (stored.connection.provider !== "shopify") throw new ShopifyCatalogueError("Connection is not a Shopify integration", 409);
  if (stored.connection.status === "disconnected") throw new ShopifyCatalogueError("Shopify connection is disconnected", 409);
  let secrets = await decryptCredentialPayload<ShopifySecrets>(
    stored.credential.envelope,
    env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    env.INTEGRATION_TOKEN_KEY_VERSION,
  );
  if (!secrets.accessToken) throw new ShopifyCatalogueError("Shopify access token is unavailable; reconnect the store", 409);

  if (expiresSoon(stored.credential.accessTokenExpiresAt)) {
    if (!secrets.refreshToken) throw new ShopifyCatalogueError("Shopify refresh token is unavailable; reconnect the store", 409);
    const tokens = await refreshShopifyOfflineToken({
      shop: stored.connection.externalAccountId,
      clientId: env.SHOPIFY_CLIENT_ID,
      clientSecret: env.SHOPIFY_CLIENT_SECRET,
      refreshToken: secrets.refreshToken,
    });
    const missing = missingShopifyScopes(shopifyScopes(env.SHOPIFY_SCOPES || ""), tokens.scope);
    if (missing.length) throw new ShopifyCatalogueError(`Shopify no longer grants required scopes: ${missing.join(", ")}`, 409);
    const envelope = await encryptCredentialPayload({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }, env.INTEGRATION_TOKEN_ENCRYPTION_KEY, env.INTEGRATION_TOKEN_KEY_VERSION);
    const issuedAt = Date.now();
    const write = await tenantRequest(env, context.tenantId, "/__integrations/connections/upsert", {
      method: "POST",
      body: JSON.stringify({
        id: stored.connection.id,
        provider: "shopify",
        externalAccountId: stored.connection.externalAccountId,
        displayName: stored.connection.displayName,
        status: stored.connection.status,
        capabilities: stored.connection.capabilities,
        credential: {
          envelope,
          scopes: tokens.scope,
          accessTokenExpiresAt: tokenExpiryIso(tokens.expiresIn, issuedAt),
          refreshTokenExpiresAt: tokenExpiryIso(tokens.refreshTokenExpiresIn, issuedAt),
        },
      }),
    }, actor);
    await jsonOrThrow<{ ok: true }>(write, "Unable to rotate Shopify credentials");
    secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }
  return { stored, secrets, actor };
}

async function checkpoint(env: ShopifyCatalogueEnv, tenantId: string, connectionId: string, resource: "catalogue" | "locations", status: "running" | "failed", actor: { id: string; role: string; name?: string }, error?: string) {
  const response = await tenantRequest(env, tenantId, "/__integrations/discovery/checkpoint", {
    method: "POST",
    body: JSON.stringify({ connectionId, resource, status, error: error || null }),
  }, actor);
  await jsonOrThrow<{ ok: true }>(response, "Unable to update integration checkpoint");
}

async function replaceDiscovery(env: ShopifyCatalogueEnv, tenantId: string, stored: StoredCredential, resource: "catalogue" | "locations", entityType: "variant" | "location", entities: Array<{ externalId: string; displayName: string; externalUpdatedAt?: string | null; payload: Record<string, unknown> }>, actor: { id: string; role: string; name?: string }) {
  const response = await tenantRequest(env, tenantId, "/__integrations/discovery/replace", {
    method: "POST",
    body: JSON.stringify({
      connectionId: stored.connection.id,
      provider: "shopify",
      externalAccountId: stored.connection.externalAccountId,
      resource,
      entityType,
      entities,
    }),
  }, actor);
  return jsonOrThrow<{ ok: true; itemCount: number; summary: Record<string, number> }>(response, `Unable to persist Shopify ${resource} discovery`);
}

shopifyCatalogueApp.post("/sync", async c => {
  try {
    configured(c.env);
    const context = await sessionContext(c.req.raw, c.env);
    const body = await c.req.json<{ connectionId?: string }>().catch((): { connectionId?: string } => ({}));
    if (!body.connectionId) throw new ShopifyCatalogueError("connectionId is required", 400);
    const { stored, secrets, actor } = await loadUsableCredential(c.env, context, body.connectionId);
    await checkpoint(c.env, context.tenantId, stored.connection.id, "catalogue", "running", actor);
    await checkpoint(c.env, context.tenantId, stored.connection.id, "locations", "running", actor);

    let catalogue;
    try {
      const variants = await fetchShopifyVariants({
        shop: stored.connection.externalAccountId,
        accessToken: secrets.accessToken,
        apiVersion: c.env.SHOPIFY_API_VERSION,
      });
      catalogue = await replaceDiscovery(c.env, context.tenantId, stored, "catalogue", "variant", variants.map(variant => ({
        externalId: variant.id,
        displayName: `${variant.product.title} — ${variant.title}`,
        externalUpdatedAt: variant.updatedAt,
        payload: {
          sku: variant.sku,
          barcode: variant.barcode,
          variantTitle: variant.title,
          productId: variant.product.id,
          productTitle: variant.product.title,
          productStatus: variant.product.status,
        },
      })), actor);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Shopify catalogue discovery failed";
      await checkpoint(c.env, context.tenantId, stored.connection.id, "catalogue", "failed", actor, message).catch(() => undefined);
      await checkpoint(c.env, context.tenantId, stored.connection.id, "locations", "failed", actor, "Location discovery was not attempted because catalogue discovery failed").catch(() => undefined);
      throw cause;
    }

    let locations;
    try {
      const shopifyLocations = await fetchShopifyLocations({
        shop: stored.connection.externalAccountId,
        accessToken: secrets.accessToken,
        apiVersion: c.env.SHOPIFY_API_VERSION,
      });
      locations = await replaceDiscovery(c.env, context.tenantId, stored, "locations", "location", shopifyLocations.map(location => ({
        externalId: location.id,
        displayName: location.name,
        payload: {
          name: location.name,
          active: !location.deactivatedAt,
          deactivatedAt: location.deactivatedAt,
          address: location.address?.formatted || [],
        },
      })), actor);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Shopify location discovery failed";
      await checkpoint(c.env, context.tenantId, stored.connection.id, "locations", "failed", actor, message).catch(() => undefined);
      throw cause;
    }

    const stateResponse = await tenantRequest(c.env, context.tenantId, `/integrations/${encodeURIComponent(stored.connection.id)}/mappings`, { method: "GET" }, actor);
    const state = await jsonOrThrow<Record<string, unknown>>(stateResponse, "Unable to read integration mappings after sync");
    return c.json({ ok: true, catalogue, locations, mapping: state });
  } catch (cause) {
    const status = cause instanceof ShopifyCatalogueError ? cause.status : 500;
    const message = cause instanceof Error ? cause.message : "Unable to sync Shopify catalogue";
    return new Response(JSON.stringify({ error: status >= 500 ? "Unable to sync Shopify catalogue" : message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});
