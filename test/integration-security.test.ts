import { describe, expect, it } from "vitest";
import { decryptCredentialPayload, encryptCredentialPayload } from "../src/worker/integration-crypto";
import {
  buildShopifyAuthorizationUrl,
  exchangeShopifyAuthorizationCode,
  missingShopifyScopes,
  refreshShopifyOfflineToken,
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
} from "../src/worker/shopify-auth";

function testKey(byte: number) {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
}

async function signHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function signBase64(value: ArrayBuffer, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, value));
  return btoa(String.fromCharCode(...signature));
}

describe("integration credential encryption", () => {
  it("round-trips credentials without exposing plaintext in the envelope", async () => {
    const envelope = await encryptCredentialPayload(
      { accessToken: "shpat_secret", refreshToken: "shprt_secret" },
      testKey(7),
      "v1",
    );
    expect(JSON.stringify(envelope)).not.toContain("shpat_secret");
    expect(JSON.stringify(envelope)).not.toContain("shprt_secret");
    await expect(decryptCredentialPayload(envelope, testKey(7), "v1")).resolves.toEqual({
      accessToken: "shpat_secret",
      refreshToken: "shprt_secret",
    });
  });

  it("fails closed for the wrong key or key version", async () => {
    const envelope = await encryptCredentialPayload({ accessToken: "a", refreshToken: "b" }, testKey(3), "v1");
    await expect(decryptCredentialPayload(envelope, testKey(4), "v1")).rejects.toThrow();
    await expect(decryptCredentialPayload(envelope, testKey(3), "v2")).rejects.toThrow(/key version/);
  });
});

describe("Shopify auth security", () => {
  it("builds an offline authorization-code redirect against the permanent shop domain", () => {
    const authorizationUrl = new URL(buildShopifyAuthorizationUrl({
      shop: "Example-Store.myshopify.com",
      clientId: "client-id",
      redirectUri: "https://app.example/api/integrations/shopify/callback",
      scopes: ["read_products", "read_orders"],
      state: "nonce",
    }));
    expect(authorizationUrl.origin).toBe("https://example-store.myshopify.com");
    expect(authorizationUrl.pathname).toBe("/admin/oauth/authorize");
    expect(authorizationUrl.searchParams.get("scope")).toBe("read_products,read_orders");
    expect(authorizationUrl.searchParams.get("state")).toBe("nonce");
  });

  it("verifies Shopify OAuth callback HMACs over sorted query parameters", async () => {
    const secret = "oauth-secret";
    const message = "code=abc&shop=example.myshopify.com&state=nonce&timestamp=123";
    const hmac = await signHex(message, secret);
    const url = new URL(`https://app.example/callback?timestamp=123&shop=example.myshopify.com&state=nonce&code=abc&hmac=${hmac}`);
    await expect(verifyShopifyOAuthHmac(url, secret)).resolves.toBe(true);
    url.searchParams.set("shop", "attacker.myshopify.com");
    await expect(verifyShopifyOAuthHmac(url, secret)).resolves.toBe(false);
  });

  it("verifies webhook HMACs against the raw body", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ id: 123 })).buffer;
    const secret = "webhook-secret";
    const hmac = await signBase64(body, secret);
    await expect(verifyShopifyWebhookHmac(body, hmac, secret)).resolves.toBe(true);
    const changed = new TextEncoder().encode(JSON.stringify({ id: 124 })).buffer;
    await expect(verifyShopifyWebhookHmac(changed, hmac, secret)).resolves.toBe(false);
  });

  it("uses expiring offline tokens for code exchange and rotates refresh tokens", async () => {
    const calls: URLSearchParams[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init?.body as URLSearchParams);
      return Response.json({
        access_token: "shpat_next",
        refresh_token: "shprt_next",
        scope: "read_products,read_orders",
        expires_in: 3600,
        refresh_token_expires_in: 7776000,
      });
    }) as typeof fetch;

    await exchangeShopifyAuthorizationCode({
      shop: "example.myshopify.com",
      clientId: "client",
      clientSecret: "secret",
      code: "code",
      fetchImpl,
    });
    expect(calls[0].get("expiring")).toBe("1");
    expect(calls[0].get("code")).toBe("code");

    await refreshShopifyOfflineToken({
      shop: "example.myshopify.com",
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "shprt_old",
      fetchImpl,
    });
    expect(calls[1].get("grant_type")).toBe("refresh_token");
    expect(calls[1].get("refresh_token")).toBe("shprt_old");
  });

  it("reports missing required scopes without inventing equivalence", () => {
    expect(missingShopifyScopes(["read_products", "read_orders"], ["read_products"])).toEqual(["read_orders"]);
  });
});
