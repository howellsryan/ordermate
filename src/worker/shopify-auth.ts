import { normalizeShopifyShopDomain } from "../shared/integration-contract";

export type ShopifyTokenResponse = {
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn: number;
  refreshTokenExpiresIn: number;
};

type ShopifyTokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
};

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function base64ToBytes(value: string) {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export function shopifyScopes(value: string) {
  return [...new Set(value.split(",").map(scope => scope.trim()).filter(Boolean))];
}

export function buildShopifyAuthorizationUrl(input: {
  shop: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}) {
  const shop = normalizeShopifyShopDomain(input.shop);
  if (!input.clientId.trim()) throw new Error("Shopify client ID is required");
  if (!input.redirectUri.trim()) throw new Error("Shopify redirect URI is required");
  if (!input.state.trim()) throw new Error("Shopify OAuth state is required");
  if (!input.scopes.length) throw new Error("At least one Shopify scope is required");

  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId.trim());
  url.searchParams.set("scope", input.scopes.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function verifyShopifyOAuthHmac(url: URL, clientSecret: string) {
  const provided = url.searchParams.get("hmac");
  if (!provided || !clientSecret) return false;
  const signature = hexToBytes(provided);
  if (!signature) return false;

  const message = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const key = await hmacKey(clientSecret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, utf8(message));
}

export async function verifyShopifyWebhookHmac(
  rawBody: ArrayBuffer,
  providedHmac: string | null,
  clientSecret: string,
) {
  if (!providedHmac || !clientSecret) return false;
  const signature = base64ToBytes(providedHmac);
  if (!signature) return false;
  const key = await hmacKey(clientSecret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, rawBody);
}

function parseTokenPayload(payload: ShopifyTokenPayload): ShopifyTokenResponse {
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Shopify token response did not include an access token");
  if (typeof payload.refresh_token !== "string" || !payload.refresh_token) throw new Error("Shopify token response did not include a refresh token");
  if (typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) throw new Error("Shopify token response did not include a valid access-token lifetime");
  if (typeof payload.refresh_token_expires_in !== "number" || !Number.isFinite(payload.refresh_token_expires_in) || payload.refresh_token_expires_in <= 0) throw new Error("Shopify token response did not include a valid refresh-token lifetime");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scope: typeof payload.scope === "string" ? shopifyScopes(payload.scope) : [],
    expiresIn: payload.expires_in,
    refreshTokenExpiresIn: payload.refresh_token_expires_in,
  };
}

async function tokenRequest(shop: string, body: URLSearchParams, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`https://${normalizeShopifyShopDomain(shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!response.ok) throw new Error(`Shopify token request failed (${response.status})`);
  return parseTokenPayload(await response.json<ShopifyTokenPayload>());
}

export function exchangeShopifyAuthorizationCode(input: {
  shop: string;
  clientId: string;
  clientSecret: string;
  code: string;
  fetchImpl?: typeof fetch;
}) {
  return tokenRequest(input.shop, new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    expiring: "1",
  }), input.fetchImpl ?? fetch);
}

export function refreshShopifyOfflineToken(input: {
  shop: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}) {
  return tokenRequest(input.shop, new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  }), input.fetchImpl ?? fetch);
}

export function missingShopifyScopes(requested: string[], granted: string[]) {
  const grantedSet = new Set(granted);
  return requested.filter(scope => !grantedSet.has(scope));
}

export function tokenExpiryIso(seconds: number, nowMs = Date.now()) {
  return new Date(nowMs + seconds * 1000).toISOString();
}
