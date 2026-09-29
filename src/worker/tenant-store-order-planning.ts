import { z } from "zod";
import type { OperatingIntelligenceResponse } from "../shared/operating-intelligence";
import { applySupplierOrderingTerms, type SupplierOrderingTerm } from "../shared/supplier-ordering";
import { BusinessProfileRuntime } from "./business-profile-runtime";
import { ExternalOrderRuntime } from "./external-order-runtime";
import { FeatureRuntime } from "./feature-runtime";
import { IntegrationCatalogueRuntime } from "./integration-catalogue-runtime";
import { IntegrationOrderRuntime } from "./integration-order-runtime";
import { IntegrationRuntime } from "./integration-runtime";
import { ServiceRuntime } from "./service-runtime";
import { TenantStore as ReportsTenantStore } from "./tenant-store-reports";
import type { TenantEnv } from "./tenant-store";

const updateSchema = z.object({
  requiredByDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

const supplierMappingSchema = z.object({
  supplierId: z.string().min(1),
  variantId: z.string().min(1),
  supplierSku: z.string().trim().max(120).optional(),
  lastCostMinor: z.number().int().nonnegative().optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
  minimumOrderQuantity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  orderMultiple: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

type OrderPlanningRow = {
  id: string;
  status: string;
  required_by_date: string | null;
  priority: "low" | "normal" | "high" | "urgent";
};

type SupplierTermRow = SupplierOrderingTerm;
type SupplierMapping = Record<string, unknown> & { supplier_id: string; variant_id: string };
type SupplierSkuConflictRow = {
  variant_id: string;
  supplier_sku: string | null;
  product_name: string;
  variant_name: string;
  sku: string;
};

function validCalendarDate(value: string | null) {
  if (value === null) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeSupplierSku(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

function now() {
  return new Date().toISOString();
}

/** Order planning metadata and supplier buying terms stay separate from lifecycle transitions. */
export class TenantStore extends ReportsTenantStore {
  private readonly orderPlanningCtx: DurableObjectState;
  private readonly businessProfileRuntime: BusinessProfileRuntime;
  private readonly externalOrderRuntime: ExternalOrderRuntime;
  private readonly featureRuntime: FeatureRuntime;
  private readonly integrationRuntime: IntegrationRuntime;
  private readonly integrationCatalogueRuntime: IntegrationCatalogueRuntime;
  private readonly integrationOrderRuntime: IntegrationOrderRuntime;
  private readonly serviceRuntime: ServiceRuntime;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.orderPlanningCtx = ctx;
    this.businessProfileRuntime = new BusinessProfileRuntime(ctx);
    this.externalOrderRuntime = new ExternalOrderRuntime(ctx);
    this.featureRuntime = new FeatureRuntime(ctx);
    this.integrationRuntime = new IntegrationRuntime(ctx);
    this.integrationCatalogueRuntime = new IntegrationCatalogueRuntime(ctx);
    this.integrationOrderRuntime = new IntegrationOrderRuntime(ctx, request => this.canonicalOrderFetch(request));
    this.serviceRuntime = new ServiceRuntime(ctx);
  }

  private async canonicalOrderFetch(request: Request): Promise<Response> {
    const externalOrderResponse = await this.externalOrderRuntime.handle(request);
    if (externalOrderResponse) return externalOrderResponse;
    return super.fetch(request);
  }

  async fetch(request: Request): Promise<Response> {
    const featureResponse = await this.featureRuntime.handle(request);
    if (featureResponse) return featureResponse;

    const businessProfileResponse = await this.businessProfileRuntime.handle(request);
    if (businessProfileResponse) return businessProfileResponse;

    const externalOrderResponse = await this.externalOrderRuntime.handle(request);
    if (externalOrderResponse) return externalOrderResponse;

    const integrationOrderResponse = await this.integrationOrderRuntime.handle(request);
    if (integrationOrderResponse) return integrationOrderResponse;

    const integrationCatalogueResponse = await this.integrationCatalogueRuntime.handle(request);
    if (integrationCatalogueResponse) return integrationCatalogueResponse;

    const integrationResponse = await this.integrationRuntime.handle(request);
    if (integrationResponse) return integrationResponse;

    const modularResponse = await this.serviceRuntime.handle(request);
    if (modularResponse) return modularResponse;

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && path === "/supplier-variants") {
      const response = await super.fetch(request);
      if (!response.ok) return response;
      const mappings = await response.json<SupplierMapping[]>();
      const terms = this.listSupplierTerms();
      const termByKey = new Map(terms.map(term => [`${term.supplier_id}:${term.variant_id}`, term] as const));
      return Response.json(mappings.map(mapping => ({
        ...mapping,
        minimum_order_quantity: termByKey.get(`${mapping.supplier_id}:${mapping.variant_id}`)?.minimum_order_quantity ?? null,
        order_multiple: termByKey.get(`${mapping.supplier_id}:${mapping.variant_id}`)?.order_multiple ?? null,
      })));
    }

    if (request.method === "POST" && path === "/supplier-variants") {
      return this.upsertSupplierMapping(request);
    }

    if (request.method === "GET" && path === "/replenishment") {
      const response = await super.fetch(request);
      if (!response.ok) return response;
      const intelligence = await response.json<OperatingIntelligenceResponse>();
      return Response.json(applySupplierOrderingTerms(intelligence, this.listSupplierTerms()));
    }

    const match = path.match(/^\/orders\/([^/]+)\/planning$/);
    if (request.method === "PATCH" && match) {
      return this.updateOrderPlanning(decodeURIComponent(match[1]), request);
    }
    return super.fetch(request);
  }

  private listSupplierTerms() {
    return this.orderPlanningCtx.storage.sql.exec<SupplierTermRow>(
      `SELECT supplier_id, variant_id, minimum_order_quantity, order_multiple
       FROM supplier_variants`,
    ).toArray();
  }

  private supplierSkuConflict(supplierId: string, variantId: string, supplierSku?: string) {
    const trimmed = supplierSku?.trim() || "";
    if (!trimmed) return null;
    const normalized = normalizeSupplierSku(trimmed);
    return this.orderPlanningCtx.storage.sql.exec<SupplierSkuConflictRow>(
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
    ).toArray().find(mapping => normalizeSupplierSku(mapping.supplier_sku || "") === normalized) || null;
  }

  private async upsertSupplierMapping(request: Request) {
    const actorId = request.headers.get("x-ordermate-actor-id") || "";
    const actorRole = request.headers.get("x-ordermate-actor-role") || "";
    if (!actorId || !actorRole) return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });

    let input: z.infer<typeof supplierMappingSchema>;
    try {
      input = supplierMappingSchema.parse(await request.json());
    } catch (cause) {
      if (cause instanceof z.ZodError) return Response.json({ error: cause.issues[0]?.message || "Invalid supplier mapping" }, { status: 400 });
      throw cause;
    }

    const supplier = this.orderPlanningCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM suppliers WHERE id = ? AND active = 1",
      input.supplierId,
    ).toArray()[0];
    if (!supplier) return Response.json({ error: "Supplier not found" }, { status: 404 });

    const variant = this.orderPlanningCtx.storage.sql.exec<{ id: string }>(
      "SELECT id FROM product_variants WHERE id = ? AND active = 1",
      input.variantId,
    ).toArray()[0];
    if (!variant) return Response.json({ error: "Product variant not found" }, { status: 404 });

    const conflict = this.supplierSkuConflict(input.supplierId, input.variantId, input.supplierSku);
    if (conflict) {
      return Response.json({
        error: `Supplier SKU ${input.supplierSku?.trim()} is already mapped to ${conflict.product_name} · ${conflict.variant_name} (${conflict.sku})`,
      }, { status: 409 });
    }

    const hasMinimum = Object.prototype.hasOwnProperty.call(input, "minimumOrderQuantity");
    const hasMultiple = Object.prototype.hasOwnProperty.call(input, "orderMultiple");
    const updatedAt = now();

    this.orderPlanningCtx.storage.transactionSync(() => {
      this.orderPlanningCtx.storage.sql.exec(
        `INSERT INTO supplier_variants (
           supplier_id, variant_id, supplier_sku, last_cost_minor, lead_time_days,
           minimum_order_quantity, order_multiple
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(supplier_id, variant_id) DO UPDATE SET
           supplier_sku = excluded.supplier_sku,
           last_cost_minor = excluded.last_cost_minor,
           lead_time_days = excluded.lead_time_days,
           minimum_order_quantity = CASE WHEN ? = 1 THEN excluded.minimum_order_quantity ELSE supplier_variants.minimum_order_quantity END,
           order_multiple = CASE WHEN ? = 1 THEN excluded.order_multiple ELSE supplier_variants.order_multiple END`,
        input.supplierId,
        input.variantId,
        input.supplierSku?.trim() || null,
        input.lastCostMinor ?? null,
        input.leadTimeDays ?? null,
        input.minimumOrderQuantity ?? null,
        input.orderMultiple ?? null,
        hasMinimum ? 1 : 0,
        hasMultiple ? 1 : 0,
      );
      this.orderPlanningCtx.storage.sql.exec(
        `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at)
         VALUES (?, ?, ?, 'supplier_variant.updated', 'supplier_variant', ?, ?, ?)`,
        crypto.randomUUID(),
        actorId,
        actorRole,
        `${input.supplierId}:${input.variantId}`,
        JSON.stringify({
          supplierId: input.supplierId,
          variantId: input.variantId,
          minimumOrderQuantity: hasMinimum ? input.minimumOrderQuantity ?? null : undefined,
          orderMultiple: hasMultiple ? input.orderMultiple ?? null : undefined,
        }),
        updatedAt,
      );
    });

    return Response.json({ ok: true });
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
