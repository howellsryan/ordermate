import { describe, expect, it, vi } from "vitest";
import { shopifyStoredWebhookPayload } from "../src/worker/shopify-integration";
import { ensureShopifyWebhookSubscriptions, REQUIRED_SHOPIFY_WEBHOOK_TOPICS } from "../src/worker/shopify-webhooks";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function node(id: string, topic: string, uri: string, options?: { format?: string | null; includeFields?: string[] | null }) {
  return {
    id,
    topic,
    uri,
    format: options?.format === undefined ? "JSON" : options.format,
    includeFields: options?.includeFields === undefined
      ? topic.startsWith("ORDERS_") ? ["id", "admin_graphql_api_id"] : null
      : options.includeFields,
  };
}

describe("Shopify webhook subscription reconciliation", () => {
  it("keeps correct subscriptions, updates a stale URI and creates only missing topics", async () => {
    const uri = "https://staging.example.com/api/integrations/shopify/webhooks";
    const operations: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      operations.push(body);
      if (body.query.includes("OperatingLayerWebhookSubscriptions")) {
        return jsonResponse({ data: { webhookSubscriptions: {
          edges: [
            { node: node("gid://shopify/WebhookSubscription/1", "ORDERS_CREATE", uri) },
            { node: node("gid://shopify/WebhookSubscription/2", "ORDERS_UPDATED", "https://old.example.com/webhooks") },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } });
      }
      if (body.query.includes("OperatingLayerWebhookUpdate")) {
        const variables = body.variables as { id: string; webhookSubscription: { uri: string; format: string; includeFields?: string[] } };
        expect(variables.id).toBe("gid://shopify/WebhookSubscription/2");
        expect(variables.webhookSubscription.uri).toBe(uri);
        expect(variables.webhookSubscription.format).toBe("JSON");
        expect(variables.webhookSubscription.includeFields).toEqual(["id", "admin_graphql_api_id"]);
        return jsonResponse({ data: { webhookSubscriptionUpdate: {
          webhookSubscription: node("gid://shopify/WebhookSubscription/2", "ORDERS_UPDATED", uri),
          userErrors: [],
        } } });
      }
      const variables = body.variables as { topic: string; webhookSubscription: { uri: string; format: string; includeFields?: string[] } };
      expect(variables.webhookSubscription.uri).toBe(uri);
      expect(variables.webhookSubscription.format).toBe("JSON");
      if (variables.topic.startsWith("ORDERS_")) {
        expect(variables.webhookSubscription.includeFields).toEqual(["id", "admin_graphql_api_id"]);
      } else {
        expect(variables.webhookSubscription.includeFields).toBeUndefined();
      }
      return jsonResponse({ data: { webhookSubscriptionCreate: {
        webhookSubscription: node(`gid://shopify/WebhookSubscription/${operations.length}`, variables.topic, uri),
        userErrors: [],
      } } });
    }) as unknown as typeof fetch;

    const ensured = await ensureShopifyWebhookSubscriptions({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      uri,
      fetchImpl,
    });

    expect(ensured.map(subscription => subscription.topic)).toEqual([...REQUIRED_SHOPIFY_WEBHOOK_TOPICS]);
    expect(operations).toHaveLength(REQUIRED_SHOPIFY_WEBHOOK_TOPICS.length); // list + one update + every missing topic
    const createdTopics = operations
      .filter(operation => operation.query.includes("OperatingLayerWebhookCreate"))
      .map(operation => operation.variables.topic);
    expect(createdTopics).toEqual([...REQUIRED_SHOPIFY_WEBHOOK_TOPICS].slice(2));
  });

  it("is idempotent only when URI, format and payload fields all match", async () => {
    const uri = "https://app.example.com/api/integrations/shopify/webhooks";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      expect(body.query).toContain("OperatingLayerWebhookSubscriptions");
      return jsonResponse({ data: { webhookSubscriptions: {
        edges: REQUIRED_SHOPIFY_WEBHOOK_TOPICS.map((topic, index) => ({ node: node(`gid://shopify/WebhookSubscription/${index + 1}`, topic, uri) })),
        pageInfo: { hasNextPage: false, endCursor: null },
      } } });
    }) as unknown as typeof fetch;

    const ensured = await ensureShopifyWebhookSubscriptions({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      uri,
      fetchImpl,
    });
    expect(ensured).toHaveLength(REQUIRED_SHOPIFY_WEBHOOK_TOPICS.length);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("updates a same-URI order subscription that still sends the full payload", async () => {
    const uri = "https://app.example.com/api/integrations/shopify/webhooks";
    let calls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (calls === 1) {
        return jsonResponse({ data: { webhookSubscriptions: {
          edges: REQUIRED_SHOPIFY_WEBHOOK_TOPICS.map((topic, index) => ({
            node: node(
              `gid://shopify/WebhookSubscription/${index + 1}`,
              topic,
              uri,
              topic === "ORDERS_CREATE" ? { includeFields: null } : undefined,
            ),
          })),
          pageInfo: { hasNextPage: false, endCursor: null },
        } } });
      }
      expect(body.query).toContain("OperatingLayerWebhookUpdate");
      const variables = body.variables as { id: string; webhookSubscription: { includeFields?: string[] } };
      expect(variables.id).toBe("gid://shopify/WebhookSubscription/1");
      expect(variables.webhookSubscription.includeFields).toEqual(["id", "admin_graphql_api_id"]);
      return jsonResponse({ data: { webhookSubscriptionUpdate: {
        webhookSubscription: node("gid://shopify/WebhookSubscription/1", "ORDERS_CREATE", uri),
        userErrors: [],
      } } });
    }) as unknown as typeof fetch;

    await ensureShopifyWebhookSubscriptions({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      uri,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the same required topic already has conflicting subscriptions", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { webhookSubscriptions: {
      edges: [
        { node: node("gid://shopify/WebhookSubscription/1", "ORDERS_CREATE", "https://one.example.com/webhooks") },
        { node: node("gid://shopify/WebhookSubscription/2", "ORDERS_CREATE", "https://two.example.com/webhooks") },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } })) as unknown as typeof fetch;

    await expect(ensureShopifyWebhookSubscriptions({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      uri: "https://app.example.com/api/integrations/shopify/webhooks",
      fetchImpl,
    })).rejects.toThrow("multiple ORDERS_CREATE subscriptions");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not persist customer or shipping data from order webhooks", () => {
    const stored = shopifyStoredWebhookPayload("orders/create", {
      id: 123456,
      admin_graphql_api_id: "gid://shopify/Order/123456",
      email: "customer@example.com",
      customer: { id: 77, first_name: "Alex", email: "customer@example.com" },
      shipping_address: { address1: "1 High Street", postcode: "NG1 1AA" },
      line_items: [{ title: "Private purchase" }],
    });
    expect(JSON.parse(stored)).toEqual({
      id: 123456,
      admin_graphql_api_id: "gid://shopify/Order/123456",
    });
    expect(stored).not.toContain("customer@example.com");
    expect(stored).not.toContain("High Street");
    expect(stored).not.toContain("Private purchase");
  });
});
