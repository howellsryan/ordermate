import type { SupplierVariant } from "./model";

export type SupplierLearningDecision = {
  currentMapping?: SupplierVariant;
  conflictingMapping?: SupplierVariant;
  defaultSelected: boolean;
  disabled: boolean;
  label: string;
};

export type ReviewedSupplierSkuLine = {
  index: number;
  supplierSku: string;
  variantId: string;
};

export function normalizeSupplierSku(value: string | null | undefined) {
  return (value || "").trim().normalize("NFKC").toUpperCase();
}

export function reviewedSupplierSkuConflicts(lines: ReviewedSupplierSkuLine[]) {
  const variantsBySku = new Map<string, Set<string>>();
  for (const line of lines) {
    const sku = normalizeSupplierSku(line.supplierSku);
    if (!sku || !line.variantId) continue;
    const variants = variantsBySku.get(sku) || new Set<string>();
    variants.add(line.variantId);
    variantsBySku.set(sku, variants);
  }
  return new Set([...variantsBySku.entries()].filter(([, variants]) => variants.size > 1).map(([sku]) => sku));
}

export function supplierLearningDecision(
  mappings: SupplierVariant[],
  supplierId: string,
  variantId: string,
  supplierSku: string,
  reviewedConflict = false,
): SupplierLearningDecision {
  const normalized = normalizeSupplierSku(supplierSku);
  if (!supplierId || !variantId || !normalized) {
    return { defaultSelected: false, disabled: true, label: "No supplier SKU to remember" };
  }

  if (reviewedConflict) {
    return {
      defaultSelected: false,
      disabled: true,
      label: `Cannot remember ${supplierSku}: reviewed lines assign this supplier SKU to more than one variant`,
    };
  }

  const currentMapping = mappings.find(mapping => mapping.supplier_id === supplierId && mapping.variant_id === variantId);
  const conflictingMapping = mappings.find(mapping =>
    mapping.supplier_id === supplierId
    && mapping.variant_id !== variantId
    && normalizeSupplierSku(mapping.supplier_sku) === normalized,
  );

  if (conflictingMapping) {
    return {
      currentMapping,
      conflictingMapping,
      defaultSelected: false,
      disabled: true,
      label: `Cannot remember ${supplierSku}: it already maps to ${conflictingMapping.product_name} · ${conflictingMapping.variant_name}`,
    };
  }

  const remembered = normalizeSupplierSku(currentMapping?.supplier_sku);
  if (remembered && remembered !== normalized) {
    return {
      currentMapping,
      defaultSelected: false,
      disabled: false,
      label: `Replace remembered supplier SKU ${currentMapping?.supplier_sku} with ${supplierSku}`,
    };
  }

  if (remembered === normalized) {
    return {
      currentMapping,
      defaultSelected: true,
      disabled: false,
      label: `Keep supplier SKU ${supplierSku} remembered for future documents`,
    };
  }

  return {
    currentMapping,
    defaultSelected: true,
    disabled: false,
    label: `Remember supplier SKU ${supplierSku} for future documents`,
  };
}
