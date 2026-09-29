import type { IntegrationOrderProposal } from "../shared/integration-order-contract";
import { decryptCredentialPayload, encryptCredentialPayload, type EncryptedCredentialEnvelope } from "./integration-crypto";
import { integrationInternalHeaders } from "./integration-runtime";
import { missingShopifyScopes, refreshShopifyOfflineToken, shopifyScopes, tokenExpiryIso } from "./shopify-auth";
import { shopifyAdminGraphql } from "./shopify-catalogue";
import type { TenantStore } from "./tenant-store-order-planning";

export type ShopifyOrderProcessingEnv = {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
  SHOPIFY_SCOPES: string;
  SHOPIFY_API_VERSION: string;
  INTEGRATION_TOKEN_ENCRYPTION_KEY: string;
  INTEGRATION_TOKEN_KEY_VERSION: string;
};

export type ShopifyOrderReceivedEvent = {
  type: "shopify.order.received";
  eventId: string;
  tenantId: string;
  connectionId: string;
  shop: string;
  topic: "orders/create" | "orders/updated" | "orders/cancelled";
  orderGid: string | null;
};

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
type Money = { amount: string; currencyCode: string };
type MoneyBag = { shopMoney: Money };
type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type ShopifyLine = {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  requiresShipping: boolean;
  variant: { id: string } | null;
  priceAfterAllDiscountsBeforeTaxesSet: MoneyBag;
  taxLines: Array<{ rate: number | null; priceSet: MoneyBag }>;
};
type ShopifyFulfilmentOrder = {
  id: string;
  status: string;
  assignedLocation: { location: { id: string; name: string } | null };
  lineItems: {
    nodes: Array<{
      remainingQuantity: number;
      totalQuantity: number;
      lineItem: { id: string };
    }>;
    pageInfo: PageInfo;
  };
};
type ShopifyOrder = {
  id: string;
  name: string;
  updatedAt: string;
  cancelledAt: string | null;
  currencyCode: string;
  currentSubtotalPriceSet: MoneyBag;
  currentTotalTaxSet: MoneyBag;
  currentTotalPriceSet: MoneyBag;
  lineItems: { nodes: ShopifyLine[]; pageInfo: PageInfo };
  fulfillmentOrders: { nodes: ShopifyFulfilmentOrder[]; pageInfo: PageInfo };
};

type ProcessingResult = {
  outcome: string;
  retryDelivery: boolean;
  eventId?: string;
  error?: string;
};

const ORDER_TOPICS = new Set(["orders/create", "orders/updated", "orders/cancelled"]);
const MAX_ORDER_LINES = 250;
const MAX_FULFILMENT_ORDERS = 100;
const MAX_FULFILMENT_LINES = 250;

const ORDER_QUERY = `#graphql
  query OperatingLayerOrder($id: ID!) {
    order(id: $id) {
      id
      name
      updatedAt
      cancelledAt
      currencyCode
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      currentTotalTaxSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: ${MAX_ORDER_LINES}) {
        nodes {
          id
          title
          variantTitle
          sku
          quantity
          currentQuantity
          requiresShipping
          variant { id }
          priceAfterAllDiscountsBeforeTaxesSet { shopMoney { amount currencyCode } }
          taxLines { rate priceSet { shopMoney { amount currencyCode } } }
        }
        pageInfo { hasNextPage endCursor }
      }
      fulfillmentOrders(first: ${MAX_FULFILMENT_ORDERS}) {
        nodes {
          id
          status
          assignedLocation { location { id name } }
          lineItems(first: ${MAX_FULFILMENT_LINES}) {
            nodes { remainingQuantity totalQuantity lineItem { id } }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function internalHeaders() {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const [key, value] of Object.entries(integrationInternalHeaders)) headers.set(key, value);
  headers.set("x-ordermate-actor-id", "shopify-order-processor");
  headers.set("x-ordermate-actor-role", "integration");
  return headers;
}

async function tenantRequest(env: ShopifyOrderProcessingEnv, tenantId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of internalHeaders()) headers.set(key, value);
  const request = new Request(`https://tenant.internal${path}`, { ...init, headers });
  return env.TENANT_STORES.jurisdiction("eu").getByName(tenantId).fetch(request);
}

async function jsonOrThrow<T>(response: Response, fallback: string) {
  const payload = await response.json<T & { error?: string }>().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload as T;
}

function expiresSoon(value: string, windowMs = 60_000) {
  const expiresAt = new Date(value).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + windowMs;
}

async function loadUsableCredential(env: ShopifyOrderProcessingEnv, event: ShopifyOrderReceivedEvent) {
  if (!env.SHOPIFY_CLIENT_ID?.trim() || !env.SHOPIFY_CLIENT_SECRET?.trim()) throw new Error("Shopify application credentials are not configured");
  if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() || !env.INTEGRATION_TOKEN_KEY_VERSION?.trim()) throw new Error("Integration credential encryption is not configured");
  const response = await tenantRequest(env, event.tenantId, `/__integrations/credentials/${encodeURIComponent(event.connectionId)}`, { method: "GET" });
  const stored = await jsonOrThrow<StoredCredential>(response, "Unable to read Shopify credentials");
  if (stored.connection.provider !== "shopify" || stored.connection.externalAccountId !== event.shop) throw new Error("Shopify event does not match its stored connection");
  if (stored.connection.status === "disconnected") throw new Error("Shopify connection is disconnected");

  let secrets = await decryptCredentialPayload<ShopifySecrets>(
    stored.credential.envelope,
    env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    env.INTEGRATION_TOKEN_KEY_VERSION,
  );
  if (!secrets.accessToken) throw new Error("Shopify access token is unavailable");

  if (expiresSoon(stored.credential.accessTokenExpiresAt)) {
    if (!secrets.refreshToken) throw new Error("Shopify refresh token is unavailable");
    const tokens = await refreshShopifyOfflineToken({
      shop: event.shop,
      clientId: env.SHOPIFY_CLIENT_ID,
      clientSecret: env.SHOPIFY_CLIENT_SECRET,
      refreshToken: secrets.refreshToken,
    });
    const missing = missingShopifyScopes(shopifyScopes(env.SHOPIFY_SCOPES || ""), tokens.scope);
    if (missing.length) throw new Error(`Shopify no longer grants required scopes: ${missing.join(", ")}`);
    const envelope = await encryptCredentialPayload(
      { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
      env.INTEGRATION_TOKEN_KEY_VERSION,
    );
    const issuedAt = Date.now();
    const write = await tenantRequest(env, event.tenantId, "/__integrations/connections/upsert", {
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
    });
    await jsonOrThrow<{ ok: true }>(write, "Unable to rotate Shopify credentials");
    secrets = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }
  return secrets.accessToken;
}

function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new Error(`Unsupported Shopify currency ${currency}`);
  }
}

export function shopifyMoneyToMinor(amount: string, currency: string) {
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) throw new Error(`Invalid Shopify money amount ${amount}`);
  const digits = currencyDigits(currency);
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = 10n ** BigInt(digits);
  const kept = (fraction + "0".repeat(digits)).slice(0, digits);
  let minor = BigInt(whole) * scale + BigInt(kept || "0");
  const remainder = fraction.slice(digits);
  if (remainder && Number(remainder[0]) >= 5) minor += 1n;
  if (negative) minor = -minor;
  const number = Number(minor);
  if (!Number.isSafeInteger(number)) throw new Error("Shopify money amount exceeds supported range");
  return number;
}

function moneyMinor(bag: MoneyBag, expectedCurrency: string) {
  const money = bag.shopMoney;
  if (money.currencyCode.toUpperCase() !== expectedCurrency.toUpperCase()) {
    throw new Error(`Shopify money currency ${money.currencyCode} does not match order currency ${expectedCurrency}`);
  }
  return shopifyMoneyToMinor(money.amount, expectedCurrency);
}

function blockedProposal(order: ShopifyOrder, connectionId: string, input: { code: string; message: string; retryable?: boolean; retryDelivery?: boolean }): IntegrationOrderProposal {
  const currency = order.currencyCode.toUpperCase();
  const subtotalMinor = moneyMinor(order.currentSubtotalPriceSet, currency);
  const taxMinor = moneyMinor(order.currentTotalTaxSet, currency);
  const totalMinor = moneyMinor(order.currentTotalPriceSet, currency);
  return {
    provider: "shopify",
    connectionId,
    externalOrderId: order.id,
    externalOrderName: order.name,
    externalUpdatedAt: order.updatedAt,
    state: order.cancelledAt ? "cancelled" : "active",
    currency,
    locationExternalId: null,
    locationExternalIds: [],
    subtotalMinor,
    taxMinor,
    totalMinor,
    nonMerchandiseMinor: totalMinor - subtotalMinor - taxMinor,
    lines: [],
    block: {
      code: input.code,
      message: input.message,
      retryable: input.retryable ?? true,
      retryDelivery: input.retryDelivery ?? false,
    },
  };
}

function taxForCurrentQuantity(line: ShopifyLine, currency: string) {
  if (line.quantity <= 0 || line.currentQuantity <= 0) return 0;
  const originalTax = line.taxLines.reduce((sum, tax) => sum + moneyMinor(tax.priceSet, currency), 0);
  return Math.max(0, Math.round(originalTax * line.currentQuantity / line.quantity));
}

export function normalizeShopifyOrder(order: ShopifyOrder, connectionId: string): IntegrationOrderProposal {
  const currency = order.currencyCode.toUpperCase();
  const subtotalMinor = moneyMinor(order.currentSubtotalPriceSet, currency);
  const taxMinor = moneyMinor(order.currentTotalTaxSet, currency);
  const totalMinor = moneyMinor(order.currentTotalPriceSet, currency);
  const nonMerchandiseMinor = totalMinor - subtotalMinor - taxMinor;

  if (order.cancelledAt) {
    return {
      provider: "shopify",
      connectionId,
      externalOrderId: order.id,
      externalOrderName: order.name,
      externalUpdatedAt: order.updatedAt,
      state: "cancelled",
      currency,
      locationExternalId: null,
      locationExternalIds: [],
      subtotalMinor,
      taxMinor,
      totalMinor,
      nonMerchandiseMinor,
      lines: [],
      block: null,
    };
  }
  if (order.lineItems.pageInfo.hasNextPage || order.fulfillmentOrders.pageInfo.hasNextPage || order.fulfillmentOrders.nodes.some(fulfilment => fulfilment.lineItems.pageInfo.hasNextPage)) {
    return blockedProposal(order, connectionId, { code: "order_too_large", message: "Shopify order exceeds the bounded line or fulfilment-order import limit", retryable: false });
  }

  const activeLines = order.lineItems.nodes.filter(line => line.currentQuantity > 0);
  if (!activeLines.length) return blockedProposal(order, connectionId, { code: "no_operational_lines", message: "Shopify order has no current operational line quantity", retryable: false });
  const unsupported = activeLines.find(line => !line.requiresShipping);
  if (unsupported) return blockedProposal(order, connectionId, { code: "non_stock_line", message: `Shopify line ${unsupported.title} does not require shipping and cannot enter the stock-order workflow automatically`, retryable: false });
  const missingVariant = activeLines.find(line => !line.variant?.id);
  if (missingVariant) return blockedProposal(order, connectionId, { code: "missing_shopify_variant", message: `Shopify line ${missingVariant.title} no longer references a product variant`, retryable: false });

  const remainingByLine = new Map<string, number>();
  const locationsByLine = new Map<string, Set<string>>();
  const allLocations = new Set<string>();
  for (const fulfilment of order.fulfillmentOrders.nodes) {
    for (const item of fulfilment.lineItems.nodes) {
      if (item.remainingQuantity <= 0) continue;
      const locationId = fulfilment.assignedLocation.location?.id;
      if (!locationId) return blockedProposal(order, connectionId, { code: "routing_pending", message: "Shopify has not assigned a fulfilment location yet", retryDelivery: true });
      remainingByLine.set(item.lineItem.id, (remainingByLine.get(item.lineItem.id) || 0) + item.remainingQuantity);
      const locations = locationsByLine.get(item.lineItem.id) || new Set<string>();
      locations.add(locationId);
      locationsByLine.set(item.lineItem.id, locations);
      allLocations.add(locationId);
    }
  }
  if (!allLocations.size) return blockedProposal(order, connectionId, { code: "routing_pending", message: "Shopify fulfilment routing is not available yet", retryDelivery: true });
  if (allLocations.size > 1) return blockedProposal(order, connectionId, { code: "multiple_fulfilment_locations", message: "Shopify order is split across multiple fulfilment locations; Operating Layer currently requires one location per order", retryable: false });

  for (const line of activeLines) {
    const remaining = remainingByLine.get(line.id) || 0;
    if (remaining !== line.currentQuantity) {
      return blockedProposal(order, connectionId, {
        code: "external_fulfilment_progress",
        message: `Shopify line ${line.title} already has fulfilment progress outside Operating Layer; automatic reservation reconciliation is unsafe`,
        retryable: false,
      });
    }
    if ((locationsByLine.get(line.id)?.size || 0) !== 1) {
      return blockedProposal(order, connectionId, { code: "line_routing_ambiguous", message: `Shopify line ${line.title} does not resolve to exactly one fulfilment location`, retryDelivery: true });
    }
  }

  const locationExternalId = [...allLocations][0];
  const lines = activeLines.map(line => {
    const netMinor = moneyMinor(line.priceAfterAllDiscountsBeforeTaxesSet, currency);
    const merchandiseTaxMinor = taxForCurrentQuantity(line, currency);
    return {
      externalLineId: line.id,
      externalVariantId: line.variant!.id,
      quantity: line.currentQuantity,
      productNameSnapshot: line.title,
      variantNameSnapshot: line.variantTitle || "Default",
      skuSnapshot: line.sku || "",
      unitPriceMinor: Math.max(0, Math.round(netMinor / line.currentQuantity)),
      taxRateBps: netMinor > 0 ? Math.max(0, Math.round(merchandiseTaxMinor * 10_000 / netMinor)) : 0,
      netMinor,
      taxMinor: merchandiseTaxMinor,
      grossMinor: netMinor + merchandiseTaxMinor,
    };
  });
  const lineSubtotal = lines.reduce((sum, line) => sum + line.netMinor, 0);
  const lineTax = lines.reduce((sum, line) => sum + line.taxMinor, 0);
  if (lineSubtotal !== subtotalMinor) {
    return blockedProposal(order, connectionId, { code: "financial_reconciliation_failed", message: "Shopify merchandise subtotal does not reconcile to its current order subtotal", retryable: false });
  }
  if (lineTax > taxMinor) {
    return blockedProposal(order, connectionId, { code: "financial_reconciliation_failed", message: "Shopify merchandise tax exceeds the current order tax total", retryable: false });
  }

  return {
    provider: "shopify",
    connectionId,
    externalOrderId: order.id,
    externalOrderName: order.name,
    externalUpdatedAt: order.updatedAt,
    state: "active",
    currency,
    locationExternalId,
    locationExternalIds: [locationExternalId],
    subtotalMinor,
    taxMinor,
    totalMinor,
    nonMerchandiseMinor,
    lines,
    block: null,
  };
}

export async function fetchShopifyOrder(input: { shop: string; orderGid: string; accessToken: string; apiVersion: string; fetchImpl?: typeof fetch }) {
  const data = await shopifyAdminGraphql<{ order: ShopifyOrder | null }>({
    shop: input.shop,
    accessToken: input.accessToken,
    apiVersion: input.apiVersion,
    query: ORDER_QUERY,
    variables: { id: input.orderGid },
    fetchImpl: input.fetchImpl,
  });
  if (!data.order) throw new Error(`Shopify order ${input.orderGid} was not found`);
  return data.order;
}

export function shopifyOrderGidFromWebhookPayload(payload: Record<string, unknown>) {
  const graphqlId = typeof payload.admin_graphql_api_id === "string" ? payload.admin_graphql_api_id.trim() : "";
  if (/^gid:\/\/shopify\/Order\/\d+$/.test(graphqlId)) return graphqlId;
  const numericId = typeof payload.id === "number" || typeof payload.id === "string" ? String(payload.id).trim() : "";
  return /^\d+$/.test(numericId) ? `gid://shopify/Order/${numericId}` : null;
}

export function isShopifyOrderReceivedEvent(value: unknown): value is ShopifyOrderReceivedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.type === "shopify.order.received"
    && typeof event.eventId === "string"
    && typeof event.tenantId === "string"
    && typeof event.connectionId === "string"
    && typeof event.shop === "string"
    && typeof event.topic === "string"
    && ORDER_TOPICS.has(event.topic)
    && (event.orderGid === null || typeof event.orderGid === "string");
}

export async function processShopifyOrderReceived(event: ShopifyOrderReceivedEvent, env: ShopifyOrderProcessingEnv): Promise<ProcessingResult> {
  if (!event.orderGid) {
    const response = await tenantRequest(env, event.tenantId, "/__integrations/orders/process", {
      method: "POST",
      body: JSON.stringify({
        eventId: event.eventId,
        proposal: {
          provider: "shopify",
          connectionId: event.connectionId,
          externalOrderId: `event:${event.eventId}`,
          externalOrderName: "Unknown Shopify order",
          externalUpdatedAt: new Date().toISOString(),
          state: "active",
          currency: "GBP",
          locationExternalId: null,
          locationExternalIds: [],
          subtotalMinor: 0,
          taxMinor: 0,
          totalMinor: 0,
          nonMerchandiseMinor: 0,
          lines: [],
          block: { code: "missing_order_identity", message: "Shopify webhook did not include an order identity", retryable: false, retryDelivery: false },
        },
      }),
    });
    return response.json<ProcessingResult>();
  }

  const accessToken = await loadUsableCredential(env, event);
  const order = await fetchShopifyOrder({
    shop: event.shop,
    orderGid: event.orderGid,
    accessToken,
    apiVersion: env.SHOPIFY_API_VERSION,
  });
  const proposal = normalizeShopifyOrder(order, event.connectionId);
  const response = await tenantRequest(env, event.tenantId, "/__integrations/orders/process", {
    method: "POST",
    body: JSON.stringify({ eventId: event.eventId, proposal }),
  });
  const result = await response.json<ProcessingResult & { error?: string }>().catch(() => ({ outcome: "failed", retryDelivery: true, error: "Integration order processor returned an invalid response" }));
  if (!response.ok) return { ...result, retryDelivery: true };
  return result;
}
