import type { DeliveryDiscrepancyEvidence } from "../shared/delivery-discrepancy";
import type { DeliveryProposal } from "./delivery-matching";

export type ReceivedDeliveryLine = { lineId: string; quantity: number };

function normalizeIdentifier(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

export function buildDeliveryDiscrepancyEvidence(
  proposalKey: string,
  proposal: DeliveryProposal,
  receivedLines: ReceivedDeliveryLine[],
): DeliveryDiscrepancyEvidence | null {
  const issues: DeliveryDiscrepancyEvidence["issues"] = [];
  const documentPoReference = proposal.extracted.purchaseOrderReference.trim();
  if (documentPoReference && normalizeIdentifier(documentPoReference) !== normalizeIdentifier(proposal.purchaseOrderNumber)) {
    issues.push({
      type: "reference_mismatch",
      documentPurchaseOrderReference: documentPoReference,
      expectedPurchaseOrderNumber: proposal.purchaseOrderNumber,
    });
  }

  for (const line of proposal.unexpectedLines) {
    issues.push({
      type: "unexpected_line",
      description: line.description,
      supplierSku: line.supplierSku,
      sku: line.sku,
      barcode: line.barcode,
      quantity: line.quantity,
      warnings: [...line.warnings],
    });
  }

  const receivedByLine = new Map(receivedLines.map(line => [line.lineId, line.quantity]));
  for (const line of proposal.lines) {
    const receivedQuantity = receivedByLine.get(line.lineId) || 0;
    if (receivedQuantity === line.extractedQuantity) continue;
    issues.push({
      type: "quantity_variance",
      lineId: line.lineId,
      sku: line.sku,
      description: line.description,
      documentQuantity: line.extractedQuantity,
      receivedQuantity,
    });
  }

  if (!issues.length) return null;
  return {
    version: 1,
    proposalKey,
    proposalEventId: proposal.eventId,
    purchaseOrderId: proposal.purchaseOrderId,
    purchaseOrderNumber: proposal.purchaseOrderNumber,
    documentReference: proposal.extracted.supplierReference,
    documentDate: proposal.extracted.documentDate,
    issues,
  };
}
