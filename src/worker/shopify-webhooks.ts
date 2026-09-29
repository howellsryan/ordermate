import { shopifyAdminGraphql } from "./shopify-catalogue";

export const REQUIRED_SHOPIFY_WEBHOOK_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "APP_UNINSTALLED",
] as const;

export type RequiredShopifyWebhookTopic = typeof REQUIRED_SHOPIFY_WEBHOOK_TOPICS[number];

type WebhookNode = {
  id: string;
  topic: string;
  uri: string;
  format: string | null;
  includeFields: string[] | null;
};
type WebhookList = {
  webhookSubscriptions: {
    edges: Array<{ node: WebhookNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};
type WebhookMutation = {
  webhookSubscriptionCreate?: {
    webhookSubscription: WebhookNode | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
  webhookSubscriptionUpdate?: {
    webhookSubscription: WebhookNode | null;
    userErrors: Array<{ field?: string[] | null; message: string }>;
  };
};

const LIST_WEBHOOKS = `#graphql
  query OperatingLayerWebhookSubscriptions {
    webhookSubscriptions(first: 250) {
      edges { node { id topic uri format includeFields } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_WEBHOOK = `#graphql
  mutation OperatingLayerWebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri format includeFields }
      userErrors { field message }
    }
  }
`;

const UPDATE_WEBHOOK = `#graphql
  mutation OperatingLayerWebhookUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri format includeFields }
      userErrors { field message }
    }
  }
`;

function subscriptionInput(topic: RequiredShopifyWebhookTopic, uri: string) {
  return topic.startsWith("ORDERS_")
    ? { uri, format: "JSON", includeFields: ["id", "admin_graphql_api_id"] }
    : { uri, format: "JSON" };
}

function expectedIncludeFields(topic: RequiredShopifyWebhookTopic) {
  return topic.startsWith("ORDERS_") ? ["admin_graphql_api_id", "id"] : [];
}

function normalizedFields(fields: string[] | null | undefined) {
  return [...(fields || [])].sort();
}

function matchesExpected(subscription: WebhookNode, topic: RequiredShopifyWebhookTopic, uri: string) {
  return subscription.uri === uri
    && subscription.format === "JSON"
    && JSON.stringify(normalizedFields(subscription.includeFields)) === JSON.stringify(expectedIncludeFields(topic));
}

function mutationResult(data: WebhookMutation, operation: "create" | "update") {
  const result = operation === "create" ? data.webhookSubscriptionCreate : data.webhookSubscriptionUpdate;
  if (!result) throw new Error(`Shopify webhook ${operation} response was incomplete`);
  if (result.userErrors.length) {
    throw new Error(`Shopify webhook ${operation} failed: ${result.userErrors.map(error => error.message).join("; ")}`);
  }
  if (!result.webhookSubscription) throw new Error(`Shopify webhook ${operation} did not return a subscription`);
  return result.webhookSubscription;
}

/**
 * Ensures the shop-scoped subscriptions needed by the custom OAuth integration.
 * Existing subscriptions for the same topic are reconciled to the canonical
 * Worker endpoint and payload contract rather than duplicated.
 */
export async function ensureShopifyWebhookSubscriptions(input: {
  shop: string;
  accessToken: string;
  apiVersion: string;
  uri: string;
  fetchImpl?: typeof fetch;
}) {
  const listed = await shopifyAdminGraphql<WebhookList>({
    shop: input.shop,
    accessToken: input.accessToken,
    apiVersion: input.apiVersion,
    query: LIST_WEBHOOKS,
    fetchImpl: input.fetchImpl,
  });
  if (listed.webhookSubscriptions.pageInfo.hasNextPage) {
    throw new Error("Shopify app has more than 250 shop-scoped webhook subscriptions; automatic reconciliation is unsafe");
  }

  const existing = listed.webhookSubscriptions.edges.map(edge => edge.node);
  const ensured: WebhookNode[] = [];
  for (const topic of REQUIRED_SHOPIFY_WEBHOOK_TOPICS) {
    const matches = existing.filter(subscription => subscription.topic === topic);
    const exact = matches.find(subscription => matchesExpected(subscription, topic, input.uri));
    if (exact) {
      ensured.push(exact);
      continue;
    }
    if (matches.length > 1) {
      throw new Error(`Shopify has multiple ${topic} subscriptions with conflicting configuration; remove duplicates before reconnecting`);
    }

    if (matches.length === 1) {
      const data = await shopifyAdminGraphql<WebhookMutation>({
        shop: input.shop,
        accessToken: input.accessToken,
        apiVersion: input.apiVersion,
        query: UPDATE_WEBHOOK,
        variables: { id: matches[0].id, webhookSubscription: subscriptionInput(topic, input.uri) },
        fetchImpl: input.fetchImpl,
      });
      ensured.push(mutationResult(data, "update"));
      continue;
    }

    const data = await shopifyAdminGraphql<WebhookMutation>({
      shop: input.shop,
      accessToken: input.accessToken,
      apiVersion: input.apiVersion,
      query: CREATE_WEBHOOK,
      variables: { topic, webhookSubscription: subscriptionInput(topic, input.uri) },
      fetchImpl: input.fetchImpl,
    });
    ensured.push(mutationResult(data, "create"));
  }
  return ensured;
}
