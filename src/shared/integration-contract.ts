export const INTEGRATION_PROVIDERS = ["shopify", "xero", "quickbooks"] as const;

export type IntegrationProvider = typeof INTEGRATION_PROVIDERS[number];

export type IntegrationCapability =
  | "catalogue:import"
  | "orders:import"
  | "returns:import"
  | "inventory:publish"
  | "fulfilments:publish"
  | "contacts:export"
  | "sales:export"
  | "purchases:export"
  | "payments:import";

export type IntegrationConnectionStatus =
  | "draft"
  | "connecting"
  | "active"
  | "paused"
  | "attention_required"
  | "disconnected";

export type IntegrationEventStatus =
  | "received"
  | "processing"
  | "applied"
  | "ignored"
  | "failed";

export type ExternalEntityType =
  | "product"
  | "variant"
  | "location"
  | "customer"
  | "order"
  | "return"
  | "fulfilment"
  | "inventory_level"
  | "invoice"
  | "purchase";

export type IntegrationDirection = "inbound" | "outbound";

export type IntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  externalAccountId: string;
  displayName: string;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapability[];
  createdAt: string;
  updatedAt: string;
};

export type IntegrationEventIdentity = {
  provider: IntegrationProvider;
  connectionId: string;
  providerEventId: string;
  topic: string;
};

export type ExternalEntityIdentity = {
  provider: IntegrationProvider;
  connectionId: string;
  entityType: ExternalEntityType;
  externalId: string;
};

export type IntegrationEventEnvelope<TPayload = unknown> = IntegrationEventIdentity & {
  externalAccountId: string;
  occurredAt: string | null;
  receivedAt: string;
  payload: TPayload;
};

export type IntegrationEntityLink = ExternalEntityIdentity & {
  localEntityType: string;
  localEntityId: string;
  externalUpdatedAt: string | null;
  lastSyncedAt: string;
};

export type IntegrationExceptionCode =
  | "unmapped_product"
  | "unmapped_location"
  | "invalid_payload"
  | "stale_event"
  | "conflicting_mapping"
  | "canonical_rejection"
  | "provider_error";

export type IntegrationException = {
  code: IntegrationExceptionCode;
  message: string;
  entity?: ExternalEntityIdentity;
  retryable: boolean;
};

function requiredPart(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

/**
 * Length-prefix each component so provider identifiers containing separators
 * cannot collide. These keys are suitable for UNIQUE database constraints and
 * idempotency lookups; they are not secrets and must never contain credentials.
 */
function framedKey(parts: string[]) {
  return parts.map(part => `${part.length}:${part}`).join("|");
}

export function integrationConnectionKey(provider: IntegrationProvider, externalAccountId: string) {
  return framedKey([
    provider,
    requiredPart(externalAccountId, "externalAccountId"),
  ]);
}

export function integrationEventKey(identity: IntegrationEventIdentity) {
  return framedKey([
    identity.provider,
    requiredPart(identity.connectionId, "connectionId"),
    requiredPart(identity.providerEventId, "providerEventId"),
  ]);
}

export function externalEntityKey(identity: ExternalEntityIdentity) {
  return framedKey([
    identity.provider,
    requiredPart(identity.connectionId, "connectionId"),
    identity.entityType,
    requiredPart(identity.externalId, "externalId"),
  ]);
}

export function normalizeShopifyShopDomain(value: string) {
  const trimmed = requiredPart(value, "shop domain");
  let hostname = trimmed.toLowerCase();

  if (/^https?:\/\//i.test(hostname)) {
    try {
      hostname = new URL(hostname).hostname.toLowerCase();
    } catch {
      throw new Error("Shopify shop domain is invalid");
    }
  }

  hostname = hostname.replace(/\.$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(hostname)) {
    throw new Error("Shopify shop domain must use the permanent *.myshopify.com domain");
  }
  return hostname;
}

/**
 * Integration code may request a canonical mutation, but the existing domain
 * service remains authoritative. This descriptor is deliberately data-only so
 * provider adapters cannot bypass inventory/order invariants with direct SQL.
 */
export type CanonicalMutationIntent = {
  domain: "orders" | "inventory" | "fulfilment" | "returns" | "crm" | "service";
  action: string;
  idempotencyKey: string;
  source: ExternalEntityIdentity;
  payload: unknown;
};
