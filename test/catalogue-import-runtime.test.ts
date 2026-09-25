import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CatalogueImportPlan, CatalogueImportRow } from "../src/shared/catalogue-import";
import type { TenantStore } from "../src/worker/tenant-store-imports";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`catalogue-import-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "import-owner",
    "x-ordermate-actor-role": "owner",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>();
  return { response, data };
}

function rows(): CatalogueImportRow[] {
  return [
    {
      rowNumber: 2,
      productName: "Imported Tee",
      variantName: "Small / Navy",
      sku: "IMP-TEE-S-NV",
      description: "Imported core tee",
      category: "Apparel",
      barcode: "5010000001018",
      price: "24.99",
      cost: "8.50",
      taxPercent: "20",
      options: { Size: "Small", Colour: "Navy" },
      locationCode: "MAIN",
      openingStock: "12",
      supplierName: "Acme Textiles",
      supplierSku: "ACME-S-NV",
      supplierCost: "7.90",
      leadTimeDays: "7",
    },
    {
      rowNumber: 3,
      productName: "Imported Tee",
      variantName: "Medium / Navy",
      sku: "IMP-TEE-M-NV",
      description: "Imported core tee",
      category: "Apparel",
      barcode: "5010000001025",
      price: "24.99",
      cost: "8.50",
      taxPercent: "20",
      options: { Size: "Medium", Colour: "Navy" },
      locationCode: "MAIN",
      openingStock: "18",
      supplierName: "Acme Textiles",
      supplierSku: "ACME-M-NV",
      supplierCost: "7.90",
      leadTimeDays: "7",
    },
  ];
}

describe("catalogue CSV import runtime", () => {
  it("previews then commits catalogue, mappings and opening stock atomically", async () => {
    const stub = tenant();
    const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main warehouse", code: "MAIN" });
    expect(location.response.status).toBe(201);

    const preview = await request<CatalogueImportPlan>(stub, "/imports/catalogue/preview", "POST", { rows: rows() });
    expect(preview.response.ok).toBe(true);
    expect(preview.data.canCommit).toBe(true);
    expect(preview.data.summary).toMatchObject({
      productsToCreate: 1,
      variantsToCreate: 2,
      categoriesToCreate: 1,
      suppliersToCreate: 1,
      supplierMappingsToCreate: 2,
      openingStockMovements: 2,
      openingStockUnits: 30,
    });

    const committed = await request<{ ok: true; importId: string }>(stub, "/imports/catalogue/commit", "POST", {
      rows: rows(),
      expectedFingerprint: preview.data.fingerprint,
    });
    expect(committed.response.status).toBe(201);
    expect(committed.data.ok).toBe(true);

    const products = await request<Array<{ name: string; category_name: string | null; variants: Array<{ sku: string; options: Record<string, string> }> }>>(stub, "/products");
    const product = products.data.find(item => item.name === "Imported Tee");
    expect(product?.category_name).toBe("Apparel");
    expect(product?.variants).toHaveLength(2);
    expect(product?.variants.find(variant => variant.sku === "IMP-TEE-S-NV")?.options).toEqual({ Colour: "Navy", Size: "Small" });

    const inventory = await request<Array<{ sku: string; location_id: string; on_hand: number; reserved: number }>>(stub, "/inventory");
    expect(inventory.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "IMP-TEE-S-NV", location_id: location.data.id, on_hand: 12, reserved: 0 }),
      expect.objectContaining({ sku: "IMP-TEE-M-NV", location_id: location.data.id, on_hand: 18, reserved: 0 }),
    ]));

    const mappings = await request<Array<{ supplier_name: string; supplier_sku: string; sku: string; lead_time_days: number }>>(stub, "/supplier-variants");
    expect(mappings.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier_name: "Acme Textiles", supplier_sku: "ACME-S-NV", sku: "IMP-TEE-S-NV", lead_time_days: 7 }),
      expect.objectContaining({ supplier_name: "Acme Textiles", supplier_sku: "ACME-M-NV", sku: "IMP-TEE-M-NV", lead_time_days: 7 }),
    ]));

    await runInDurableObject(stub, async (_instance, state) => {
      const movements = state.storage.sql.exec<{ reference_id: string; quantity_delta: number }>(
        "SELECT reference_id, quantity_delta FROM inventory_movements WHERE reference_type = 'catalogue_import' ORDER BY quantity_delta",
      ).toArray();
      expect(movements.map(item => item.quantity_delta)).toEqual([12, 18]);
      expect(new Set(movements.map(item => item.reference_id))).toEqual(new Set([committed.data.importId]));

      const audit = state.storage.sql.exec<{ entity_id: string; action: string }>(
        "SELECT entity_id, action FROM audit_events WHERE action = 'catalogue_import.committed' ORDER BY created_at DESC LIMIT 1",
      ).toArray()[0];
      expect(audit).toEqual({ entity_id: committed.data.importId, action: "catalogue_import.committed" });
    });
  });

  it("rejects commit when the reviewed preview is stale and leaves the import unapplied", async () => {
    const stub = tenant();
    await request(stub, "/locations", "POST", { name: "Main warehouse", code: "MAIN" });
    const importRows = rows();
    const preview = await request<CatalogueImportPlan>(stub, "/imports/catalogue/preview", "POST", { rows: importRows });
    expect(preview.data.canCommit).toBe(true);

    const competing = await request(stub, "/products", "POST", {
      name: "Competing product",
      variants: [{
        name: "Default",
        sku: "IMP-TEE-S-NV",
        barcode: "5999999999999",
        priceMinor: 100,
        costMinor: 50,
        taxRateBps: 2000,
        options: {},
      }],
    });
    expect(competing.response.status).toBe(201);

    const commit = await request<{ error: string; plan: CatalogueImportPlan }>(stub, "/imports/catalogue/commit", "POST", {
      rows: importRows,
      expectedFingerprint: preview.data.fingerprint,
    });
    expect(commit.response.status).toBe(409);
    expect(commit.data.error).toMatch(/stale/i);
    expect(commit.data.plan.canCommit).toBe(false);

    const products = await request<Array<{ name: string }>>(stub, "/products");
    expect(products.data.some(product => product.name === "Imported Tee")).toBe(false);
  });
});
