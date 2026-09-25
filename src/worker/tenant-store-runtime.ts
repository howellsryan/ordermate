import { TenantStore as CoreTenantStore } from "./tenant-store";

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

/**
 * Runtime extensions for the v1 TenantStore.
 *
 * The exported class name remains `TenantStore`, so this is a code update to
 * the existing Durable Object class/namespace rather than a class lifecycle
 * change. It reads the existing v1 schema and does not migrate or duplicate data.
 */
export class TenantStore extends CoreTenantStore {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/inventory/movements") {
      const movements = this.ctx.storage.sql.exec<MovementRow>(
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

    return super.fetch(request);
  }
}
