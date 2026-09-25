import { describe, expect, it } from "vitest";
import { buildPurchaseProposal } from "../src/worker/document-matching";

describe("purchase proposal source warnings", () => {
  it("keeps an otherwise exact image-derived proposal in needs-review state", () => {
    const proposal = buildPurchaseProposal({
      eventId: "evt-image",
      sourceKey: "tenant/purchase-source/evt-image",
      sourceName: "supplier-order.jpg",
      processedAt: "2026-09-25T12:00:00.000Z",
      sourceTruncated: false,
      sourceWarnings: ["Image conversion is best-effort. Compare every extracted value with the original image before creating a purchase order."],
      tenantCurrency: "GBP",
      extracted: {
        supplier_name: "Acme Supply Ltd",
        supplier_reference: "EXT-100",
        document_date: "2026-09-25",
        currency: "GBP",
        lines: [{
          description: "Large Widget",
          supplier_sku: "ACME-L",
          barcode: "5012345678901",
          quantity: 2,
          unit_cost: "7.25",
          tax_rate_percent: "20",
        }],
      },
      suppliers: [{ id: "supplier", name: "Acme Supply Ltd" }],
      variants: [{
        id: "variant",
        productId: "product",
        productName: "Widget",
        variantName: "Large",
        sku: "WIDGET-L",
        barcode: "5012345678901",
        costMinor: 700,
        taxRateBps: 2000,
      }],
      supplierVariants: [{
        supplierId: "supplier",
        supplierName: "Acme Supply Ltd",
        variantId: "variant",
        supplierSku: "ACME-L",
        lastCostMinor: 710,
        leadTimeDays: 7,
      }],
    });

    expect(proposal.supplierMatch?.supplierId).toBe("supplier");
    expect(proposal.lines[0].variantMatch?.variantId).toBe("variant");
    expect(proposal.status).toBe("needs_review");
    expect(proposal.warnings).toHaveLength(1);
  });
});
