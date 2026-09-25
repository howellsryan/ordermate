import { z } from "zod";
import { TenantStore as CoreTenantStore, type TenantEnv } from "./tenant-store";

type MovementRow = {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  location_id: string;
  location_name: string;
  quantity_delta: number;
  movement_type: string;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  actor_id: string;
  created_at: string;
};

const productUpdateInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().trim().max(120).optional(),
  variants: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(200),
    sku: z.string().trim().min(1).max(100),
    barcode: z.string().trim().max(100).optional(),
    priceMinor: z.number().int().nonnegative(),
    costMinor: z.number().int().nonnegative(),
    taxRateBps: z.number().int().min(0).max(10000),
  })).min(1),
});

const timestamp = () => new Date().toISOString();

/**
 * Runtime extensions for the v1 TenantStore.
 *
 * The exported class name remains `TenantStore`, so this is a code update to
 * the existing Durable Object class/namespace rather than a class lifecycle
 * change. It reads the existing v1 schema and does not migrate or duplicate data.
 */
export class TenantStore extends CoreTenantStore {
  private readonly runtimeCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.runtimeCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/inventory/movements") {
      const movements = this.runtimeCtx.storage.sql.exec<MovementRow>(
        `SELECT im.id,
                im.variant_id,
                p.name AS product_name,
                v.name AS variant_name,
                v.sku,
                v.barcode,
                im.location_id,
                l.name AS location_name,
                im.quantity_delta,
                im.movement_type,
                im.reference_type,
                im.reference_id,
                im.reason,
                im.actor_id,
                im.created_at
         FROM inventory_movements im
         JOIN product_variants v ON v.id = im.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN locations l ON l.id = im.location_id
         ORDER BY im.created_at DESC, im.rowid DESC
         LIMIT 250`,
      ).toArray();
      return Response.json(movements);
    }

    if (request.method === "PATCH" && /^\/products\/[^/]+$/.test(path)) {
      return this.updateProduct(decodeURIComponent(path.split("/")[2]), request);
    }

    return super.fetch(request);
  }

  private async updateProduct(productId: string, request: Request) {
    let input: z.infer<typeof productUpdateInput>;
    try {
      input = productUpdateInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid product update" }, { status: 400 });
      throw cause;
    }

    const actorId = request.headers.get("x-ordermate-actor-id") || "system";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "unknown";
    const updatedAt = timestamp();

    try {
      this.runtimeCtx.storage.transactionSync(() => {
        const product = this.runtimeCtx.storage.sql.exec<{ id: string }>("SELECT id FROM products WHERE id = ?", productId).toArray()[0];
        if (!product) throw new Error("PRODUCT_NOT_FOUND");

        let categoryId: string | null = null;
        const category = input.category?.trim();
        if (category) {
          const existing = this.runtimeCtx.storage.sql.exec<{ id: string }>("SELECT id FROM categories WHERE name = ? COLLATE NOCASE", category).toArray()[0];
          categoryId = existing?.id || crypto.randomUUID();
          if (!existing) {
            this.runtimeCtx.storage.sql.exec("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", categoryId, category, updatedAt);
          }
        }

        for (const variant of input.variants) {
          const owned = this.runtimeCtx.storage.sql.exec<{ id: string }>(
            "SELECT id FROM product_variants WHERE id = ? AND product_id = ?",
            variant.id,
            productId,
          ).toArray()[0];
          if (!owned) throw new Error("VARIANT_NOT_FOUND");
        }

        this.runtimeCtx.storage.sql.exec(
          "UPDATE products SET name = ?, description = ?, category_id = ?, updated_at = ? WHERE id = ?",
          input.name,
          input.description?.trim() || null,
          categoryId,
          updatedAt,
          productId,
        );

        for (const variant of input.variants) {
          this.runtimeCtx.storage.sql.exec(
            `UPDATE product_variants
             SET name = ?, sku = ?, barcode = ?, price_minor = ?, cost_minor = ?, tax_rate_bps = ?, updated_at = ?
             WHERE id = ? AND product_id = ?`,
            variant.name,
            variant.sku,
            variant.barcode?.trim() || null,
            variant.priceMinor,
            variant.costMinor,
            variant.taxRateBps,
            updatedAt,
            variant.id,
            productId,
          );
        }

        this.runtimeCtx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'product.updated', 'product', ?, ?, ?)",
          crypto.randomUUID(),
          actorId,
          actorRole,
          productId,
          JSON.stringify({ name: input.name, variants: input.variants.length }),
          updatedAt,
        );
      });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "PRODUCT_NOT_FOUND") return Response.json({ error: "Product not found" }, { status: 404 });
      if (cause instanceof Error && cause.message === "VARIANT_NOT_FOUND") return Response.json({ error: "Product update contains an unknown variant" }, { status: 400 });
      if (cause instanceof Error && cause.message.includes("UNIQUE constraint failed")) return Response.json({ error: "SKU and barcode values must be unique inside this business" }, { status: 409 });
      console.error("TenantStore product update failed", cause);
      return Response.json({ error: "Could not update product" }, { status: 500 });
    }

    return Response.json({ ok: true });
  }
}
