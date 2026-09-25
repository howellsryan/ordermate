import { z } from "zod";
import type { SavedView, SavedViewPage, SavedViewRecord } from "../shared/saved-views";
import { TenantStore as DiscrepancyTenantStore } from "./tenant-store-discrepancies";
import type { TenantEnv } from "./tenant-store";

const inventoryConfig = z.object({
  query: z.string().max(120),
  locationId: z.string().max(200).nullable(),
  stock: z.enum(["all", "low", "out", "tracked", "untracked"]),
});

const purchasingConfig = z.object({
  query: z.string().max(120),
  supplierId: z.string().max(200).nullable(),
  status: z.enum(["all", "draft", "ordered", "partially_received", "received", "cancelled"]),
  due: z.enum(["all", "overdue", "due_7_days", "no_date"]),
});

const createSchema = z.discriminatedUnion("page", [
  z.object({ page: z.literal("inventory"), name: z.string().trim().min(1).max(80), config: inventoryConfig }),
  z.object({ page: z.literal("purchasing"), name: z.string().trim().min(1).max(80), config: purchasingConfig }),
]);

type ExistingName = { id: string };

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function actorId(request: Request) {
  return request.headers.get("x-ordermate-actor-id") || "";
}

function parseRecord(row: SavedViewRecord): SavedView {
  return { ...row, config: JSON.parse(row.config_json) } as SavedView;
}

export class TenantStore extends DiscrepancyTenantStore {
  private readonly viewsCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.viewsCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/saved-views") return this.listSavedViews(request, url);
    if (request.method === "POST" && path === "/saved-views") return this.createSavedView(request);

    const match = path.match(/^\/saved-views\/([^/]+)$/);
    if (request.method === "DELETE" && match) return this.deleteSavedView(decodeURIComponent(match[1]), request);

    return super.fetch(request);
  }

  private listSavedViews(request: Request, url: URL) {
    const owner = actorId(request);
    if (!owner) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });
    const page = url.searchParams.get("page");
    if (page !== "inventory" && page !== "purchasing") return Response.json({ error: "Saved-view page is required" }, { status: 400 });

    const rows = this.viewsCtx.storage.sql.exec<SavedViewRecord>(
      `SELECT id, owner_actor_id, page, name, config_json, created_at, updated_at
       FROM saved_views
       WHERE owner_actor_id = ? AND page = ?
       ORDER BY name COLLATE NOCASE`,
      owner,
      page,
    ).toArray();
    return Response.json(rows.map(parseRecord));
  }

  private async createSavedView(request: Request) {
    const owner = actorId(request);
    if (!owner) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    let input: z.infer<typeof createSchema>;
    try {
      input = createSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid saved view" }, { status: 400 });
      throw cause;
    }

    const conflict = this.viewsCtx.storage.sql.exec<ExistingName>(
      "SELECT id FROM saved_views WHERE owner_actor_id = ? AND page = ? AND name = ? COLLATE NOCASE LIMIT 1",
      owner,
      input.page,
      input.name,
    ).toArray()[0];
    if (conflict) return Response.json({ error: "You already have a saved view with that name on this page" }, { status: 409 });

    const viewId = id();
    const timestamp = now();
    this.viewsCtx.storage.sql.exec(
      `INSERT INTO saved_views (id, owner_actor_id, page, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      viewId,
      owner,
      input.page,
      input.name,
      JSON.stringify(input.config),
      timestamp,
      timestamp,
    );

    const row = this.viewsCtx.storage.sql.exec<SavedViewRecord>(
      "SELECT id, owner_actor_id, page, name, config_json, created_at, updated_at FROM saved_views WHERE id = ?",
      viewId,
    ).toArray()[0];
    return Response.json(parseRecord(row), { status: 201 });
  }

  private deleteSavedView(viewId: string, request: Request) {
    const owner = actorId(request);
    if (!owner) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });
    const existing = this.viewsCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM saved_views WHERE id = ? AND owner_actor_id = ?",
      viewId,
      owner,
    ).toArray()[0];
    if (!existing) return Response.json({ error: "Saved view not found" }, { status: 404 });
    this.viewsCtx.storage.sql.exec("DELETE FROM saved_views WHERE id = ? AND owner_actor_id = ?", viewId, owner);
    return Response.json({ ok: true });
  }
}

export type { SavedViewPage };
