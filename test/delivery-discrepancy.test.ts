import { describe, expect, it } from "vitest";
import type { DeliveryProposal } from "../src/worker/delivery-matching";
import { buildDeliveryDiscrepancyEvidence } from "../src/worker/delivery-discrepancy";

function proposal(overrides: Partial<DeliveryProposal> = {}): DeliveryProposal {
  return {
    version: 1,
    eventId: "event-1",
    status: "ready",
    sourceKey: "tenant/delivery-source/event-1",
    sourceName: "delivery.pdf",
    processedAt: "2026-09-25T12:00:00.000Z",
    sourceTruncated: false,
    purchaseOrderId: "po-1",
    purchaseOrderNumber: "PO-001",
    supplierId: "supplier-1",
    supplierName: "Acme",
    locationId: "loc-1",
    locationName: "Main",
    extracted: { supplierReference: "DN-100", purchaseOrderReference: "PO-001", documentDate: "2026-09-25" },
    lines: [
      {
        lineId: "line-1",
        variantId: "variant-1",
        sku: "SKU-1",
        description: "Widget",
        quantityOrdered: 10,
        quantityReceived: 0,
        remaining: 10,
        extractedQuantity: 5,
        suggestedReceiveQuantity: 5,
        matchMethods: ["supplier_sku"],
        warnings: [],
      },
    ],
    unexpectedLines: [],
    warnings: [],
    ...overrides,
  };
}

describe("delivery discrepancy evidence", () => {
  it("does not create a discrepancy for an ordinary partial delivery that matches the document", () => {
    const evidence = buildDeliveryDiscrepancyEvidence("tenant/delivery-proposal/event-1.json", proposal(), [{ lineId: "line-1", quantity: 5 }]);
    expect(evidence).toBeNull();
  });

  it("records the operator/document quantity variance", () => {
    const evidence = buildDeliveryDiscrepancyEvidence("tenant/delivery-proposal/event-1.json", proposal(), [{ lineId: "line-1", quantity: 4 }]);
    expect(evidence?.issues).toContainEqual({
      type: "quantity_variance",
      lineId: "line-1",
      sku: "SKU-1",
      description: "Widget",
      documentQuantity: 5,
      receivedQuantity: 4,
    });
  });

  it("records wrong PO references and unexpected/over-delivered document lines", () => {
    const evidence = buildDeliveryDiscrepancyEvidence(
      "tenant/delivery-proposal/event-1.json",
      proposal({
        status: "needs_review",
        extracted: { supplierReference: "DN-100", purchaseOrderReference: "PO-WRONG", documentDate: "2026-09-25" },
        unexpectedLines: [{
          index: 1,
          description: "Extra widget",
          supplierSku: "EXTRA",
          sku: "",
          barcode: "",
          quantity: 2,
          warnings: ["Delivery quantity exceeds the outstanding purchase-order quantity by 2."],
        }],
      }),
      [{ lineId: "line-1", quantity: 5 }],
    );

    expect(evidence?.issues.map(issue => issue.type)).toEqual(["reference_mismatch", "unexpected_line"]);
  });

  it("does not treat generic source review warnings as a physical discrepancy by themselves", () => {
    const evidence = buildDeliveryDiscrepancyEvidence(
      "tenant/delivery-proposal/event-1.json",
      proposal({ status: "needs_review", warnings: ["Image conversion is best-effort."] }),
      [{ lineId: "line-1", quantity: 5 }],
    );
    expect(evidence).toBeNull();
  });
});
