export type XeroTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string[];
  authenticationEventId: string | null;
};

export type XeroConnection = {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string;
  createdDateUtc: string;
  updatedDateUtc: string;
};

type XeroTokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

function base64Basic(clientId: string, clientSecret: string) {
  return btoa(`${clientId}:${clientSecret}`);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, encoded] = token.split(".");
  if (!encoded) return null;
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const json = atob(normalized);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function xeroScopes(value: string) {
  return [...new Set(value.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean))];
}

export function buildXeroAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}) {
  if (!input.clientId.trim()) throw new Error("Xero client ID is required");
  if (!input.redirectUri.trim()) throw new Error("Xero redirect URI is required");
  if (!input.state.trim()) throw new Error("Xero OAuth state is required");
  if (!input.scopes.length) throw new Error("At least one Xero scope is required");
  const url = new URL("https://login.xero.com/identity/connect/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId.trim());
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

function parseTokenPayload(payload: XeroTokenPayload): XeroTokenResponse {
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Xero token response did not include an access token");
  if (typeof payload.refresh_token !== "string" || !payload.refresh_token) throw new Error("Xero token response did not include a refresh token");
  if (typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) throw new Error("Xero token response did not include a valid access-token lifetime");
  const claims = decodeJwtPayload(payload.access_token);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: typeof payload.scope === "string" ? xeroScopes(payload.scope) : [],
    authenticationEventId: typeof claims?.authentication_event_id === "string" ? claims.authentication_event_id : null,
  };
}

async function tokenRequest(input: {
  clientId: string;
  clientSecret: string;
  body: URLSearchParams;
  fetchImpl?: typeof fetch;
}) {
  const response = await (input.fetchImpl ?? fetch)("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Basic(input.clientId, input.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: input.body,
  });
  if (!response.ok) throw new Error(`Xero token request failed (${response.status})`);
  return parseTokenPayload(await response.json<XeroTokenPayload>());
}

export function exchangeXeroAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}) {
  return tokenRequest({
    ...input,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
}

export function refreshXeroToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}) {
  return tokenRequest({
    ...input,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
  });
}

export async function fetchXeroConnections(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Xero connections request failed (${response.status})`);
  const connections = await response.json<XeroConnection[]>();
  return connections.filter(connection => connection.tenantType === "ORGANISATION");
}

export function resolveXeroConnection(connections: XeroConnection[], authenticationEventId: string | null) {
  if (authenticationEventId) {
    const matched = connections.filter(connection => connection.authEventId === authenticationEventId);
    if (matched.length === 1) return matched[0];
  }
  if (connections.length === 1) return connections[0];
  throw new Error("Xero authorised multiple organisations and the new connection could not be identified safely");
}

export function tokenExpiryIso(seconds: number, nowMs = Date.now()) {
  return new Date(nowMs + seconds * 1000).toISOString();
}

/** Xero rotating refresh tokens remain usable for up to 60 days when not used. */
export function refreshTokenExpiryIso(nowMs = Date.now()) {
  return new Date(nowMs + 60 * 24 * 60 * 60 * 1000).toISOString();
}
