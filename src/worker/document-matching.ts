export type ExtractedPurchaseLine = {
  description: string;
  supplier_sku: string;
  barcode: string;
  quantity: number;
  unit_cost: string;
  tax_rate_percent: string;
};

export type ExtractedPurchaseDocument = {
  supplier_name: string;
  supplier_reference: string;
  document_date: string;
  currency: string;
  lines: ExtractedPurchaseLine[];
};

export type MatchingSupplier = {
  id: string;
  name: string;
};

export type MatchingVariant = {
  id: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode?: string | null;
  costMinor: number;
  taxRateBps: number;
};

export type MatchingSupplierVariant = {
  supplierId: string;
  supplierName: string;
  variantId: string;
  supplierSku?: string | null;
  lastCostMinor?: number | null;
  leadTimeDays?: number | null;
};

export type ProposalSupplierMatch = {
  supplierId: string;
  supplierName: string;
  method: "supplier_name" | "supplier_sku";
};

export type ProposalVariantMatch = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  method: "supplier_sku" | "barcode" | "internal_sku";
};

export type PurchaseProposalLine = {
  index: number;
  description: string;
  supplierSku: string;
  barcode: string;
  quantity: number | null;
  unitCostMinor: number | null;
  mappedLastCostMinor: number | null;
  taxRateBps: number | null;
  defaultTaxRateBps: number | null;
  variantMatch: ProposalVariantMatch | null;
  warnings: string[];
};

export type PurchaseProposal = {
  version: 1;
  eventId: string;
  status: "ready" | "needs_review";
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  extracted: {
    supplierName: string;
    supplierReference: string;
    documentDate: string;
    currency: string;
  };
  tenantCurrency: string;
  supplierMatch: ProposalSupplierMatch | null;
  lines: PurchaseProposalLine[];
  warnings: string[];
};

export type BuildProposalInput = {
  eventId: string;
  sourceKey: string;
  sourceName: string;
  processedAt: string;
  sourceTruncated: boolean;
  extracted: ExtractedPurchaseDocument;
  tenantCurrency: string;
  suppliers: MatchingSupplier[];
  variants: MatchingVariant[];
  supplierVariants: MatchingSupplierVariant[];
};

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeIdentifier(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

function unique<T>(values: T[]) {
  return values.length === 1 ? values[0] : undefined;
}

function parseMoneyMinor(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function parseTaxBps(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return null;
  return Math.round(amount * 100);
}

function validQuantity(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function exactSupplierFromName(extractedName: string, suppliers: MatchingSupplier[]) {
  const normalized = normalizeName(extractedName);
  if (!normalized) return undefined;
  return unique(suppliers.filter(supplier => normalizeName(supplier.name) === normalized));
}

function inferredSupplierFromSkus(extracted: ExtractedPurchaseDocument, mappings: MatchingSupplierVariant[], suppliers: MatchingSupplier[]) {
  const supplierIds = extracted.lines.flatMap(line => {
    const sku = normalizeIdentifier(line.supplier_sku);
    if (!sku) return [];
    const matchingMappings = mappings.filter(mapping => normalizeIdentifier(mapping.supplierSku) === sku);
    const onlyMapping = unique(matchingMappings);
    return onlyMapping ? [onlyMapping.supplierId] : [];
  });
  const distinct = [...new Set(supplierIds)];
  if (distinct.length !== 1) return undefined;
  return suppliers.find(supplier => supplier.id === distinct[0]);
}

function variantMatch(
  line: ExtractedPurchaseLine,
  supplierId: string | undefined,
  variants: MatchingVariant[],
  mappings: MatchingSupplierVariant[],
): { variant: MatchingVariant; method: ProposalVariantMatch["method"]; mapping?: MatchingSupplierVariant } | undefined {
  const supplierSku = normalizeIdentifier(line.supplier_sku);
  if (supplierSku) {
    const candidates = mappings.filter(mapping =>
      normalizeIdentifier(mapping.supplierSku) === supplierSku
      && (!supplierId || mapping.supplierId === supplierId),
    );
    const mapping = unique(candidates);
    if (mapping) {
      const variant = variants.find(item => item.id === mapping.variantId);
      if (variant) return { variant, method: "supplier_sku", mapping };
    }
  }

  const barcode = line.barcode.trim();
  if (barcode) {
    const variant = unique(variants.filter(item => (item.barcode || "").trim() === barcode));
    if (variant) return { variant, method: "barcode" };
  }

  const internalSku = normalizeIdentifier(line.supplier_sku);
  if (internalSku) {
    const variant = unique(variants.filter(item => normalizeIdentifier(item.sku) === internalSku));
    if (variant) return { variant, method: "internal_sku" };
  }

  return undefined;
}

export function buildPurchaseProposal(input: BuildProposalInput): PurchaseProposal {
  const warnings: string[] = [];
  const exactSupplier = exactSupplierFromName(input.extracted.supplier_name, input.suppliers);
  const inferredSupplier = exactSupplier ? undefined : inferredSupplierFromSkus(input.extracted, input.supplierVariants, input.suppliers);
  const supplier = exactSupplier || inferredSupplier;
  const supplierMatch: ProposalSupplierMatch | null = supplier ? {
    supplierId: supplier.id,
    supplierName: supplier.name,
    method: exactSupplier ? "supplier_name" : "supplier_sku",
  } : null;

  if (!supplierMatch) warnings.push("Supplier could not be matched exactly.");
  if (!input.extracted.lines.length) warnings.push("No purchase-order lines were extracted.");
  if (input.sourceTruncated) warnings.push("Only the first part of the converted document was supplied to extraction; review the source before creating a PO.");

  const extractedCurrency = input.extracted.currency.trim().toUpperCase();
  const tenantCurrency = input.tenantCurrency.trim().toUpperCase();
  if (extractedCurrency && extractedCurrency !== tenantCurrency) {
    warnings.push(`Document currency ${extractedCurrency} does not match workspace currency ${tenantCurrency}. Convert/review costs before creating a PO.`);
  }

  const lines: PurchaseProposalLine[] = input.extracted.lines.map((line, index) => {
    const match = variantMatch(line, supplier?.id, input.variants, input.supplierVariants);
    const quantity = validQuantity(line.quantity);
    const unitCostMinor = parseMoneyMinor(line.unit_cost);
    const taxRateBps = parseTaxBps(line.tax_rate_percent);
    const lineWarnings: string[] = [];

    if (!match) lineWarnings.push("Variant could not be matched exactly.");
    if (quantity === null) lineWarnings.push("Quantity is missing or is not a positive whole number.");
    if (unitCostMinor === null) lineWarnings.push("Net unit cost is missing or invalid.");
    if (taxRateBps === null) lineWarnings.push("Tax rate was not extracted; the current variant tax can be reviewed as a fallback.");

    const matchedMapping = match?.mapping || (match && supplier
      ? input.supplierVariants.find(mapping => mapping.supplierId === supplier.id && mapping.variantId === match.variant.id)
      : undefined);

    return {
      index,
      description: line.description.trim(),
      supplierSku: line.supplier_sku.trim(),
      barcode: line.barcode.trim(),
      quantity,
      unitCostMinor,
      mappedLastCostMinor: matchedMapping?.lastCostMinor ?? null,
      taxRateBps,
      defaultTaxRateBps: match?.variant.taxRateBps ?? null,
      variantMatch: match ? {
        variantId: match.variant.id,
        productId: match.variant.productId,
        productName: match.variant.productName,
        variantName: match.variant.variantName,
        sku: match.variant.sku,
        method: match.method,
      } : null,
      warnings: lineWarnings,
    };
  });

  const currencyMismatch = !!extractedCurrency && extractedCurrency !== tenantCurrency;
  const lineBlockers = lines.some(line => !line.variantMatch || line.quantity === null || line.unitCostMinor === null);
  const status: PurchaseProposal["status"] = supplierMatch && lines.length > 0 && !lineBlockers && !currencyMismatch && !input.sourceTruncated ? "ready" : "needs_review";

  return {
    version: 1,
    eventId: input.eventId,
    status,
    sourceKey: input.sourceKey,
    sourceName: input.sourceName,
    processedAt: input.processedAt,
    sourceTruncated: input.sourceTruncated,
    extracted: {
      supplierName: input.extracted.supplier_name.trim(),
      supplierReference: input.extracted.supplier_reference.trim(),
      documentDate: input.extracted.document_date.trim(),
      currency: extractedCurrency,
    },
    tenantCurrency,
    supplierMatch,
    lines,
    warnings,
  };
}
