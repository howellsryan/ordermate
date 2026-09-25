import Papa from "papaparse";
import type { CatalogueImportIssue, CatalogueImportRow } from "../shared/catalogue-import";

const REQUIRED_HEADERS = ["product_name", "variant_name", "sku"] as const;
const KNOWN_HEADERS = new Set([
  ...REQUIRED_HEADERS,
  "description",
  "category",
  "barcode",
  "price",
  "cost",
  "tax_percent",
  "location_code",
  "opening_stock",
  "supplier_name",
  "supplier_sku",
  "supplier_cost",
  "lead_time_days",
]);
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2_000;

export type ParsedCatalogueCsv = {
  rows: CatalogueImportRow[];
  errors: CatalogueImportIssue[];
  warnings: CatalogueImportIssue[];
  headers: string[];
};

export function parseCatalogueCsv(text: string): ParsedCatalogueCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: header => header.trim(),
  });
  const fields = result.meta.fields || [];
  const errors: CatalogueImportIssue[] = result.errors.map(error => ({
    rowNumber: typeof error.row === "number" ? error.row + 2 : undefined,
    code: `csv_${error.code || "parse_error"}`,
    message: error.message,
  }));
  const warnings: CatalogueImportIssue[] = [];

  for (const required of REQUIRED_HEADERS) {
    if (!fields.includes(required)) errors.push({ code: "header_required", message: `Required CSV header ${required} is missing.` });
  }
  const duplicateHeaders = (result.meta as { renamedHeaders?: Record<string, string> }).renamedHeaders;
  if (duplicateHeaders && Object.keys(duplicateHeaders).length) {
    errors.push({ code: "duplicate_headers", message: "The CSV contains duplicate column names. Make every header unique." });
  }

  for (const header of fields) {
    if (!header) continue;
    if (KNOWN_HEADERS.has(header) || header.startsWith("option:")) continue;
    errors.push({ code: "header_unknown", message: `Unknown CSV header ${header}. Remove it or use option:<name> for a product option dimension.` });
  }

  const optionHeaders = fields.filter(header => header.startsWith("option:"));
  for (const header of optionHeaders) {
    if (!header.slice("option:".length).trim()) errors.push({ code: "option_header_invalid", message: "Option columns must be named option:<name>, for example option:Size." });
  }
  if (result.data.length > MAX_ROWS) errors.push({ code: "too_many_rows", message: `A single catalogue import supports at most ${MAX_ROWS} data rows.` });

  const rows = result.data.slice(0, MAX_ROWS).map((source, index): CatalogueImportRow => {
    const value = (header: string) => String(source[header] ?? "").trim();
    return {
      rowNumber: index + 2,
      productName: value("product_name"),
      variantName: value("variant_name"),
      sku: value("sku"),
      description: value("description"),
      category: value("category"),
      barcode: value("barcode"),
      price: value("price"),
      cost: value("cost"),
      taxPercent: value("tax_percent"),
      options: Object.fromEntries(optionHeaders.map(header => [header.slice("option:".length).trim(), value(header)]).filter(([, optionValue]) => optionValue)),
      locationCode: value("location_code"),
      openingStock: value("opening_stock"),
      supplierName: value("supplier_name"),
      supplierSku: value("supplier_sku"),
      supplierCost: value("supplier_cost"),
      leadTimeDays: value("lead_time_days"),
    };
  });

  if (!rows.length && !errors.some(error => error.code === "csv_UndetectableDelimiter")) {
    errors.push({ code: "empty_import", message: "The CSV contains no data rows." });
  }
  if (!optionHeaders.length) {
    warnings.push({ code: "no_option_columns", message: "No option:<name> columns were provided. That is fine for products whose variant name is enough." });
  }

  return { rows, errors, warnings, headers: fields };
}

export async function parseCatalogueCsvFile(file: File) {
  if (file.size > MAX_CSV_BYTES) {
    return {
      rows: [], headers: [], warnings: [],
      errors: [{ code: "file_too_large", message: "CSV files must be 5 MB or smaller." }],
    } satisfies ParsedCatalogueCsv;
  }
  return parseCatalogueCsv(await file.text());
}

export const CATALOGUE_IMPORT_TEMPLATE = [
  "product_name,variant_name,sku,description,category,barcode,price,cost,tax_percent,option:Size,option:Colour,location_code,opening_stock,supplier_name,supplier_sku,supplier_cost,lead_time_days",
  'Classic Tee,Small / Navy,TEE-S-NAVY,"Core cotton t-shirt",Apparel,5010000000011,24.99,8.50,20,Small,Navy,MAIN,12,Acme Textiles,ACME-TEE-S-NV,7.90,7',
  'Classic Tee,Medium / Navy,TEE-M-NAVY,"Core cotton t-shirt",Apparel,5010000000028,24.99,8.50,20,Medium,Navy,MAIN,18,Acme Textiles,ACME-TEE-M-NV,7.90,7',
].join("\n");

export function downloadCatalogueImportTemplate() {
  const blob = new Blob([CATALOGUE_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ordermate-catalogue-import-template.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
