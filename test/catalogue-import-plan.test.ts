import { describe, expect, it } from "vitest";
import type { CatalogueImportExisting, CatalogueImportRow } from "../src/shared/catalogue-import";
import { buildReviewedCatalogueImportPlan } from "../src/worker/catalogue-import-reviewed-plan";

function row(overrides: Partial<CatalogueImportRow> = {}): CatalogueImportRow {
  return {
    rowNumber: 2,
    productName: "Classic Tee",
    variantName: "Small / Navy",
    sku: "TEE-S-NAVY",
    description: "Core cotton t-shirt",
    category: "Apparel",
    barcode: "5010000000011",
    price: "24.99",
    cost: "8.50",
    taxPercent: "20",
    options: { Size: "Small", Colour: "Navy" },
    locationCode: "MAIN",
    openingStock: "12",
    supplierName: "Acme Textiles",
    supplierSku: "ACME-TEE-S-NV",
    supplierCost: "7.90",
    leadTimeDays: "7",
    ...overrides,
  };
}

function existing(overrides: Partial<CatalogueImportExisting> = {}): CatalogueImportExisting {
  return {
    products: [],
    categories: [],
    suppliers: [],
    locations: [{ id: "loc-main", name: "Main warehouse", code: "MAIN" }],
    ...overrides,
  };
}

describe("catalogue import planning", () => {
  it("groups variants into products and plans category, supplier mapping and opening stock", async () => {
    const rows = [
      row(),
      row({ rowNumber: 3, variantName: "Medium / Navy", sku: "TEE-M-NAVY", barcode: "5010000000028", options: { Size: "Medium", Colour: "Navy" }, openingStock: "18", supplierSku: "ACME-TEE-M-NV" }),
    ];

    const plan = await buildReviewedCatalogueImportPlan(rows, existing());

    expect(plan.canCommit).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].variants).toHaveLength(2);
    expect(plan.products[0].variants[0].options).toEqual({ Size: "Small", Colour: "Navy" });
    expect(plan.summary).toEqual({
      productsToCreate: 1,
      variantsToCreate: 2,
      categoriesToCreate: 1,
      suppliersToCreate: 1,
      supplierMappingsToCreate: 2,
      openingStockMovements: 2,
      openingStockUnits: 30,
    });
  });

  it("refuses duplicate SKU and barcode values inside the same file", async () => {
    const duplicate = row({ rowNumber: 3, variantName: "Duplicate", openingStock: "0" });
    const plan = await buildReviewedCatalogueImportPlan([row(), duplicate], existing());

    expect(plan.canCommit).toBe(false);
    expect(plan.errors.filter(issue => issue.code === "duplicate_sku_in_file")).toHaveLength(2);
    expect(plan.errors.filter(issue => issue.code === "duplicate_barcode_in_file")).toHaveLength(2);
  });

  it("refuses SKUs/barcodes/products that already exist in the tenant", async () => {
    const plan = await buildReviewedCatalogueImportPlan([row()], existing({
      products: [{ id: "product-existing", name: "Classic Tee", variants: [{ id: "variant-existing", sku: "TEE-S-NAVY", barcode: "5010000000011" }] }],
    }));

    expect(plan.canCommit).toBe(false);
    expect(plan.errors.map(issue => issue.code)).toEqual(expect.arrayContaining(["product_exists", "sku_exists", "barcode_exists"]));
  });

  it("requires an existing location when opening stock is supplied", async () => {
    const plan = await buildReviewedCatalogueImportPlan([row({ locationCode: "TYPO" })], existing());

    expect(plan.canCommit).toBe(false);
    expect(plan.errors).toContainEqual(expect.objectContaining({ rowNumber: 2, code: "location_unknown" }));
  });

  it("refuses conflicting category/description metadata across variants of one product", async () => {
    const plan = await buildReviewedCatalogueImportPlan([
      row(),
      row({ rowNumber: 3, sku: "TEE-M", barcode: "5010000000099", variantName: "Medium", category: "Different", description: "Different copy", openingStock: "0" }),
    ], existing());

    expect(plan.canCommit).toBe(false);
    expect(plan.errors.map(issue => issue.code)).toEqual(expect.arrayContaining(["product_category_conflict", "product_description_conflict"]));
  });

  it("treats blank versus populated product metadata as a conflict instead of silently taking the first row", async () => {
    const plan = await buildReviewedCatalogueImportPlan([
      row({ category: "", description: "" }),
      row({ rowNumber: 3, sku: "TEE-M", barcode: "5010000000099", variantName: "Medium", openingStock: "0" }),
    ], existing());

    expect(plan.canCommit).toBe(false);
    expect(plan.errors.map(issue => issue.code)).toEqual(expect.arrayContaining(["product_category_conflict", "product_description_conflict"]));
  });

  it("uses existing exact category/supplier identities instead of planning duplicates", async () => {
    const plan = await buildReviewedCatalogueImportPlan([row()], existing({
      categories: [{ id: "cat-apparel", name: " apparel " }],
      suppliers: [{ id: "supplier-acme", name: "ACME TEXTILES" }],
    }));

    expect(plan.canCommit).toBe(true);
    expect(plan.summary.categoriesToCreate).toBe(0);
    expect(plan.summary.suppliersToCreate).toBe(0);
    expect(plan.products[0].category?.existingCategoryId).toBe("cat-apparel");
    expect(plan.products[0].variants[0].supplier?.existingSupplierId).toBe("supplier-acme");
  });

  it("changes the reviewed fingerprint when relevant tenant state changes", async () => {
    const rows = [row()];
    const before = await buildReviewedCatalogueImportPlan(rows, existing());
    const after = await buildReviewedCatalogueImportPlan(rows, existing({ categories: [{ id: "cat", name: "Apparel" }] }));

    expect(before.fingerprint).not.toBe(after.fingerprint);
  });
});
