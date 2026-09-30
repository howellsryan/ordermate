import { afterEach, describe, expect, it, vi } from "vitest";
import { xeroIntegrationApp, type XeroIntegrationEnv } from "../src/worker/xero-integration";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
  const tenantId = "workspace-1";
  const connectionId = crypto.randomUUID();
  const upsert = vi.fn(async () => Response.json({ ok: true }));
  const database = {
    prepare: (sql: string) => ({
      bind: (..._values: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM integration_oauth_states")) return { tenant_id: tenantId, created_by: "owner-1", expires_at: Date.now() + 60_000, consumed_at: null };
          if (sql.includes("FROM member")) return { id: "membership-1", role: "owner" };
          if (sql.includes("FROM integration_routes")) return { tenant_id: tenantId, connection_id: connectionId, status: "active" };
          return null;
        },
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  };
  const bindings = {
    CONTROL_DB: database,
    XERO_CLIENT_ID: "client",
    XERO_CLIENT_SECRET: "secret",
    XERO_SCOPES: "offline_access accounting.contacts accounting.invoices",
    INTEGRATION_TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    INTEGRATION_TOKEN_KEY_VERSION: "v1",
    TENANT_STORES: { jurisdiction: () => ({ getByName: () => ({ fetch: upsert }) }) },
  } as unknown as XeroIntegrationEnv;
  const auth = btoa(JSON.stringify({ authentication_event_id: "auth-1" }));
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({
      access_token: `header.${auth}.signature`, refresh_token: "refresh", expires_in: 1800,
      scope: "offline_access accounting.contacts accounting.invoices",
    }))
    .mockResolvedValueOnce(Response.json([{
      id: "xero-connection", authEventId: "auth-1", tenantId: "xero-tenant-1",
      tenantType: "ORGANISATION", tenantName: "Demo Company",
    }]));
  vi.stubGlobal("fetch", transport);
  return { bindings, upsert, transport };
}

describe("Xero callback response", () => {
  it("persists the authorised connection and redirects with the clearing cookie", async () => {
    const { bindings, upsert, transport } = fixture();
    const response = await xeroIntegrationApp.fetch(new Request("https://app.test/callback?state=nonce&code=code", {
      headers: { Cookie: "ol_xero_oauth_state=nonce" },
    }), bindings);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://app.test/?integration=xero&status=connected");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid OAuth cookie before exchanging credentials", async () => {
    const { bindings, upsert, transport } = fixture();
    const response = await xeroIntegrationApp.fetch(new Request("https://app.test/callback?state=nonce&code=code", {
      headers: { Cookie: "ol_xero_oauth_state=wrong" },
    }), bindings);
    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
