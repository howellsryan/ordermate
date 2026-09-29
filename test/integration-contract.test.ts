import { describe, expect, it } from "vitest";
import {
  externalEntityKey,
  integrationConnectionKey,
  integrationEventKey,
  normalizeShopifyShopDomain,
} from "../src/shared/integration-contract";

describe("integration contract", () => {
  it("creates stable connection identities without separator collisions", () => {
    const plain = integrationConnectionKey("shopify", "store:one");
    const different = integrationConnectionKey("shopify", "store|one");

    expect(plain).toBe(integrationConnectionKey("shopify", "store:one"));
    expect(plain).not.toBe(different);
  });

  it("deduplicates provider events within a connection without collapsing other connections", () => {
    const first = integrationEventKey({
      provider: "shopify",
      connectionId: "connection-a",
      providerEventId: "evt:123|orders/create",
      topic: "orders/create",
    });
    const retry = integrationEventKey({
      provider: "shopify",
      connectionId: "connection-a",
      providerEventId: "evt:123|orders/create",
      topic: "orders/create",
    });
    const anotherStore = integrationEventKey({
      provider: "shopify",
      connectionId: "connection-b",
      providerEventId: "evt:123|orders/create",
      topic: "orders/create",
    });

    expect(retry).toBe(first);
    expect(anotherStore).not.toBe(first);
  });

  it("scopes external entity mappings to both provider and connection", () => {
    const order = externalEntityKey({
      provider: "shopify",
      connectionId: "connection-a",
      entityType: "order",
      externalId: "gid://shopify/Order/123",
    });
    const sameIdElsewhere = externalEntityKey({
      provider: "shopify",
      connectionId: "connection-b",
      entityType: "order",
      externalId: "gid://shopify/Order/123",
    });

    expect(order).not.toBe(sameIdElsewhere);
  });

  it("normalizes the permanent Shopify shop domain used for routing", () => {
    expect(normalizeShopifyShopDomain("HTTPS://Example-Store.myshopify.com/path"))
      .toBe("example-store.myshopify.com");
    expect(normalizeShopifyShopDomain("example-store.myshopify.com"))
      .toBe("example-store.myshopify.com");
  });

  it("rejects custom domains and missing identity parts rather than creating ambiguous routes", () => {
    expect(() => normalizeShopifyShopDomain("shop.example.com"))
      .toThrow("permanent *.myshopify.com domain");
    expect(() => integrationEventKey({
      provider: "shopify",
      connectionId: " ",
      providerEventId: "evt-1",
      topic: "orders/create",
    })).toThrow("connectionId is required");
  });
});
