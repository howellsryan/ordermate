import { z } from "zod";
import type { TenantEnv } from "./tenant-store";
import { TenantStore as RuntimeTenantStore } from "./tenant-store-runtime";

const contactUpdateInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(100).optional(),
  notes: z.string().max(4000).optional(),
});

type ContactKind = "supplier" | "customer";

const timestamp = () => new Date().toISOString();

/**
 * Application-level v1 runtime extensions.
 *
 * This keeps the exported Durable Object class name `TenantStore` unchanged,
 * so existing tenant objects continue using the same namespace and SQLite
 * storage. No schema change is introduced here.
 */
export class TenantStore extends RuntimeTenantStore {
  private readonly appCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.appCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";

    const supplier = path.match(/^\/suppliers\/([^/]+)$/);
    if (request.method === "PATCH" && supplier) {
      return this.updateContact("supplier", decodeURIComponent(supplier[1]), request);
    }

    const customer = path.match(/^\/customers\/([^/]+)$/);
    if (request.method === "PATCH" && customer) {
      return this.updateContact("customer", decodeURIComponent(customer[1]), request);
    }

    return super.fetch(request);
  }

  private async updateContact(kind: ContactKind, id: string, request: Request) {
    let input: z.infer<typeof contactUpdateInput>;
    try {
      input = contactUpdateInput.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        return Response.json({ error: cause.issues[0]?.message || `Invalid ${kind} update` }, { status: 400 });
      }
      throw cause;
    }

    const table = kind === "supplier" ? "suppliers" : "customers";
    const entityType = kind;
    const action = `${kind}.updated`;
    const updatedAt = timestamp();
    const existing = this.appCtx.storage.sql.exec<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ?`,
      id,
    ).toArray()[0];
    if (!existing) return Response.json({ error: `${kind === "supplier" ? "Supplier" : "Customer"} not found` }, { status: 404 });

    try {
      this.appCtx.storage.transactionSync(() => {
        this.appCtx.storage.sql.exec(
          `UPDATE ${table}
           SET name = ?, email = ?, phone = ?, notes = ?, updated_at = ?
           WHERE id = ?`,
          input.name,
          input.email?.trim() || null,
          input.phone?.trim() || null,
          input.notes?.trim() || null,
          updatedAt,
          id,
        );

        this.appCtx.storage.sql.exec(
          "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          crypto.randomUUID(),
          request.headers.get("x-ordermate-actor-id") || "system",
          request.headers.get("x-ordermate-actor-role") || "unknown",
          action,
          entityType,
          id,
          JSON.stringify({ name: input.name }),
          updatedAt,
        );
      });
    } catch (cause) {
      console.error(`TenantStore ${kind} update failed`, cause);
      return Response.json({ error: `Could not update ${kind}` }, { status: 500 });
    }

    return Response.json({ ok: true });
  }
}
