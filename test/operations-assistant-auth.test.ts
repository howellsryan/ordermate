import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { operationsAssistantApp } from "../src/worker/operations-assistant";

function assistantEnv() {
  return {
    ...env,
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    BETTER_AUTH_SECRET: "test-better-auth-secret-that-is-long-enough-for-tests",
    AI_OPERATIONS_ASSISTANT_ENABLED: "false",
  } as never;
}

describe("operations assistant tenant boundary", () => {
  it("does not trust a tenant selector without an authenticated session", async () => {
    const response = await operationsAssistantApp.fetch(new Request("https://operating-layer.test/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ordermate-tenant": `forged-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ question: "What stock is at risk?" }),
    }), assistantEnv());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("validates the bounded question contract before any business-data read", async () => {
    const response = await operationsAssistantApp.fetch(new Request("https://operating-layer.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "" }),
    }), assistantEnv());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ask a question between 1 and 500 characters" });
  });
});
