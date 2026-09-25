import { z } from "zod";
import { TenantStore as SavedViewTenantStore } from "./tenant-store-saved-views";
import type { TenantEnv } from "./tenant-store";

const bulkProductStatusInput = z.object({
  productIds: z.array(z.string().min(1).max(200)).min(1).max(200),
  status: z.enum(["active", "archived"]),
}).superRefine((value, ctx) => {
  if (new Set(value.productIds).size !== value.productIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productIds"], message: "Each product can only appear once in a bulk action" });
  }
});

type ProductRow = { id: string; name: string; status: string };

function now() {
  return new Date().toISOString();
}

function auditId() {
  return crypto.randomUUID();
}

/**
 * Atomic bulk operations layered over the canonical tenant runtime.
 * Bulk actions preserve the same domain semantics and audit events as their
 * single-record equivalents; only the transaction boundary is widened.
 */
export class TenantStore extends SavedViewTenantStore {
  private readonly bulkCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.bulkCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "PATCH" && path === "/products/bulk-status") {
      return this.bulkProductStatus(request);
    }

    return super.fetch(request);
  }

  private async bulkProductStatus(request: Request) {
    let input: z.infer<typeof bulkProductStatusInput>;
    try {
      input = bulkProductStatusInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid bulk product update" }, { status: 400 });
      throw cause;
    }

    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    const placeholders = input.productIds.map(() => "?").join(", ");
    const products = this.bulkCtx.storage.sql.exec<ProductRow>(
      `SELECT id, name, status FROM products WHERE id IN (${placeholders})`,
      ...input.productIds,
    ).toArray();
    if (products.length !== input.productIds.length) {
      const found = new Set(products.map(product => product.id));
      const missing = input.productIds.filter(productId => !found.has(productId));
      return Response.json({ error: "One or more selected products no longer exist", missingProductIds: missing }, { status: 404 });
    }

    const changed = products.filter(product => product.status !== input.status);
    if (!changed.length) {
      return Response.json({ ok: true, status: input.status, requested: products.length, changed: 0, unchanged: products.length });
    }

    const updatedAt = now();
    this.bulkCtx.storage.transactionSync(() => {
      for (const product of changed) {
        this.bulkCtx.storage.sql.exec(
          "UPDATE products SET status = ?, updated_at = ? WHERE id = ?",
          input.status,
          updatedAt,
          product.id,
        );
        this.bulkCtx.storage.sql.exec(
          "UPDATE product_variants SET active = ?, updated_at = ? WHERE product_id = ?",
          input.status === "active" ? 1 : 0,
          updatedAt,
          product.id,
        );
        this.bulkCtx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, 'product', ?, ?, ?)",
          auditId(),
          actorId,
          actorRole,
          input.status === "active" ? "product.restored" : "product.archived",
          product.id,
          JSON.stringify({ previousStatus: product.status, bulk: true }),
          updatedAt,
        );
      }
    });

    return Response.json({
      ok: true,
      status: input.status,
      requested: products.length,
      changed: changed.length,
      unchanged: products.length - changed.length,
    });
  }
}
