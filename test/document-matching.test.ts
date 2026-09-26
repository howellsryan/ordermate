import { describe, expect, it } from "vitest";
import { buildPurchaseProposal, type BuildProposalInput } from "../src/worker/document-matching";

function baseInput(overrides: Partial<BuildProposalInput> = {}): BuildProposalInput {
  return {
    eventId: "evt-1",
    sourceKey: "tenant-1/purchase-source/evt-1",
    sourceName: "supplier-po.pdf",
    processedAt: "2026-09-25T12:00:00.000Z",
    sourceTruncated: false,
    tenantCurrency: "GBP",
    extracted: {
      supplier_name: "Acme Supply Ltd",
      supplier_reference: "PO-EXT-22",
      document_date: "2026-09-24",
      currency: "GBP",
      lines: [{
        description: "Widget Large",
        supplier_sku: "ACME-LG",
        barcode: "",
        quantity: 4,
        unit_cost: "7.25",
        tax_rate_percent: "20",
      }],
    },
    suppliers: [{ id: "supplier-acme", name: "Acme Supply Ltd" }],
    variants: [{
      id: "variant-large",
      productId: "product-widget",
      productName: "Widget",
      variantName: "Large",
      sku: "WIDGET-L",
      barcode: "5012345678901",
      costMinor: 700,
      taxRateBps: 2000,
    }],
    supplierVariants: [{
      supplierId: "supplier-acme",
      supplierName: "Acme Supply Ltd",
      variantId: "variant-large",
      supplierSku: "ACME-LG",
      lastCostMinor: 710,
      leadTimeDays: 8,
    }],
    ...overrides,
  };
}

describe("purchase document matching", () => {
  it("marks a fully exact supplier/SKU extraction ready for human review", () => {
    const proposal = buildPurchaseProposal(baseInput());

    expect(proposal.status).toBe("ready");
    expect(proposal.supplierMatch).toEqual({
      supplierId: "supplier-acme",
      supplierName: "Acme Supply Ltd",
      method: "supplier_name",
    });
    expect(proposal.lines[0]).toMatchObject({
      quantity: 4,
      unitCostMinor: 725,
      mappedLastCostMinor: 710,
      taxRateBps: 2000,
      variantMatch: {
        variantId: "variant-large",
        method: "supplier_sku",
      },
    });
    expect(proposal.lines[0].warnings).toEqual([]);
  });

  it("does not fuzzy-match a similar supplier name", () => {
    const input = baseInput();
    input.extracted = { ...input.extracted, supplier_name: "Acme Supply Ltd UK", lines: [{ ...input.extracted.lines[0], supplier_sku: "" }] };
    input.supplierVariants = [];

    const proposal = buildPurchaseProposal(input);

    expect(proposal.supplierMatch).toBeNull();
    expect(proposal.status).toBe("needs_review");
    expect(proposal.warnings).toContain("Supplier could not be matched exactly.");
  });

  it("refuses an ambiguous supplier SKU instead of guessing a variant", () => {
    const input = baseInput({
      suppliers: [
        { id: "supplier-a", name: "Supplier A" },
        { id: "supplier-b", name: "Supplier B" },
      ],
      supplierVariants: [
        { supplierId: "supplier-a", supplierName: "Supplier A", variantId: "variant-large", supplierSku: "SHARED" },
        { supplierId: "supplier-b", supplierName: "Supplier B", variantId: "variant-other", supplierSku: "SHARED" },
      ],
      variants: [
        baseInput().variants[0],
        { ...baseInput().variants[0], id: "variant-other", productId: "product-other", productName: "Other", variantName: "Default", sku: "OTHER" },
      ],
    });
    input.extracted = {
      ...input.extracted,
      supplier_name: "",
      lines: [{ ...input.extracted.lines[0], supplier_sku: "SHARED", barcode: "" }],
    };

    const proposal = buildPurchaseProposal(input);

    expect(proposal.supplierMatch).toBeNull();
    expect(proposal.lines[0].variantMatch).toBeNull();
    expect(proposal.lines[0].warnings).toContain("Variant could not be matched exactly.");
    expect(proposal.status).toBe("needs_review");
  });

  it("falls back to exact barcode matching when supplier SKU cannot match", () => {
    const input = baseInput();
    input.extracted = {
      ...input.extracted,
      lines: [{ ...input.extracted.lines[0], supplier_sku: "UNKNOWN", barcode: "5012345678901" }],
    };

    const proposal = buildPurchaseProposal(input);

    expect(proposal.lines[0].variantMatch).toMatchObject({ variantId: "variant-large", method: "barcode" });
    expect(proposal.status).toBe("ready");
  });

  it("blocks ready status when extracted currency differs from the workspace", () => {
    const input = baseInput();
    input.extracted = { ...input.extracted, currency: "EUR" };

    const proposal = buildPurchaseProposal(input);

    expect(proposal.status).toBe("needs_review");
    expect(proposal.warnings.some(warning => warning.includes("does not match workspace currency GBP"))).toBe(true);
  });

  it("keeps missing commercial values explicit instead of inventing them", () => {
    const input = baseInput();
    input.extracted = {
      ...input.extracted,
      lines: [{ ...input.extracted.lines[0], unit_cost: "", tax_rate_percent: "" }],
    };

    const proposal = buildPurchaseProposal(input);

    expect(proposal.status).toBe("needs_review");
    expect(proposal.lines[0].unitCostMinor).toBeNull();
    expect(proposal.lines[0].taxRateBps).toBeNull();
    expect(proposal.lines[0].defaultTaxRateBps).toBe(2000);
    expect(proposal.lines[0].warnings).toEqual(expect.arrayContaining([
      "Net unit cost is missing or invalid.",
      "Tax rate was not extracted; the current variant tax can be reviewed as a fallback.",
    ]));
  });
});
