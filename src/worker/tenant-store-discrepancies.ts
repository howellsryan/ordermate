import { z } from "zod";
import type {
  DeliveryDiscrepancyCreateRequest,
  DeliveryDiscrepancyRecord,
} from "../shared/delivery-discrepancy";
import { TenantStore as FinalTenantStore } from "./tenant-store-final";
import type { TenantEnv } from "./tenant-store";

const issueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reference_mismatch"),
    documentPurchaseOrderReference: z.string().trim().min(1).max(200),
    expectedPurchaseOrderNumber: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("unexpected_line"),
    description: z.string().max(500),
    supplierSku: z.string().max(200),
    sku: z.string().max(200),
    barcode: z.string().max(200),
    quantity: z.number().int().positive().max(1_000_000).nullable(),
    warnings: z.array(z.string().max(500)).max(20),
  }),
  z.object({
    type: z.literal("quantity_variance"),
    lineId: z.string().min(1).max(200),
    sku: z.string().max(200),
    description: z.string().max(500),
    documentQuantity: z.number().int().min(0).max(1_000_000),
    receivedQuantity: z.number().int().min(0).max(1_000_000),
  }),
]);

const createSchema = z.object({
  proposalKey: z.string().min(1).max(800),
  proposalEventId: z.string().min(1).max(200),
  purchaseOrderId: z.string().min(1).max(200),
  purchaseOrderNumber: z.string().min(1).max(200),
  documentReference: z.string().max(300),
  documentDate: z.string().max(100),
  issues: z.array(issueSchema).min(1).max(500),
});

const resolveSchema = z.object({
  resolutionCode: z.enum(["supplier_follow_up", "accepted_variance", "corrected_document", "other"]),
  resolutionNote: z.string().trim().min(3).max(2_000),
});

type ExistingDiscrepancy = { id: string; status: string };

type PurchaseOrderIdentity = {
  id: string;
  number: string;
};

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

/**
 * Operational discrepancy layer.
 *
 * R2 remains the immutable delivery-note/proposal evidence store. This table is
 * intentionally small: it records only actionable discrepancy evidence and its
 * human resolution lifecycle inside the tenant's canonical operational store.
 */
export class TenantStore extends FinalTenantStore {
  private readonly discrepancyCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.discrepancyCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/delivery-discrepancies") {
      return Response.json(this.listDiscrepancies(url.searchParams.get("purchaseOrderId"), url.searchParams.get("status")));
    }

    if (request.method === "POST" && path === "/internal/delivery-discrepancies") {
      return this.createDiscrepancy(request);
    }

    const discrepancy = path.match(/^\/delivery-discrepancies\/([^/]+)$/);
    if (request.method === "PATCH" && discrepancy) {
      return this.resolveDiscrepancy(decodeURIComponent(discrepancy[1]), request);
    }

    return super.fetch(request);
  }

  private actor(request: Request) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) return null;
    return { actorId, actorRole };
  }

  private audit(request: Request, action: string, entityId: string, metadata?: unknown) {
    const actor = this.actor(request);
    if (!actor) throw new Error("Missing authenticated actor context");
    this.discrepancyCtx.storage.sql.exec(
      "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, ?, 'delivery_discrepancy', ?, ?, ?)",
      id(), actor.actorId, actor.actorRole, action, entityId, metadata === undefined ? null : JSON.stringify(metadata), now(),
    );
  }

  private listDiscrepancies(purchaseOrderId: string | null, requestedStatus: string | null): DeliveryDiscrepancyRecord[] {
    const status = requestedStatus === "open" || requestedStatus === "resolved" ? requestedStatus : null;
    const where: string[] = [];
    const values: string[] = [];
    if (purchaseOrderId) {
      where.push("d.purchase_order_id = ?");
      values.push(purchaseOrderId);
    }
    if (status) {
      where.push("d.status = ?");
      values.push(status);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.discrepancyCtx.storage.sql.exec<DeliveryDiscrepancyRecord>(
      `SELECT d.id,
              d.purchase_order_id,
              po.number AS purchase_order_number,
              s.name AS supplier_name,
              l.name AS location_name,
              d.proposal_key,
              d.proposal_event_id,
              d.status,
              d.issue_count,
              d.evidence_json,
              d.created_at,
              d.created_by,
              d.resolved_at,
              d.resolved_by,
              d.resolution_code,
              d.resolution_note
       FROM delivery_discrepancies d
       JOIN purchase_orders po ON po.id = d.purchase_order_id
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN locations l ON l.id = po.location_id
       ${clause}
       ORDER BY CASE d.status WHEN 'open' THEN 0 ELSE 1 END, d.created_at DESC
       LIMIT 250`,
      ...values,
    ).toArray();
  }

  private async createDiscrepancy(request: Request) {
    const actor = this.actor(request);
    if (!actor) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    let input: DeliveryDiscrepancyCreateRequest;
    try {
      input = createSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid delivery discrepancy" }, { status: 400 });
      throw cause;
    }

    const po = this.discrepancyCtx.storage.sql.exec<PurchaseOrderIdentity>(
      "SELECT id, number FROM purchase_orders WHERE id = ?",
      input.purchaseOrderId,
    ).toArray()[0];
    if (!po || po.number !== input.purchaseOrderNumber) return Response.json({ error: "Purchase order could not be verified" }, { status: 409 });

    const existing = this.discrepancyCtx.storage.sql.exec<ExistingDiscrepancy>(
      "SELECT id, status FROM delivery_discrepancies WHERE proposal_key = ?",
      input.proposalKey,
    ).toArray()[0];
    if (existing) return Response.json({ ok: true, id: existing.id, status: existing.status, created: false });

    const discrepancyId = id();
    const createdAt = now();
    const evidenceJson = JSON.stringify({
      version: 1,
      proposalKey: input.proposalKey,
      proposalEventId: input.proposalEventId,
      purchaseOrderId: input.purchaseOrderId,
      purchaseOrderNumber: input.purchaseOrderNumber,
      documentReference: input.documentReference,
      documentDate: input.documentDate,
      issues: input.issues,
    });

    this.discrepancyCtx.storage.transactionSync(() => {
      this.discrepancyCtx.storage.sql.exec(
        `INSERT INTO delivery_discrepancies (
           id, purchase_order_id, proposal_key, proposal_event_id, status,
           issue_count, evidence_json, created_at, created_by
         ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
        discrepancyId,
        input.purchaseOrderId,
        input.proposalKey,
        input.proposalEventId,
        input.issues.length,
        evidenceJson,
        createdAt,
        actor.actorId,
      );
      this.audit(request, "delivery_discrepancy.opened", discrepancyId, {
        purchaseOrderId: input.purchaseOrderId,
        proposalEventId: input.proposalEventId,
        issueCount: input.issues.length,
        issueTypes: [...new Set(input.issues.map(issue => issue.type))],
      });
    });

    return Response.json({ ok: true, id: discrepancyId, status: "open", created: true }, { status: 201 });
  }

  private async resolveDiscrepancy(discrepancyId: string, request: Request) {
    const actor = this.actor(request);
    if (!actor) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    let input: z.infer<typeof resolveSchema>;
    try {
      input = resolveSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Resolution note is required" }, { status: 400 });
      throw cause;
    }

    const existing = this.discrepancyCtx.storage.sql.exec<{ status: string }>(
      "SELECT status FROM delivery_discrepancies WHERE id = ?",
      discrepancyId,
    ).toArray()[0];
    if (!existing) return Response.json({ error: "Delivery discrepancy not found" }, { status: 404 });
    if (existing.status !== "open") return Response.json({ error: "Delivery discrepancy is already resolved" }, { status: 409 });

    const resolvedAt = now();
    this.discrepancyCtx.storage.transactionSync(() => {
      this.discrepancyCtx.storage.sql.exec(
        `UPDATE delivery_discrepancies
         SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_code = ?, resolution_note = ?
         WHERE id = ? AND status = 'open'`,
        resolvedAt,
        actor.actorId,
        input.resolutionCode,
        input.resolutionNote,
        discrepancyId,
      );
      this.audit(request, "delivery_discrepancy.resolved", discrepancyId, {
        resolutionCode: input.resolutionCode,
        resolutionNote: input.resolutionNote,
      });
    });

    return Response.json({ ok: true, id: discrepancyId, status: "resolved", resolvedAt });
  }
}
