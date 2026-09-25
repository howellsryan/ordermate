import { z } from "zod";
import type {
  CatalogueImportCommitRequest,
  CatalogueImportCommitResponse,
  CatalogueImportExisting,
  CatalogueImportPreviewRequest,
  CatalogueImportRow,
} from "../shared/catalogue-import";
import { buildReviewedCatalogueImportPlan } from "./catalogue-import-reviewed-plan";
import { TenantStore as PlanningTenantStore } from "./tenant-store-planning";
import type { TenantEnv } from "./tenant-store";

const rowSchema = z.object({
  rowNumber: z.number().int().min(2).max(1_000_000),
  productName: z.string().max(240),
  variantName: z.string().max(240),
  sku: z.string().max(160),
  description: z.string().max(4_000),
  category: z.string().max(240),
  barcode: z.string().max(240),
  price: z.string().max(80),
  cost: z.string().max(80),
  taxPercent: z.string().max(80),
  options: z.record(z.string().max(120), z.string().max(240)),
  locationCode: z.string().max(120),
  openingStock: z.string().max(80),
  supplierName: z.string().max(240),
  supplierSku: z.string().max(240),
  supplierCost: z.string().max(80),
  leadTimeDays: z.string().max(80),
});

const previewSchema = z.object({ rows: z.array(rowSchema).max(2_000) });
const commitSchema = previewSchema.extend({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });

type ProductRow = { id: string; name: string; variant_id: string | null; sku: string | null; barcode: string | null };
type NamedRow = { id: string; name: string };
type LocationRow = { id: string; name: string; code: string };
type SupplierMappingSnapshotRow = { supplier_id: string; supplier_name: string; variant_id: string; sku: string; supplier_sku: string | null };
type TableInfoRow = { name: string };

class ImportStaleError extends Error {}
class ImportSchemaError extends Error {}

function normalizeName(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase();
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

/**
 * CSV onboarding layer. Preview is side-effect free. Commit re-previews against
 * live tenant state, then performs every canonical write in one SQLite
 * transaction so a failed row cannot leave a partial catalogue/opening stock.
 */
export class TenantStore extends PlanningTenantStore {
  private readonly importCtx: DurableObjectState;
  private readonly columnCache = new Map<string, Set<string>>();

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.importCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "POST" && path === "/imports/catalogue/preview") {
      return this.previewImport(request);
    }
    if (request.method === "POST" && path === "/imports/catalogue/commit") {
      return this.commitImport(request);
    }

    return super.fetch(request);
  }

  private async parseRows(request: Request, commit = false) {
    try {
      const body = await request.json();
      return commit ? commitSchema.parse(body) : previewSchema.parse(body);
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        return Response.json({ error: cause.issues[0]?.message || "Invalid catalogue import payload" }, { status: 400 });
      }
      throw cause;
    }
  }

  private snapshot(): CatalogueImportExisting {
    const sql = this.importCtx.storage.sql;
    const rows = sql.exec<ProductRow>(
      `SELECT p.id, p.name, v.id AS variant_id, v.sku, v.barcode
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id`,
    ).toArray();
    const productsById = new Map<string, CatalogueImportExisting["products"][number]>();
    for (const row of rows) {
      const product = productsById.get(row.id) || { id: row.id, name: row.name, variants: [] };
      if (row.variant_id && row.sku) product.variants.push({ id: row.variant_id, sku: row.sku, barcode: row.barcode });
      productsById.set(row.id, product);
    }

    const supplierMappings = sql.exec<SupplierMappingSnapshotRow>(
      `SELECT sv.supplier_id,
              s.name AS supplier_name,
              sv.variant_id,
              v.sku,
              sv.supplier_sku
       FROM supplier_variants sv
       JOIN suppliers s ON s.id = sv.supplier_id
       JOIN product_variants v ON v.id = sv.variant_id`,
    ).toArray();
    const settings = sql.exec<{ default_tax_rate_bps: number }>(
      "SELECT default_tax_rate_bps FROM tenant_settings WHERE id = 1",
    ).toArray()[0];

    return {
      products: [...productsById.values()],
      categories: sql.exec<NamedRow>("SELECT id, name FROM categories").toArray(),
      suppliers: sql.exec<NamedRow>("SELECT id, name FROM suppliers").toArray(),
      locations: sql.exec<LocationRow>("SELECT id, name, code FROM locations WHERE active = 1").toArray(),
      supplierMappings: supplierMappings.map(mapping => ({
        supplierId: mapping.supplier_id,
        supplierName: mapping.supplier_name,
        variantId: mapping.variant_id,
        sku: mapping.sku,
        supplierSku: mapping.supplier_sku,
      })),
      defaultTaxRateBps: settings?.default_tax_rate_bps ?? 0,
    };
  }

  private async previewImport(request: Request) {
    const parsed = await this.parseRows(request);
    if (parsed instanceof Response) return parsed;
    const body = parsed as CatalogueImportPreviewRequest;
    return Response.json(await buildReviewedCatalogueImportPlan(body.rows, this.snapshot()));
  }

  private importActor(request: Request) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) throw new Error("Missing authenticated actor context");
    return { actorId, actorRole };
  }

  private columns(table: string) {
    const cached = this.columnCache.get(table);
    if (cached) return cached;
    const columns = new Set(this.importCtx.storage.sql.exec<TableInfoRow>(`PRAGMA table_info(${table})`).toArray().map(row => row.name));
    if (!columns.size) throw new ImportSchemaError(`Import target table ${table} does not exist`);
    this.columnCache.set(table, columns);
    return columns;
  }

  private insertFlexible(table: string, values: Record<string, unknown>, required: string[]) {
    const available = this.columns(table);
    for (const column of required) {
      if (!available.has(column)) throw new ImportSchemaError(`Import target ${table} is missing required column ${column}`);
    }
    const entries = Object.entries(values).filter(([column]) => available.has(column));
    const columns = entries.map(([column]) => column);
    const placeholders = columns.map(() => "?").join(", ");
    this.importCtx.storage.sql.exec(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
      ...entries.map(([, value]) => value),
    );
  }

  private variantOptionColumns() {
    const columns = this.columns("variant_option_values");
    const nameColumn = columns.has("option_name") ? "option_name" : columns.has("name") ? "name" : null;
    const valueColumn = columns.has("option_value") ? "option_value" : columns.has("value") ? "value" : null;
    if (!nameColumn || !valueColumn || !columns.has("variant_id")) {
      throw new ImportSchemaError("variant_option_values does not expose the expected option name/value columns");
    }
    return { nameColumn, valueColumn, hasId: columns.has("id") };
  }

  private assertStillCreateOnly(rows: CatalogueImportRow[]) {
    const current = this.snapshot();
    const productNames = new Set(current.products.map(product => normalizeName(product.name)));
    const skus = new Set(current.products.flatMap(product => product.variants.map(variant => normalizeIdentifier(variant.sku))));
    const barcodes = new Set(current.products.flatMap(product => product.variants.map(variant => (variant.barcode || "").trim())).filter(Boolean));
    for (const row of rows) {
      if (productNames.has(normalizeName(row.productName))) throw new ImportStaleError(`Product ${row.productName.trim()} now exists`);
      if (skus.has(normalizeIdentifier(row.sku))) throw new ImportStaleError(`SKU ${row.sku.trim()} now exists`);
      if (row.barcode.trim() && barcodes.has(row.barcode.trim())) throw new ImportStaleError(`Barcode ${row.barcode.trim()} now exists`);
    }
  }

  private async commitImport(request: Request) {
    const parsed = await this.parseRows(request, true);
    if (parsed instanceof Response) return parsed;
    const body = parsed as CatalogueImportCommitRequest;
    const actor = this.importActor(request);
    const reviewedPlan = await buildReviewedCatalogueImportPlan(body.rows, this.snapshot());

    if (reviewedPlan.fingerprint !== body.expectedFingerprint) {
      return Response.json({ error: "Import preview is stale. Review the updated dry-run before committing.", plan: reviewedPlan }, { status: 409 });
    }
    if (!reviewedPlan.canCommit) {
      return Response.json({ error: "Import contains validation errors", plan: reviewedPlan }, { status: 409 });
    }

    const importId = id();
    const timestamp = now();

    try {
      this.importCtx.storage.transactionSync(() => {
        this.assertStillCreateOnly(body.rows);
        const sql = this.importCtx.storage.sql;
        const categories = new Map(sql.exec<NamedRow>("SELECT id, name FROM categories").toArray().map(row => [normalizeName(row.name), row.id]));
        const suppliers = new Map(sql.exec<NamedRow>("SELECT id, name FROM suppliers").toArray().map(row => [normalizeName(row.name), row.id]));
        const locations = new Map(sql.exec<LocationRow>("SELECT id, name, code FROM locations WHERE active = 1").toArray().map(row => [normalizeIdentifier(row.code), row.id]));
        const optionColumns = reviewedPlan.products.some(product => product.variants.some(variant => Object.keys(variant.options).length)) ? this.variantOptionColumns() : null;

        for (const product of reviewedPlan.products) {
          let categoryId: string | null = null;
          if (product.category) {
            const key = normalizeName(product.category.name);
            categoryId = categories.get(key) || null;
            if (!categoryId) {
              categoryId = id();
              this.insertFlexible("categories", {
                id: categoryId,
                name: product.category.name,
                created_at: timestamp,
                updated_at: timestamp,
              }, ["id", "name"]);
              categories.set(key, categoryId);
            }
          }

          const productId = id();
          this.insertFlexible("products", {
            id: productId,
            category_id: categoryId,
            name: product.name,
            description: product.description,
            status: "active",
            created_at: timestamp,
            updated_at: timestamp,
          }, ["id", "name"]);

          for (const variant of product.variants) {
            const variantId = id();
            this.insertFlexible("product_variants", {
              id: variantId,
              product_id: productId,
              name: variant.name,
              sku: variant.sku,
              barcode: variant.barcode,
              price_minor: variant.priceMinor,
              cost_minor: variant.costMinor,
              tax_rate_bps: variant.taxRateBps,
              active: 1,
              options_json: JSON.stringify(variant.options),
              created_at: timestamp,
              updated_at: timestamp,
            }, ["id", "product_id", "name", "sku", "price_minor", "cost_minor", "tax_rate_bps", "active"]);

            if (optionColumns) {
              for (const [optionName, optionValue] of Object.entries(variant.options)) {
                this.insertFlexible("variant_option_values", {
                  ...(optionColumns.hasId ? { id: id() } : {}),
                  variant_id: variantId,
                  [optionColumns.nameColumn]: optionName,
                  [optionColumns.valueColumn]: optionValue,
                  created_at: timestamp,
                }, ["variant_id", optionColumns.nameColumn, optionColumns.valueColumn]);
              }
            }

            if (variant.supplier) {
              const supplierKey = normalizeName(variant.supplier.supplierName);
              let supplierId = suppliers.get(supplierKey) || null;
              if (!supplierId) {
                supplierId = id();
                this.insertFlexible("suppliers", {
                  id: supplierId,
                  name: variant.supplier.supplierName,
                  email: null,
                  phone: null,
                  notes: "Created by catalogue CSV import",
                  active: 1,
                  created_at: timestamp,
                  updated_at: timestamp,
                }, ["id", "name"]);
                suppliers.set(supplierKey, supplierId);
              }
              this.insertFlexible("supplier_variants", {
                supplier_id: supplierId,
                variant_id: variantId,
                supplier_sku: variant.supplier.supplierSku,
                last_cost_minor: variant.supplier.lastCostMinor,
                lead_time_days: variant.supplier.leadTimeDays,
                created_at: timestamp,
                updated_at: timestamp,
              }, ["supplier_id", "variant_id"]);
            }

            if (variant.openingStock) {
              const locationId = locations.get(normalizeIdentifier(variant.openingStock.locationCode));
              if (!locationId) throw new ImportStaleError(`Location ${variant.openingStock.locationCode} is no longer active`);
              this.insertFlexible("inventory_levels", {
                variant_id: variantId,
                location_id: locationId,
                on_hand: variant.openingStock.quantity,
                reserved: 0,
                created_at: timestamp,
                updated_at: timestamp,
              }, ["variant_id", "location_id", "on_hand", "reserved"]);
              this.insertFlexible("inventory_movements", {
                id: id(),
                variant_id: variantId,
                location_id: locationId,
                quantity_delta: variant.openingStock.quantity,
                movement_type: "adjustment",
                reference_type: "catalogue_import",
                reference_id: importId,
                reason: "Opening stock import",
                actor_id: actor.actorId,
                created_at: timestamp,
              }, ["id", "variant_id", "location_id", "quantity_delta", "movement_type", "actor_id", "created_at"]);
            }
          }
        }

        this.insertFlexible("audit_events", {
          id: id(),
          actor_id: actor.actorId,
          actor_role: actor.actorRole,
          action: "catalogue_import.committed",
          entity_type: "catalogue_import",
          entity_id: importId,
          metadata_json: JSON.stringify({ fingerprint: reviewedPlan.fingerprint, rowCount: reviewedPlan.rowCount, summary: reviewedPlan.summary }),
          created_at: timestamp,
        }, ["id", "actor_id", "actor_role", "action", "entity_type", "created_at"]);
      });
    } catch (cause) {
      if (cause instanceof ImportStaleError) {
        const currentPlan = await buildReviewedCatalogueImportPlan(body.rows, this.snapshot());
        return Response.json({ error: `Import preview became stale: ${cause.message}`, plan: currentPlan }, { status: 409 });
      }
      if (cause instanceof ImportSchemaError) {
        return Response.json({ error: cause.message }, { status: 500 });
      }
      throw cause;
    }

    const response: CatalogueImportCommitResponse = { ok: true, importId, summary: reviewedPlan.summary };
    return Response.json(response, { status: 201 });
  }
}
