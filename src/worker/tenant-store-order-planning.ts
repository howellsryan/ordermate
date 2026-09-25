import { z } from "zod";
import { TenantStore as ReportsTenantStore } from "./tenant-store-reports";
import type { TenantEnv } from "./tenant-store";

const updateSchema = z.object({
  requiredByDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

type OrderPlanningRow = {
  id: string;
  status: string;
  required_by_date: string | null;
  priority: "low" | "normal" | "high" | "urgent";
};

function validCalendarDate(value: string | null) {
  if (value === null) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function now() {
  return new Date().toISOString();
}

/** Order planning metadata stays separate from lifecycle transitions. */
export class TenantStore extends ReportsTenantStore {
  private readonly orderPlanningCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.orderPlanningCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const match = path.match(/^\/orders\/([^/]+)\/planning$/);
    if (request.method === "PATCH" && match) {
      return this.updateOrderPlanning(decodeURIComponent(match[1]), request);
    }
    return super.fetch(request);
  }

  private async updateOrderPlanning(orderId: string, request: Request) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    let input: z.infer<typeof updateSchema>;
    try {
      input = updateSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid order planning details" }, { status: 400 });
      throw cause;
    }
    if (!validCalendarDate(input.requiredByDate)) {
      return Response.json({ error: "Required-by date must be a real calendar date" }, { status: 400 });
    }

    const order = this.orderPlanningCtx.storage.sql.exec<OrderPlanningRow>(
      "SELECT id, status, required_by_date, priority FROM orders WHERE id = ?",
      orderId,
    ).toArray()[0];
    if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
    if (["completed", "cancelled"].includes(order.status)) {
      return Response.json({ error: "Completed or cancelled orders cannot change planning details" }, { status: 409 });
    }
    if (order.required_by_date === input.requiredByDate && order.priority === input.priority) {
      return Response.json({ ok: true, requiredByDate: input.requiredByDate, priority: input.priority });
    }

    const updatedAt = now();
    this.orderPlanningCtx.storage.transactionSync(() => {
      this.orderPlanningCtx.storage.sql.exec(
        "UPDATE orders SET required_by_date = ?, priority = ?, updated_at = ? WHERE id = ?",
        input.requiredByDate,
        input.priority,
        updatedAt,
        orderId,
      );
      this.orderPlanningCtx.storage.sql.exec(
        "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'order.planning_updated', 'order', ?, ?, ?)",
        crypto.randomUUID(),
        actorId,
        actorRole,
        orderId,
        JSON.stringify({
          previousRequiredByDate: order.required_by_date,
          requiredByDate: input.requiredByDate,
          previousPriority: order.priority,
          priority: input.priority,
        }),
        updatedAt,
      );
    });

    return Response.json({ ok: true, requiredByDate: input.requiredByDate, priority: input.priority });
  }
}
