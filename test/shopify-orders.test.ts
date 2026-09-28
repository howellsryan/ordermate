import { describe, expect, it } from "vitest";
import { normalizeShopifyOrder, shopifyMoneyToMinor, shopifyOrderGidFromWebhookPayload } from "../src/worker/shopify-orders";

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Order/100",
    name: "#1001",
    updatedAt: "2026-09-28T12:00:00.000Z",
    cancelledAt: null,
    currencyCode: "GBP",
    currentSubtotalPriceSet: { shopMoney: { amount: "18.00", currencyCode: "GBP" } },
    currentTotalTaxSet: { shopMoney: { amount: "5.00", currencyCode: "GBP" } },
    currentTotalPriceSet: { shopMoney: { amount: "28.00", currencyCode: "GBP" } },
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/1",
        title: "Blue Tee",
        variantTitle: "Large",
        sku: "TEE-L",
        quantity: 2,
        currentQuantity: 2,
        requiresShipping: true,
        variant: { id: "gid://shopify/ProductVariant/1" },
        priceAfterAllDiscountsBeforeTaxesSet: { shopMoney: { amount: "18.00", currencyCode: "GBP" } },
        taxLines: [{ rate: 0.2, priceSet: { shopMoney: { amount: "4.00", currencyCode: "GBP" } } }],
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    fulfillmentOrders: {
      nodes: [{
        id: "gid://shopify/FulfillmentOrder/1",
        status: "OPEN",
        assignedLocation: { location: { id: "gid://shopify/Location/1", name: "Main" } },
        lineItems: {
          nodes: [{ remainingQuantity: 2, totalQuantity: 2, lineItem: { id: "gid://shopify/LineItem/1" } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...overrides,
  } as any;
}

describe("Shopify order normalization", () => {
  it("converts Shopify decimal money using the currency exponent", () => {
    expect(shopifyMoneyToMinor("12.34", "GBP")).toBe(1234);
    expect(shopifyMoneyToMinor("1250", "JPY")).toBe(1250);
  });

  it("preserves header totals while keeping shipping tax off merchandise lines", () => {
    const proposal = normalizeShopifyOrder(order(), "00000000-0000-4000-8000-000000000001");
    expect(proposal.block).toBeNull();
    expect(proposal.locationExternalId).toBe("gid://shopify/Location/1");
    expect(proposal.subtotalMinor).toBe(1800);
    expect(proposal.taxMinor).toBe(500);
    expect(proposal.totalMinor).toBe(2800);
    expect(proposal.nonMerchandiseMinor).toBe(500);
    expect(proposal.lines).toEqual([expect.objectContaining({
      externalVariantId: "gid://shopify/ProductVariant/1",
      quantity: 2,
      netMinor: 1800,
      taxMinor: 400,
      grossMinor: 2200,
      unitPriceMinor: 900,
    })]);
  });

  it("blocks multi-location orders instead of selecting a warehouse arbitrarily", () => {
    const value = order();
    value.fulfillmentOrders.nodes.push({
      id: "gid://shopify/FulfillmentOrder/2",
      status: "OPEN",
      assignedLocation: { location: { id: "gid://shopify/Location/2", name: "Secondary" } },
      lineItems: {
        nodes: [{ remainingQuantity: 1, totalQuantity: 1, lineItem: { id: "gid://shopify/LineItem/1" } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    const proposal = normalizeShopifyOrder(value, "00000000-0000-4000-8000-000000000001");
    expect(proposal.block).toMatchObject({ code: "multiple_fulfilment_locations", retryable: false, retryDelivery: false });
    expect(proposal.lines).toHaveLength(0);
  });

  it("blocks Shopify-side fulfilment progress so reservations cannot overstate demand", () => {
    const value = order();
    value.fulfillmentOrders.nodes[0].lineItems.nodes[0].remainingQuantity = 1;
    const proposal = normalizeShopifyOrder(value, "00000000-0000-4000-8000-000000000001");
    expect(proposal.block).toMatchObject({ code: "external_fulfilment_progress", retryable: false });
  });

  it("normalizes webhook REST identities to Shopify order GIDs", () => {
    expect(shopifyOrderGidFromWebhookPayload({ admin_graphql_api_id: "gid://shopify/Order/42" })).toBe("gid://shopify/Order/42");
    expect(shopifyOrderGidFromWebhookPayload({ id: 43 })).toBe("gid://shopify/Order/43");
    expect(shopifyOrderGidFromWebhookPayload({})).toBeNull();
  });
});
