export type ExtractedDeliveryLine = {
  description: string;
  supplier_sku: string;
  sku: string;
  barcode: string;
  quantity: number;
};

export type ExtractedDeliveryDocument = {
  supplier_reference: string;
  purchase_order_reference: string;
  document_date: string;
  lines: ExtractedDeliveryLine[];
};

export type DeliveryPurchaseOrderLine = {
  id: string;
  variantId: string;
  skuSnapshot: string;
  descriptionSnapshot: string;
  quantityOrdered: number;
  quantityReceived: number;
};

export type DeliveryVariant = {
  id: string;
  sku: string;
  barcode?: string | null;
};

export type DeliverySupplierVariant = {
  supplierId: string;
  variantId: string;
  supplierSku?: string | null;
};

export type DeliveryProposalLine = {
  lineId: string;
  variantId: string;
  sku: string;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  remaining: number;
  extractedQuantity: number;
  suggestedReceiveQuantity: number;
  matchMethods: Array<"supplier_sku" | "barcode" | "internal_sku">;
  warnings: string[];
};

export type UnexpectedDeliveryLine = {
  index: number;
  description: string;
  supplierSku: string;
  sku: string;
  barcode: string;
  quantity: number | null;
  warnings: string[];
};

export type DeliveryProposal = {
  version: 1;
  eventId: string;
  status: "ready" | "needs_review";
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  extracted: {
    supplierReference: string;
    purchaseOrderReference: string;
    documentDate: string;
  };
  lines: DeliveryProposalLine[];
  unexpectedLines: UnexpectedDeliveryLine[];
  warnings: string[];
};

export type BuildDeliveryProposalInput = {
  eventId: string;
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  sourceWarnings?: string[];
  extracted: ExtractedDeliveryDocument;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  purchaseOrderLines: DeliveryPurchaseOrderLine[];
  variants: DeliveryVariant[];
  supplierVariants: DeliverySupplierVariant[];
};

function normalizeIdentifier(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

function validQuantity(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function unique<T>(values: T[]) {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function matchVariant(
  line: ExtractedDeliveryLine,
  input: BuildDeliveryProposalInput,
): { variantId: string; methods: DeliveryProposalLine["matchMethods"] } | { conflict: true } | undefined {
  const candidates: Array<{ variantId: string; method: DeliveryProposalLine["matchMethods"][number] }> = [];
  const supplierSku = normalizeIdentifier(line.supplier_sku);
  if (supplierSku) {
    for (const mapping of input.supplierVariants) {
      if (mapping.supplierId === input.supplierId && normalizeIdentifier(mapping.supplierSku) === supplierSku) {
        candidates.push({ variantId: mapping.variantId, method: "supplier_sku" });
      }
    }
  }

  const barcode = line.barcode.trim();
  if (barcode) {
    for (const variant of input.variants) {
      if ((variant.barcode || "").trim() === barcode) candidates.push({ variantId: variant.id, method: "barcode" });
    }
  }

  const sku = normalizeIdentifier(line.sku);
  if (sku) {
    for (const poLine of input.purchaseOrderLines) {
      if (normalizeIdentifier(poLine.skuSnapshot) === sku) candidates.push({ variantId: poLine.variantId, method: "internal_sku" });
    }
  }

  if (!candidates.length) return undefined;
  const variantId = unique(candidates.map(candidate => candidate.variantId));
  if (!variantId) return { conflict: true };
  if (!input.purchaseOrderLines.some(poLine => poLine.variantId === variantId)) return undefined;

  const methods = [...new Set(candidates.filter(candidate => candidate.variantId === variantId).map(candidate => candidate.method))];
  return { variantId, methods };
}

export function buildDeliveryProposal(input: BuildDeliveryProposalInput): DeliveryProposal {
  const warnings = [...(input.sourceWarnings || [])];
  if (input.sourceTruncated) warnings.push("Only the first part of the converted delivery note was supplied to extraction; compare against the source before receiving stock.");

  const extractedReference = normalizeIdentifier(input.extracted.purchase_order_reference);
  if (extractedReference && extractedReference !== normalizeIdentifier(input.purchaseOrderNumber)) {
    warnings.push(`Delivery note references ${input.extracted.purchase_order_reference.trim()}, not selected purchase order ${input.purchaseOrderNumber}.`);
  }

  const allocations = new Map<string, { quantity: number; methods: Set<DeliveryProposalLine["matchMethods"][number]> }>();
  const unexpectedLines: UnexpectedDeliveryLine[] = [];
  let blocker = false;

  input.extracted.lines.forEach((line, index) => {
    const quantity = validQuantity(line.quantity);
    const match = matchVariant(line, input);
    const lineWarnings: string[] = [];

    if (quantity === null) lineWarnings.push("Quantity is missing or is not a positive whole number.");
    if (!match) lineWarnings.push("Line could not be matched exactly to this purchase order.");
    if (match && "conflict" in match) lineWarnings.push("Extracted identifiers disagree about which purchase-order variant this line represents.");

    if (quantity === null || !match || "conflict" in match) {
      unexpectedLines.push({
        index,
        description: line.description.trim(),
        supplierSku: line.supplier_sku.trim(),
        sku: line.sku.trim(),
        barcode: line.barcode.trim(),
        quantity,
        warnings: lineWarnings,
      });
      blocker = true;
      return;
    }

    const allocation = allocations.get(match.variantId) || { quantity: 0, methods: new Set<DeliveryProposalLine["matchMethods"][number]>() };
    allocation.quantity += quantity;
    match.methods.forEach(method => allocation.methods.add(method));
    allocations.set(match.variantId, allocation);
  });

  const remainingAllocation = new Map([...allocations.entries()].map(([variantId, allocation]) => [variantId, allocation.quantity]));
  const lines: DeliveryProposalLine[] = input.purchaseOrderLines.map(poLine => {
    const remaining = Math.max(0, poLine.quantityOrdered - poLine.quantityReceived);
    const allocation = allocations.get(poLine.variantId);
    const stillToAllocate = remainingAllocation.get(poLine.variantId) || 0;
    const extractedQuantity = Math.min(stillToAllocate, remaining);
    remainingAllocation.set(poLine.variantId, Math.max(0, stillToAllocate - extractedQuantity));
    const warningsForLine: string[] = [];

    if (remaining > 0 && extractedQuantity === 0) warningsForLine.push("No quantity was extracted for this outstanding line; it will remain incoming.");

    return {
      lineId: poLine.id,
      variantId: poLine.variantId,
      sku: poLine.skuSnapshot,
      description: poLine.descriptionSnapshot,
      quantityOrdered: poLine.quantityOrdered,
      quantityReceived: poLine.quantityReceived,
      remaining,
      extractedQuantity,
      suggestedReceiveQuantity: extractedQuantity,
      matchMethods: allocation ? [...allocation.methods] : [],
      warnings: warningsForLine,
    };
  });

  for (const [variantId, quantity] of remainingAllocation) {
    if (quantity <= 0) continue;
    const poLines = input.purchaseOrderLines.filter(line => line.variantId === variantId);
    const allocation = allocations.get(variantId);
    unexpectedLines.push({
      index: input.extracted.lines.length + unexpectedLines.length,
      description: poLines[0]?.descriptionSnapshot || "Matched variant",
      supplierSku: "",
      sku: poLines[0]?.skuSnapshot || "",
      barcode: input.variants.find(variant => variant.id === variantId)?.barcode || "",
      quantity,
      warnings: [`Delivery quantity exceeds the outstanding purchase-order quantity by ${quantity}.`],
    });
    if (allocation) blocker = true;
  }

  const extractedTotal = input.extracted.lines.reduce((sum, line) => sum + (validQuantity(line.quantity) || 0), 0);
  const suggestedTotal = lines.reduce((sum, line) => sum + line.suggestedReceiveQuantity, 0);
  if (!input.extracted.lines.length) {
    warnings.push("No delivery-note lines were extracted.");
    blocker = true;
  }
  if (extractedTotal > 0 && suggestedTotal === 0) blocker = true;
  if (warnings.length > 0) blocker = true;

  return {
    version: 1,
    eventId: input.eventId,
    status: blocker ? "needs_review" : "ready",
    sourceKey: input.sourceKey,
    sourceName: input.sourceName,
    processedAt: input.processedAt,
    sourceTruncated: input.sourceTruncated,
    purchaseOrderId: input.purchaseOrderId,
    purchaseOrderNumber: input.purchaseOrderNumber,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    locationId: input.locationId,
    locationName: input.locationName,
    extracted: {
      supplierReference: input.extracted.supplier_reference.trim(),
      purchaseOrderReference: input.extracted.purchase_order_reference.trim(),
      documentDate: input.extracted.document_date.trim(),
    },
    lines,
    unexpectedLines,
    warnings,
  };
}
