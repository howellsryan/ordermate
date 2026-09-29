import { describe, expect, it } from "vitest";
import {
  buildXeroAuthorizationUrl,
  refreshTokenExpiryIso,
  resolveXeroConnection,
  tokenExpiryIso,
  xeroScopes,
  type XeroConnection,
} from "../src/worker/xero-auth";

function connection(id: string, authEventId: string, name: string): XeroConnection {
  return {
    id: `connection-${id}`,
    authEventId,
    tenantId: id,
    tenantType: "ORGANISATION",
    tenantName: name,
    createdDateUtc: "2026-09-29T20:00:00.000Z",
    updatedDateUtc: "2026-09-29T20:00:00.000Z",
  };
}

describe("Xero OAuth contracts", () => {
  it("builds an authorization request with the exact requested scopes and state", () => {
    const scopes = xeroScopes("openid profile email offline_access accounting.contacts accounting.invoices");
    const url = new URL(buildXeroAuthorizationUrl({
      clientId: "client-123",
      redirectUri: "https://example.com/api/integrations/xero/callback",
      scopes,
      state: "state-123",
    }));

    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/api/integrations/xero/callback");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(scopes);
  });

  it("selects the newly authorised organisation by authentication event id", () => {
    const connections = [
      connection("tenant-old", "auth-old", "Old Books"),
      connection("tenant-new", "auth-new", "New Books"),
    ];

    expect(resolveXeroConnection(connections, "auth-new").tenantId).toBe("tenant-new");
  });

  it("fails closed when several Xero organisations exist but the auth event cannot identify the new one", () => {
    const connections = [
      connection("tenant-a", "auth-a", "A Ltd"),
      connection("tenant-b", "auth-b", "B Ltd"),
    ];

    expect(() => resolveXeroConnection(connections, null)).toThrow(/multiple organisations/i);
    expect(() => resolveXeroConnection(connections, "unknown-auth-event")).toThrow(/multiple organisations/i);
  });

  it("allows an unambiguous single-organisation fallback", () => {
    expect(resolveXeroConnection([connection("tenant-only", "auth-only", "Only Ltd")], null).tenantId).toBe("tenant-only");
  });

  it("uses a short access-token expiry and a sixty-day rotating refresh-token horizon", () => {
    const issuedAt = Date.UTC(2026, 8, 29, 20, 0, 0);
    expect(tokenExpiryIso(1800, issuedAt)).toBe("2026-09-29T20:30:00.000Z");
    expect(refreshTokenExpiryIso(issuedAt)).toBe("2026-11-28T20:00:00.000Z");
  });
});
