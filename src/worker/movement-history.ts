import { Hono } from "hono";
import type { Role } from "../shared/types";
import { createAuth, type AuthEnv } from "./auth";
import { can } from "./permissions";
import type { TenantStore } from "./tenant-store-runtime";

type Env = AuthEnv & {
  TENANT_STORES: DurableObjectNamespace<TenantStore>;
};

type Membership = { id: string; role: Role };
type ActorRow = { id: string; name: string };

type Movement = {
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

export const movementHistoryApp = new Hono<{ Bindings: Env }>();

movementHistoryApp.get("/", async c => {
  const auth = createAuth(c.env, c.req.raw);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const tenantId = c.req.header("x-ordermate-tenant");
  if (!tenantId) return c.json({ error: "Select a business first" }, 400);

  const membership = await c.env.CONTROL_DB.prepare(
    "SELECT id, role FROM member WHERE userId = ? AND organizationId = ?",
  ).bind(session.user.id, tenantId).first<Membership>();
  if (!membership) return c.json({ error: "Forbidden" }, 403);
  if (!can(membership.role, "inventory", "read")) return c.json({ error: "Insufficient permission" }, 403);

  const stub = c.env.TENANT_STORES.jurisdiction("eu").getByName(tenantId);
  const headers = new Headers({
    "x-ordermate-actor-id": session.user.id,
    "x-ordermate-actor-role": membership.role,
    "x-ordermate-actor-name": session.user.name,
  });
  const response = await stub.fetch(new Request("https://tenant.internal/inventory/movements", { headers }));
  if (!response.ok) return c.json({ error: "Could not load stock history" }, 502);
  const movements = await response.json<Movement[]>();

  const members = await c.env.CONTROL_DB.prepare(
    `SELECT u.id, u.name
     FROM member m JOIN user u ON u.id = m.userId
     WHERE m.organizationId = ?`,
  ).bind(tenantId).all<ActorRow>();
  const actorNames = new Map(members.results.map(actor => [actor.id, actor.name]));

  return c.json(movements.map(movement => ({
    ...movement,
    actor_name: movement.actor_id === "system" ? "System" : actorNames.get(movement.actor_id) || "Former member",
  })));
});
