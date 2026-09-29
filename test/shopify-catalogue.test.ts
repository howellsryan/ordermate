import { describe, expect, it, vi } from "vitest";
import { fetchShopifyLocations, fetchShopifyVariants, shopifyAdminGraphql } from "../src/worker/shopify-catalogue";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Shopify catalogue GraphQL client", () => {
  it("uses the configured Admin API version and access-token header", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-shopify-access-token")).toBe("token-123");
      expect(headers.get("content-type")).toBe("application/json");
      return jsonResponse({ data: { shop: { name: "Example" } } });
    }) as unknown as typeof fetch;

    const result = await shopifyAdminGraphql<{ shop: { name: string } }>({
      shop: "example.myshopify.com",
      accessToken: "token-123",
      apiVersion: "2026-07",
      query: "query { shop { name } }",
      fetchImpl,
    });
    expect(result.shop.name).toBe("Example");
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe("https://example.myshopify.com/admin/api/2026-07/graphql.json");
  });

  it("paginates variants without dropping SKU or barcode matching evidence", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse(String(init?.body)) as { variables: { after: string | null } };
      if (call === 1) {
        expect(body.variables.after).toBeNull();
        return jsonResponse({ data: { productVariants: {
          nodes: [{
            id: "gid://shopify/ProductVariant/1",
            title: "Blue",
            sku: "SKU-1",
            barcode: "BAR-1",
            updatedAt: "2026-09-28T06:00:00Z",
            product: { id: "gid://shopify/Product/1", title: "Tee", status: "ACTIVE" },
          }],
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        } } });
      }
      expect(body.variables.after).toBe("cursor-1");
      return jsonResponse({ data: { productVariants: {
        nodes: [{
          id: "gid://shopify/ProductVariant/2",
          title: "Default",
          sku: null,
          barcode: "BAR-2",
          updatedAt: "2026-09-28T06:05:00Z",
          product: { id: "gid://shopify/Product/2", title: "Mug", status: "ACTIVE" },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } });
    }) as unknown as typeof fetch;

    const variants = await fetchShopifyVariants({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      fetchImpl,
    });
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ sku: "SKU-1", barcode: "BAR-1" });
    expect(variants[1]).toMatchObject({ sku: null, barcode: "BAR-2" });
  });

  it("reads active and deactivated Shopify locations through the paginated locations query", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("includeInactive");
      return jsonResponse({ data: { locations: {
        nodes: [
          { id: "gid://shopify/Location/1", name: "Main Warehouse", deactivatedAt: null, address: { formatted: ["1 High Street"] } },
          { id: "gid://shopify/Location/2", name: "Old Shop", deactivatedAt: "2026-01-01T00:00:00Z", address: { formatted: [] } },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } });
    }) as unknown as typeof fetch;

    const locations = await fetchShopifyLocations({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      fetchImpl,
    });
    expect(locations.map(location => location.name)).toEqual(["Main Warehouse", "Old Shop"]);
    expect(locations[1]?.deactivatedAt).toBeTruthy();
  });

  it("fails closed on Shopify GraphQL errors instead of accepting partial discovery", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "Access denied for productVariants field." }] })) as unknown as typeof fetch;
    await expect(shopifyAdminGraphql({
      shop: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2026-07",
      query: "query { productVariants(first: 1) { nodes { id } } }",
      fetchImpl,
    })).rejects.toThrow("Access denied for productVariants field.");
  });
});
