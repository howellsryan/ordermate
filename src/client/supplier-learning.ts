import type { SupplierVariant } from "./model";

export type SupplierLearningDecision = {
  currentMapping?: SupplierVariant;
  conflictingMapping?: SupplierVariant;
  defaultSelected: boolean;
  disabled: boolean;
  label: string;
};

export function normalizeSupplierSku(value: string | null | undefined) {
  return (value || "").trim().normalize("NFKC").toLocaleUpperCase();
}

export function supplierLearningDecision(
  mappings: SupplierVariant[],
  supplierId: string,
  variantId: string,
  supplierSku: string,
): SupplierLearningDecision {
  const normalized = normalizeSupplierSku(supplierSku);
  if (!supplierId || !variantId || !normalized) {
    return { defaultSelected: false, disabled: true, label: "No supplier SKU to remember" };
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
