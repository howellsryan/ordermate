import type { CatalogueImportExisting, CatalogueImportRow } from "../shared/catalogue-import";
import { buildCatalogueImportPlan } from "./catalogue-import-plan";

function normalizeName(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase();
}

function stateForFingerprint(existing: CatalogueImportExisting) {
  return {
    products: existing.products
      .map(product => ({
        name: normalizeName(product.name),
        variants: product.variants
          .map(variant => ({ sku: normalizeIdentifier(variant.sku), barcode: (variant.barcode || "").trim() }))
          .sort((a, b) => a.sku.localeCompare(b.sku) || a.barcode.localeCompare(b.barcode)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: existing.categories.map(category => normalizeName(category.name)).sort(),
    suppliers: existing.suppliers.map(supplier => normalizeName(supplier.name)).sort(),
    locations: existing.locations.map(location => normalizeIdentifier(location.code)).sort(),
  };
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildReviewedCatalogueImportPlan(rows: CatalogueImportRow[], existing: CatalogueImportExisting) {
  const plan = await buildCatalogueImportPlan(rows, existing);
  return {
    ...plan,
    fingerprint: await sha256({ version: plan.version, rows, tenantState: stateForFingerprint(existing) }),
  };
}
