import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";
import { CURRENT_TENANT_SCHEMA_VERSION, migrateTenantSchema } from "../src/worker/tenant-store-versioned";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`policy-${crypto.randomUUID()}`);
}

function currentMigrationIds() {
  return Array.from({ length: CURRENT_TENANT_SCHEMA_VERSION }, (_, index) => index + 1);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "planner-user",
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

async function setup(stub: Stub) {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "North depot", code: `N${crypto.randomUUID().slice(0, 5)}` });
  expect(location.response.status).toBe(201);

  const sku = `POL-${crypto.randomUUID().slice(0, 8)}`;
  const product = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Policy product",
    variants: [{ name: "Default", sku, barcode: `50${Date.now()}`, priceMinor: 2000, costMinor: 900, taxRateBps: 2000, options: {} }],
  });
  expect(product.response.status).toBe(201);
  const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
  const variantId = products.data.flatMap(item => item.variants).find(item => item.sku === sku)!.id;

  const supplierA = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Fast supplier" });
  const supplierB = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Preferred supplier" });
  expect(supplierA.response.status).toBe(201);
  expect(supplierB.response.status).toBe(201);

  await request(stub, "/supplier-variants", "POST", { supplierId: supplierA.data.id, variantId, supplierSku: "FAST", lastCostMinor: 850, leadTimeDays: 2 });
  await request(stub, "/supplier-variants", "POST", { supplierId: supplierB.data.id, variantId, supplierSku: "PREF", lastCostMinor: 800, leadTimeDays: 10 });
  await request(stub, "/inventory/adjust", "POST", { variantId, locationId: location.data.id, quantityDelta: 2, reason: "Policy test stock" });

  return { locationId: location.data.id, variantId, preferredSupplierId: supplierB.data.id };
}

describe("tenant schema evolution", () => {
  it("records the complete migration chain and creates planning plus modular service schema", async () => {
    const stub = tenant();
    await request(stub, "/settings");

    await runInDurableObject(stub, async (_instance, state) => {
      const versions = state.storage.sql.exec<{ id: number }>("SELECT id FROM _sql_schema_migrations ORDER BY id").toArray();
      expect(versions.map(row => row.id)).toEqual(currentMigrationIds());
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_policies'").toArray()).toHaveLength(1);
      const poColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(purchase_orders)").toArray();
      expect(poColumns.some(column => column.name === "expected_delivery_date")).toBe(true);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name='purchase_orders_expected_delivery_idx'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_discrepancies'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name='delivery_discrepancies_po_status_idx'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_views'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name='saved_views_owner_page_idx'").toArray()).toHaveLength(1);
      const orderColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(orders)").toArray();
      expect(orderColumns.some(column => column.name === "required_by_date")).toBe(true);
      expect(orderColumns.some(column => column.name === "priority")).toBe(true);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name='orders_open_priority_due_idx'").toArray()).toHaveLength(1);
      const supplierVariantColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(supplier_variants)").toArray();
      expect(supplierVariantColumns.some(column => column.name === "minimum_order_quantity")).toBe(true);
      expect(supplierVariantColumns.some(column => column.name === "order_multiple")).toBe(true);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='crm_contacts'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='service_invoices'").toArray()).toHaveLength(1);
      const settingsColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(tenant_settings)").toArray();
      expect(settingsColumns.some(column => column.name === "invoice_address_json")).toBe(true);
    });
  });

  it("replays missing v2-latest migration markers without losing v1 business data", async () => {
    const stub = tenant();
    await setup(stub);

    await runInDurableObject(stub, async (_instance, state) => {
      const productCountBefore = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM products").toArray()[0].count;
      expect(productCountBefore).toBeGreaterThan(0);

      state.storage.transactionSync(() => {
        state.storage.sql.exec("DROP TABLE inventory_policies");
        state.storage.sql.exec("DROP TABLE delivery_discrepancies");
        state.storage.sql.exec("DROP TABLE saved_views");
        state.storage.sql.exec("DELETE FROM _sql_schema_migrations WHERE id >= 2");
      });
      expect(state.storage.sql.exec<{ id: number }>("SELECT id FROM _sql_schema_migrations ORDER BY id").toArray().map(row => row.id)).toEqual([1]);

      expect(migrateTenantSchema(state.storage)).toBe(CURRENT_TENANT_SCHEMA_VERSION);

      const versions = state.storage.sql.exec<{ id: number }>("SELECT id FROM _sql_schema_migrations ORDER BY id").toArray();
      expect(versions.map(row => row.id)).toEqual(currentMigrationIds());
      const productCountAfter = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM products").toArray()[0].count;
      expect(productCountAfter).toBe(productCountBefore);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_policies'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("PRAGMA table_info(purchase_orders)").toArray().some(column => column.name === "expected_delivery_date")).toBe(true);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_discrepancies'").toArray()).toHaveLength(1);
      expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_views'").toArray()).toHaveLength(1);
      const orderColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(orders)").toArray();
      expect(orderColumns.some(column => column.name === "required_by_date")).toBe(true);
      expect(orderColumns.some(column => column.name === "priority")).toBe(true);
      const supplierVariantColumns = state.storage.sql.exec<{ name: string }>("PRAGMA table_info(supplier_variants)").toArray();
      expect(supplierVariantColumns.some(column => column.name === "minimum_order_quantity")).toBe(true);
      expect(supplierVariantColumns.some(column => column.name === "order_multiple")).toBe(true);
    });
  });

  it("replays migration 3 safely when its DDL exists but later markers are missing", async () => {
    const stub = tenant();
    await request(stub, "/settings");

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.transactionSync(() => {
        state.storage.sql.exec("DROP TABLE delivery_discrepancies");
        state.storage.sql.exec("DROP TABLE saved_views");
        state.storage.sql.exec("DELETE FROM _sql_schema_migrations WHERE id >= 3");
      });
      expect(migrateTenantSchema(state.storage)).toBe(CURRENT_TENANT_SCHEMA_VERSION);
      const versions = state.storage.sql.exec<{ id: number }>("SELECT id FROM _sql_schema_migrations ORDER BY id").toArray();
      expect(versions.map(row => row.id)).toEqual(currentMigrationIds());
    });
  });

  it("replays migrations 4-latest idempotently when their DDL exists but markers are missing", async () => {
    const stub = tenant();
    await request(stub, "/settings");

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM _sql_schema_migrations WHERE id >= 4");
      expect(migrateTenantSchema(state.storage)).toBe(CURRENT_TENANT_SCHEMA_VERSION);
      const versions = state.storage.sql.exec<{ id: number }>("SELECT id FROM _sql_schema_migrations ORDER BY id").toArray();
      expect(versions.map(row => row.id)).toEqual(currentMigrationIds());
    });
  });
});

describe("replenishment policies", () => {
  it("persists an audited rule and uses its preferred supplier, reorder point and target", async () => {
    const stub = tenant();
    const setupData = await setup(stub);

    const saved = await request(stub, "/inventory-policies", "PUT", {
      variantId: setupData.variantId,
      locationId: setupData.locationId,
      reorderPoint: 4,
      targetStock: 15,
      preferredSupplierId: setupData.preferredSupplierId,
    });
    expect(saved.response.ok).toBe(true);

    const policies = await request<Array<{ reorder_point: number; target_stock: number; preferred_supplier_id: string | null }>>(stub, "/inventory-policies");
    expect(policies.data).toHaveLength(1);
    expect(policies.data[0]).toMatchObject({ reorder_point: 4, target_stock: 15, preferred_supplier_id: setupData.preferredSupplierId });

    const replenishment = await request<{ suggestions: Array<{ threshold: number; target_stock: number; recommended_quantity: number; effective_lead_time_days: number; suppliers: Array<{ supplierId: string; preferred: boolean }> }> }>(stub, "/replenishment");
    expect(replenishment.data.suggestions).toHaveLength(1);
    expect(replenishment.data.suggestions[0]).toMatchObject({
      threshold: 4,
      target_stock: 15,
      recommended_quantity: 13,
      effective_lead_time_days: 10,
    });
    expect(replenishment.data.suggestions[0].suppliers.find(supplier => supplier.preferred)?.supplierId).toBe(setupData.preferredSupplierId);

    await runInDurableObject(stub, async (_instance, state) => {
      const audit = state.storage.sql.exec<{ action: string; entity_type: string }>(
        "SELECT action, entity_type FROM audit_events WHERE action = 'inventory_policy.updated' ORDER BY created_at DESC LIMIT 1",
      ).toArray()[0];
      expect(audit).toEqual({ action: "inventory_policy.updated", entity_type: "inventory_policy" });
    });
  });

  it("rejects an unmapped preferred supplier and invalid target below reorder point", async () => {
    const stub = tenant();
    const setupData = await setup(stub);
    const otherSupplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Unmapped supplier" });

    const unmapped = await request<{ error: string }>(stub, "/inventory-policies", "PUT", {
      variantId: setupData.variantId,
      locationId: setupData.locationId,
      reorderPoint: 4,
      targetStock: 10,
      preferredSupplierId: otherSupplier.data.id,
    });
    expect(unmapped.response.status).toBe(409);

    const invalid = await request<{ error: string }>(stub, "/inventory-policies", "PUT", {
      variantId: setupData.variantId,
      locationId: setupData.locationId,
      reorderPoint: 10,
      targetStock: 5,
      preferredSupplierId: null,
    });
    expect(invalid.response.status).toBe(400);
  });

  it("removing a custom rule restores automatic defaults", async () => {
    const stub = tenant();
    const setupData = await setup(stub);
    await request(stub, "/inventory-policies", "PUT", {
      variantId: setupData.variantId,
      locationId: setupData.locationId,
      reorderPoint: 4,
      targetStock: 15,
      preferredSupplierId: setupData.preferredSupplierId,
    });

    const removed = await request(stub, `/inventory-policies/${encodeURIComponent(setupData.variantId)}/${encodeURIComponent(setupData.locationId)}`, "DELETE");
    expect(removed.response.ok).toBe(true);
    const policies = await request<unknown[]>(stub, "/inventory-policies");
    expect(policies.data).toEqual([]);

    const replenishment = await request<{ suggestions: Array<{ policy_custom: boolean }> }>(stub, "/replenishment");
    expect(replenishment.data.suggestions[0]?.policy_custom).toBe(false);
  });
});
