import { TenantStore as ImportTenantStore } from "./tenant-store-imports";
import type { TenantEnv } from "./tenant-store";

type SupplierSkuRow = {
  variant_id: string;
  supplier_sku: string | null;
  product_name: string;
  variant_name: string;
  sku: string;
};

type SupplierVariantBody = {
  supplierId?: unknown;
  variantId?: unknown;
  supplierSku?: unknown;
};

function normalizeSupplierSku(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

/**
 * Final canonical runtime guard.
 *
 * Supplier SKU matching is only deterministic when one supplier's code maps to
 * one OrderMate variant. The underlying table is keyed by supplier+variant, so
 * enforce the stronger business invariant here for every manual, imported or
 * human-learned mapping without requiring a schema change.
 */
export class TenantStore extends ImportTenantStore {
  private readonly finalCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.finalCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "POST" && path === "/supplier-variants") {
      const body = await request.clone().json().catch(() => null) as SupplierVariantBody | null;
      const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
      const variantId = typeof body?.variantId === "string" ? body.variantId : "";
      const supplierSku = typeof body?.supplierSku === "string" ? body.supplierSku.trim() : "";

      if (supplierId && variantId && supplierSku) {
        const normalized = normalizeSupplierSku(supplierSku);
        const mappings = this.finalCtx.storage.sql.exec<SupplierSkuRow>(
          `SELECT sv.variant_id,
                  sv.supplier_sku,
                  p.name AS product_name,
                  v.name AS variant_name,
                  v.sku
           FROM supplier_variants sv
           JOIN product_variants v ON v.id = sv.variant_id
           JOIN products p ON p.id = v.product_id
           WHERE sv.supplier_id = ?
             AND sv.variant_id != ?
             AND sv.supplier_sku IS NOT NULL`,
          supplierId,
          variantId,
        ).toArray();
        const conflict = mappings.find(mapping => normalizeSupplierSku(mapping.supplier_sku || "") === normalized);
        if (conflict) {
          return Response.json({
            error: `Supplier SKU ${supplierSku} is already mapped to ${conflict.product_name} · ${conflict.variant_name} (${conflict.sku})`,
          }, { status: 409 });
        }
      }
    }

    return super.fetch(request);
  }
}
