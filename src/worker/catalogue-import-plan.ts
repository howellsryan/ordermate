import type {
  CatalogueImportExisting,
  CatalogueImportIssue,
  CatalogueImportPlan,
  CatalogueImportProductPlan,
  CatalogueImportRow,
  CatalogueImportVariantPlan,
} from "../shared/catalogue-import";

const MAX_IMPORT_ROWS = 2_000;

function normalizeName(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase();
}

function parseMinor(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 10_000_000) return undefined;
  return Math.round(numeric * 100);
}

function parseTaxBps(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined;
  return Math.round(numeric * 100);
}

function parseWhole(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 1_000_000) return undefined;
  return numeric;
}

function addIssue(issues: CatalogueImportIssue[], rowNumber: number | undefined, code: string, message: string) {
  issues.push({ rowNumber, code, message });
}

function duplicateValues(rows: CatalogueImportRow[], getter: (row: CatalogueImportRow) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = getter(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}

function canonicalRows(rows: CatalogueImportRow[]) {
  return rows.map(row => ({
    ...row,
    options: Object.fromEntries(Object.entries(row.options).sort(([a], [b]) => a.localeCompare(b))),
  }));
}

async function fingerprint(rows: CatalogueImportRow[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalRows(rows)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCatalogueImportPlan(rows: CatalogueImportRow[], existing: CatalogueImportExisting): Promise<CatalogueImportPlan> {
  const errors: CatalogueImportIssue[] = [];
  const warnings: CatalogueImportIssue[] = [];

  if (!rows.length) addIssue(errors, undefined, "empty_import", "The CSV contains no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) addIssue(errors, undefined, "too_many_rows", `A single import supports at most ${MAX_IMPORT_ROWS} rows.`);

  const existingProductNames = new Set(existing.products.map(product => normalizeName(product.name)));
  const existingSkus = new Set(existing.products.flatMap(product => product.variants.map(variant => normalizeIdentifier(variant.sku))).filter(Boolean));
  const existingBarcodes = new Set(existing.products.flatMap(product => product.variants.map(variant => (variant.barcode || "").trim())).filter(Boolean));
  const categoriesByName = new Map(existing.categories.map(category => [normalizeName(category.name), category]));
  const suppliersByName = new Map(existing.suppliers.map(supplier => [normalizeName(supplier.name), supplier]));
  const locationsByCode = new Map(existing.locations.map(location => [normalizeIdentifier(location.code), location]));

  const duplicateSkus = duplicateValues(rows, row => normalizeIdentifier(row.sku));
  const duplicateBarcodes = duplicateValues(rows, row => row.barcode.trim());

  const groups = new Map<string, CatalogueImportRow[]>();
  for (const row of rows) {
    const productName = row.productName.trim();
    const variantName = row.variantName.trim();
    const sku = normalizeIdentifier(row.sku);
    const barcode = row.barcode.trim();

    if (!productName) addIssue(errors, row.rowNumber, "product_name_required", "Product name is required.");
    if (!variantName) addIssue(errors, row.rowNumber, "variant_name_required", "Variant name is required.");
    if (!sku) addIssue(errors, row.rowNumber, "sku_required", "SKU is required.");
    if (sku && duplicateSkus.has(sku)) addIssue(errors, row.rowNumber, "duplicate_sku_in_file", `SKU ${row.sku.trim()} appears more than once in this CSV.`);
    if (sku && existingSkus.has(sku)) addIssue(errors, row.rowNumber, "sku_exists", `SKU ${row.sku.trim()} already exists in OrderMate.`);
    if (barcode && duplicateBarcodes.has(barcode)) addIssue(errors, row.rowNumber, "duplicate_barcode_in_file", `Barcode ${barcode} appears more than once in this CSV.`);
    if (barcode && existingBarcodes.has(barcode)) addIssue(errors, row.rowNumber, "barcode_exists", `Barcode ${barcode} already exists in OrderMate.`);

    const priceMinor = parseMinor(row.price);
    const costMinor = parseMinor(row.cost);
    const taxRateBps = parseTaxBps(row.taxPercent);
    const openingStock = parseWhole(row.openingStock);
    const supplierCostMinor = parseMinor(row.supplierCost);
    const leadTimeDays = parseWhole(row.leadTimeDays);

    if (priceMinor === undefined) addIssue(errors, row.rowNumber, "price_invalid", "Price must be a non-negative amount with at most two decimal places.");
    if (costMinor === undefined) addIssue(errors, row.rowNumber, "cost_invalid", "Cost must be a non-negative amount with at most two decimal places.");
    if (taxRateBps === undefined) addIssue(errors, row.rowNumber, "tax_invalid", "Tax percent must be between 0 and 100 with at most two decimal places.");
    if (openingStock === undefined) addIssue(errors, row.rowNumber, "opening_stock_invalid", "Opening stock must be a non-negative whole number.");
    if (supplierCostMinor === undefined) addIssue(errors, row.rowNumber, "supplier_cost_invalid", "Supplier cost must be a non-negative amount with at most two decimal places.");
    if (leadTimeDays === undefined) addIssue(errors, row.rowNumber, "lead_time_invalid", "Lead time must be a non-negative whole number of days.");

    if (priceMinor === null) addIssue(warnings, row.rowNumber, "price_defaulted", "Price is blank and will be imported as 0.00.");
    if (costMinor === null) addIssue(warnings, row.rowNumber, "cost_defaulted", "Cost is blank and will be imported as 0.00.");
    if (taxRateBps === null) addIssue(warnings, row.rowNumber, "tax_defaulted", "Tax percent is blank and will be imported as 0%.");

    if ((openingStock || 0) > 0) {
      const code = normalizeIdentifier(row.locationCode);
      if (!code) addIssue(errors, row.rowNumber, "location_required", "A location code is required when opening stock is greater than zero.");
      else if (!locationsByCode.has(code)) addIssue(errors, row.rowNumber, "location_unknown", `Location code ${row.locationCode.trim()} does not exist. Create the location first or correct the CSV.`);
    }

    const hasSupplierData = [row.supplierSku, row.supplierCost, row.leadTimeDays].some(value => value.trim());
    if (hasSupplierData && !row.supplierName.trim()) {
      addIssue(errors, row.rowNumber, "supplier_name_required", "Supplier name is required when supplier SKU, cost or lead time is provided.");
    }

    if (productName) {
      const key = normalizeName(productName);
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
  }

  const products: CatalogueImportProductPlan[] = [];
  const newCategoryNames = new Set<string>();
  const newSupplierNames = new Set<string>();
  let supplierMappingsToCreate = 0;
  let openingStockMovements = 0;
  let openingStockUnits = 0;

  for (const [productKey, productRows] of groups) {
    const first = productRows[0];
    if (existingProductNames.has(productKey)) {
      for (const row of productRows) addIssue(errors, row.rowNumber, "product_exists", `Product ${first.productName.trim()} already exists. This onboarding importer is create-only.`);
    }

    // Product-level metadata must be identical on every variant row, including
    // the distinction between blank and populated values. Otherwise the first
    // row could silently win and drop metadata supplied by a later row.
    const descriptionValues = new Set(productRows.map(row => row.description.trim()));
    const categoryValues = new Set(productRows.map(row => normalizeName(row.category)));
    if (descriptionValues.size > 1) {
      for (const row of productRows) addIssue(errors, row.rowNumber, "product_description_conflict", `Rows for ${first.productName.trim()} must use the same description, including whether it is blank.`);
    }
    if (categoryValues.size > 1) {
      for (const row of productRows) addIssue(errors, row.rowNumber, "product_category_conflict", `Rows for ${first.productName.trim()} must use the same category, including whether it is blank.`);
    }

    const categoryName = first.category.trim();
    const category = categoryName
      ? { existingCategoryId: categoriesByName.get(normalizeName(categoryName))?.id || null, name: categoryName }
      : null;
    if (category && !category.existingCategoryId) newCategoryNames.add(normalizeName(category.name));

    const variants: CatalogueImportVariantPlan[] = productRows.map(row => {
      const openingQuantity = parseWhole(row.openingStock) ?? 0;
      const location = openingQuantity > 0 ? locationsByCode.get(normalizeIdentifier(row.locationCode)) : undefined;
      const supplierName = row.supplierName.trim();
      const supplier = supplierName ? suppliersByName.get(normalizeName(supplierName)) : undefined;
      if (supplierName && !supplier) newSupplierNames.add(normalizeName(supplierName));
      if (supplierName) supplierMappingsToCreate += 1;
      if (openingQuantity > 0 && location) {
        openingStockMovements += 1;
        openingStockUnits += openingQuantity;
      }

      const variantCostMinor = parseMinor(row.cost);
      return {
        rowNumber: row.rowNumber,
        name: row.variantName.trim(),
        sku: normalizeIdentifier(row.sku),
        barcode: row.barcode.trim() || null,
        priceMinor: parseMinor(row.price) ?? 0,
        costMinor: variantCostMinor ?? 0,
        taxRateBps: parseTaxBps(row.taxPercent) ?? 0,
        options: Object.fromEntries(Object.entries(row.options).map(([name, value]) => [name.trim(), value.trim()]).filter(([name, value]) => name && value)),
        openingStock: openingQuantity > 0 && location ? { locationId: location.id, locationCode: location.code, quantity: openingQuantity } : null,
        supplier: supplierName ? {
          existingSupplierId: supplier?.id || null,
          supplierName,
          supplierSku: row.supplierSku.trim() || null,
          lastCostMinor: parseMinor(row.supplierCost) ?? variantCostMinor ?? 0,
          leadTimeDays: parseWhole(row.leadTimeDays),
        } : null,
      };
    });

    products.push({
      name: first.productName.trim(),
      description: first.description.trim() || null,
      category,
      variants,
    });
  }

  const planFingerprint = await fingerprint(rows);
  return {
    version: 1,
    rowCount: rows.length,
    fingerprint: planFingerprint,
    canCommit: errors.length === 0,
    errors,
    warnings,
    products,
    summary: {
      productsToCreate: products.length,
      variantsToCreate: products.reduce((sum, product) => sum + product.variants.length, 0),
      categoriesToCreate: newCategoryNames.size,
      suppliersToCreate: newSupplierNames.size,
      supplierMappingsToCreate,
      openingStockMovements,
      openingStockUnits,
    },
  };
}

export { MAX_IMPORT_ROWS };
