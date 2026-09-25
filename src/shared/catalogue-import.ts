export type CatalogueImportRow = {
  rowNumber: number;
  productName: string;
  variantName: string;
  sku: string;
  description: string;
  category: string;
  barcode: string;
  price: string;
  cost: string;
  taxPercent: string;
  options: Record<string, string>;
  locationCode: string;
  openingStock: string;
  supplierName: string;
  supplierSku: string;
  supplierCost: string;
  leadTimeDays: string;
};

export type CatalogueImportExisting = {
  products: Array<{
    id: string;
    name: string;
    variants: Array<{ id: string; sku: string; barcode?: string | null }>;
  }>;
  categories: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; code: string }>;
  supplierMappings: Array<{
    supplierId: string;
    supplierName: string;
    variantId: string;
    sku: string;
    supplierSku: string | null;
  }>;
  defaultTaxRateBps: number;
};

export type CatalogueImportIssue = {
  rowNumber?: number;
  code: string;
  message: string;
};

export type CatalogueImportVariantPlan = {
  rowNumber: number;
  name: string;
  sku: string;
  barcode: string | null;
  priceMinor: number;
  costMinor: number;
  taxRateBps: number;
  options: Record<string, string>;
  openingStock: null | { locationId: string; locationCode: string; quantity: number };
  supplier: null | {
    existingSupplierId: string | null;
    supplierName: string;
    supplierSku: string | null;
    lastCostMinor: number | null;
    leadTimeDays: number | null;
  };
};

export type CatalogueImportProductPlan = {
  name: string;
  description: string | null;
  category: null | { existingCategoryId: string | null; name: string };
  variants: CatalogueImportVariantPlan[];
};

export type CatalogueImportPlan = {
  version: 1;
  rowCount: number;
  fingerprint: string;
  canCommit: boolean;
  errors: CatalogueImportIssue[];
  warnings: CatalogueImportIssue[];
  products: CatalogueImportProductPlan[];
  summary: {
    productsToCreate: number;
    variantsToCreate: number;
    categoriesToCreate: number;
    suppliersToCreate: number;
    supplierMappingsToCreate: number;
    openingStockMovements: number;
    openingStockUnits: number;
  };
};

export type CatalogueImportPreviewRequest = {
  rows: CatalogueImportRow[];
};

export type CatalogueImportCommitRequest = {
  rows: CatalogueImportRow[];
  expectedFingerprint: string;
};

export type CatalogueImportCommitResponse = {
  ok: true;
  importId: string;
  summary: CatalogueImportPlan["summary"];
};
