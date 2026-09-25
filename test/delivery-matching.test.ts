import { describe, expect, it } from "vitest";
import { buildDeliveryProposal, type BuildDeliveryProposalInput } from "../src/worker/delivery-matching";

function baseInput(overrides: Partial<BuildDeliveryProposalInput> = {}): BuildDeliveryProposalInput {
  return {
    eventId: "delivery-1",
    sourceKey: "tenant-1/delivery-source/delivery-1",
    sourceName: "delivery-note.pdf",
    processedAt: "2026-09-25T13:00:00.000Z",
    sourceTruncated: false,
    sourceWarnings: [],
    purchaseOrderId: "po-1",
    purchaseOrderNumber: "PO-2026-000001",
    supplierId: "supplier-1",
    supplierName: "Acme Supply Ltd",
    locationId: "loc-1",
    locationName: "Main warehouse",
    purchaseOrderLines: [
      { id: "line-a", variantId: "variant-a", skuSnapshot: "WIDGET-A", descriptionSnapshot: "Widget · A", quantityOrdered: 10, quantityReceived: 2 },
      { id: "line-b", variantId: "variant-b", skuSnapshot: "WIDGET-B", descriptionSnapshot: "Widget · B", quantityOrdered: 4, quantityReceived: 0 },
    ],
    variants: [
      { id: "variant-a", sku: "WIDGET-A", barcode: "5011111111111" },
      { id: "variant-b", sku: "WIDGET-B", barcode: "5022222222222" },
    ],
    supplierVariants: [
      { supplierId: "supplier-1", variantId: "variant-a", supplierSku: "ACME-A" },
      { supplierId: "supplier-1", variantId: "variant-b", supplierSku: "ACME-B" },
    ],
    extracted: {
      supplier_reference: "DN-99",
      purchase_order_reference: "PO-2026-000001",
      document_date: "2026-09-25",
      lines: [
        { description: "Widget A", supplier_sku: "ACME-A", sku: "", barcode: "", quantity: 3 },
        { description: "Widget B", supplier_sku: "", sku: "", barcode: "5022222222222", quantity: 4 },
      ],
    },
    ...overrides,
  };
}

describe("delivery note matching", () => {
  it("creates a ready proposal from exact supplier SKU and barcode matches", () => {
    const proposal = buildDeliveryProposal(baseInput());

    expect(proposal.status).toBe("ready");
    expect(proposal.unexpectedLines).toEqual([]);
    expect(proposal.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineId: "line-a", extractedQuantity: 3, suggestedReceiveQuantity: 3, matchMethods: ["supplier_sku"] }),
      expect.objectContaining({ lineId: "line-b", extractedQuantity: 4, suggestedReceiveQuantity: 4, matchMethods: ["barcode"] }),
    ]));
  });

  it("allows a legitimate partial delivery while leaving missing lines outstanding", () => {
    const input = baseInput();
    input.extracted = { ...input.extracted, lines: [input.extracted.lines[0]] };

    const proposal = buildDeliveryProposal(input);

    expect(proposal.status).toBe("ready");
    const missing = proposal.lines.find(line => line.lineId === "line-b")!;
    expect(missing.suggestedReceiveQuantity).toBe(0);
    expect(missing.warnings).toContain("No quantity was extracted for this outstanding line; it will remain incoming.");
  });

  it("never suggests receiving more than the outstanding PO quantity", () => {
    const input = baseInput();
    input.extracted = { ...input.extracted, lines: [{ ...input.extracted.lines[0], quantity: 12 }] };

    const proposal = buildDeliveryProposal(input);

    const line = proposal.lines.find(item => item.lineId === "line-a")!;
    expect(line.remaining).toBe(8);
    expect(line.suggestedReceiveQuantity).toBe(8);
    expect(proposal.status).toBe("needs_review");
    expect(proposal.unexpectedLines.some(item => item.warnings.some(warning => warning.includes("exceeds the outstanding")))).toBe(true);
  });

  it("blocks ready status when the delivery note names another PO", () => {
    const input = baseInput();
    input.extracted = { ...input.extracted, purchase_order_reference: "PO-2026-999999" };

    const proposal = buildDeliveryProposal(input);

    expect(proposal.status).toBe("needs_review");
    expect(proposal.warnings.some(warning => warning.includes("not selected purchase order"))).toBe(true);
  });

  it("refuses conflicting exact identifiers instead of guessing", () => {
    const input = baseInput();
    input.extracted = {
      ...input.extracted,
      lines: [{ description: "Conflicting item", supplier_sku: "ACME-A", sku: "WIDGET-B", barcode: "", quantity: 1 }],
    };

    const proposal = buildDeliveryProposal(input);

    expect(proposal.status).toBe("needs_review");
    expect(proposal.unexpectedLines).toHaveLength(1);
    expect(proposal.unexpectedLines[0].warnings).toContain("Extracted identifiers disagree about which purchase-order variant this line represents.");
  });

  it("forces best-effort image extraction through human review", () => {
    const proposal = buildDeliveryProposal(baseInput({ sourceWarnings: ["Image conversion is best-effort."] }));

    expect(proposal.status).toBe("needs_review");
    expect(proposal.warnings).toContain("Image conversion is best-effort.");
  });
});
