import type { MigrationHealth, OnboardingHealth, OnboardingStep } from "../shared/onboarding-health";
import { migrateIntegrationSchema } from "./integration-schema";

function now() {
  return new Date().toISOString();
}

export class OnboardingRuntime {
  constructor(private readonly ctx: DurableObjectState) {
    migrateIntegrationSchema(ctx.storage);
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (request.method !== "GET" || path !== "/onboarding/health") return null;
    if (!request.headers.get("x-ordermate-actor-id") || !request.headers.get("x-ordermate-actor-role")) {
      return Response.json({ error: "Missing authenticated actor context" }, { status: 401 });
    }
    return Response.json(this.health());
  }

  private one<T>(query: string, ...bindings: unknown[]): T | undefined {
    return this.ctx.storage.sql.exec<T & Record<string, string | number | null>>(query, ...bindings).toArray()[0] as T | undefined;
  }

  private migrationHealth(): MigrationHealth {
    const connection = this.one<{ total: number; healthy: number; last_success_at: string | null }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'active' AND last_error IS NULL THEN 1 ELSE 0 END), 0) AS healthy,
              MAX(last_success_at) AS last_success_at
       FROM integration_connections WHERE status != 'disconnected'`,
    ) || { total: 0, healthy: 0, last_success_at: null };
    const approved = this.one<{ count: number }>("SELECT COUNT(*) AS count FROM integration_entity_links")?.count ?? 0;
    const review = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM integration_external_entities WHERE match_status != 'mapped'",
    )?.count ?? 0;
    const exceptions = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM integration_exceptions WHERE status = 'open'",
    )?.count ?? 0;
    const outbound = this.one<{ pending: number; retrying: number; failed: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'retry_wait' THEN 1 ELSE 0 END), 0) AS retrying,
         COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM integration_outbound_jobs`,
    ) || { pending: 0, retrying: 0, failed: 0 };
    const drift = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM integration_reconciliation WHERE status IN ('drift','error')",
    )?.count ?? 0;
    const pendingReturns = this.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM integration_return_cases WHERE disposition = 'pending'",
    )?.count ?? 0;

    const blockers: string[] = [];
    if (connection.total > 0 && connection.healthy < connection.total) blockers.push("One or more integrations need attention");
    if (review > 0) blockers.push(`${review} integration mapping${review === 1 ? " needs" : "s need"} review`);
    if (exceptions > 0) blockers.push(`${exceptions} open integration exception${exceptions === 1 ? "" : "s"}`);
    if (outbound.failed > 0) blockers.push(`${outbound.failed} outbound publish job${outbound.failed === 1 ? " has" : "s have"} failed`);
    if (drift > 0) blockers.push(`${drift} reconciliation record${drift === 1 ? " is" : "s are"} out of sync`);
    if (pendingReturns > 0) blockers.push(`${pendingReturns} return${pendingReturns === 1 ? " needs" : "s need"} an explicit disposition`);

    return {
      connections: connection.total,
      healthyConnections: connection.healthy,
      mappingsApproved: approved,
      mappingsNeedingReview: review,
      openIntegrationExceptions: exceptions,
      outboundPending: outbound.pending,
      outboundRetrying: outbound.retrying,
      outboundFailed: outbound.failed,
      reconciliationDrift: drift,
      pendingReturnDispositions: pendingReturns,
      lastIntegrationSuccessAt: connection.last_success_at,
      blockers,
    };
  }

  private health(): OnboardingHealth {
    const settings = this.one<{ business_name: string; created_at: string }>(
      "SELECT business_name, created_at FROM tenant_settings WHERE id = 1",
    ) || { business_name: "My business", created_at: now() };
    const locations = this.one<{ count: number }>("SELECT COUNT(*) AS count FROM locations WHERE active = 1")?.count ?? 0;
    const variants = this.one<{ count: number }>("SELECT COUNT(*) AS count FROM product_variants WHERE active = 1")?.count ?? 0;
    const inventoryPositions = this.one<{ count: number }>("SELECT COUNT(*) AS count FROM inventory_levels")?.count ?? 0;
    const firstValue = this.one<{ value: string | null }>(
      `SELECT MIN(value) AS value FROM (
         SELECT MIN(created_at) AS value FROM orders
         UNION ALL SELECT MIN(created_at) AS value FROM purchase_orders
         UNION ALL SELECT MIN(created_at) AS value FROM inventory_movements
       ) WHERE value IS NOT NULL`,
    )?.value || null;
    const migration = this.migrationHealth();

    const businessComplete = settings.business_name.trim() !== "" && settings.business_name !== "My business";
    const locationsComplete = locations > 0;
    const catalogueComplete = variants > 0;
    const inventoryComplete = inventoryPositions > 0;
    const coreReady = businessComplete && locationsComplete && catalogueComplete && inventoryComplete;
    const integrationComplete = migration.connections > 0 && migration.blockers.length === 0;

    const steps: OnboardingStep[] = [
      {
        key: "business",
        title: "Confirm the business basics",
        detail: businessComplete ? `Operating Layer is configured for ${settings.business_name}.` : "Set the business name, currency and tax defaults before importing live records.",
        status: businessComplete ? "complete" : "ready",
        actionLabel: businessComplete ? null : "Open business settings",
        page: "settings",
        evidence: businessComplete ? [settings.business_name] : [],
      },
      {
        key: "locations",
        title: "Set the places stock actually lives",
        detail: locationsComplete ? `${locations} active location${locations === 1 ? " is" : "s are"} ready.` : "Create at least one operational location before bringing stock or orders across.",
        status: locationsComplete ? "complete" : businessComplete ? "ready" : "blocked",
        actionLabel: locationsComplete ? null : "Set up locations",
        page: "inventory",
        evidence: locationsComplete ? [`${locations} active location${locations === 1 ? "" : "s"}`] : [],
      },
      {
        key: "catalogue",
        title: "Bring across the catalogue",
        detail: catalogueComplete ? `${variants} active variant${variants === 1 ? " is" : "s are"} available for operations.` : "Import or create products and variants, preserving SKU/barcode identity for integration mapping.",
        status: catalogueComplete ? "complete" : locationsComplete ? "ready" : "blocked",
        actionLabel: catalogueComplete ? null : "Import catalogue",
        page: "products",
        evidence: catalogueComplete ? [`${variants} active variant${variants === 1 ? "" : "s"}`] : [],
      },
      {
        key: "inventory",
        title: "Establish the opening stock position",
        detail: inventoryComplete ? `${inventoryPositions} tracked stock position${inventoryPositions === 1 ? " is" : "s are"} established.` : "Record opening on-hand stock—even zero counts—so availability has an explicit baseline.",
        status: inventoryComplete ? "complete" : catalogueComplete ? "ready" : "blocked",
        actionLabel: inventoryComplete ? null : "Set opening stock",
        page: "inventory",
        evidence: inventoryComplete ? [`${inventoryPositions} inventory position${inventoryPositions === 1 ? "" : "s"}`] : [],
      },
      {
        key: "integration",
        title: "Connect channels and accounting",
        detail: migration.connections === 0
          ? "Optional for manual-first teams. Connect Shopify or Xero when you are ready to remove duplicate entry."
          : integrationComplete
            ? `${migration.healthyConnections} connected provider${migration.healthyConnections === 1 ? " is" : "s are"} healthy and reconciled.`
            : "The connection exists, but migration health still has blockers to clear before treating it as hands-off.",
        status: migration.connections === 0 ? "optional" : integrationComplete ? "complete" : "blocked",
        actionLabel: migration.connections === 0 || !integrationComplete ? "Review integrations" : null,
        page: "settings",
        evidence: [
          `${migration.connections} connection${migration.connections === 1 ? "" : "s"}`,
          `${migration.mappingsApproved} approved mapping${migration.mappingsApproved === 1 ? "" : "s"}`,
          ...migration.blockers.slice(0, 3),
        ],
      },
      {
        key: "first_value",
        title: "Complete the first real operational loop",
        detail: firstValue
          ? "The workspace has recorded its first real operational transaction. From here, onboarding should shift to exception reduction and team adoption."
          : coreReady
            ? "Create or import the first order, purchase receipt or stock movement to prove the workflow end to end."
            : "Finish the operational baseline first; the first transaction should validate the setup rather than discover it.",
        status: firstValue ? "complete" : coreReady ? "ready" : "blocked",
        actionLabel: firstValue ? null : coreReady ? "Create the first transaction" : null,
        page: "overview",
        evidence: firstValue ? [`First operational value recorded ${firstValue}`] : [],
      },
    ];

    const scoreable = steps.filter(step => step.status !== "optional");
    const complete = scoreable.filter(step => step.status === "complete").length;
    const nextStep = steps.find(step => step.status === "ready") || steps.find(step => step.status === "blocked") || null;
    const startedAt = new Date(settings.created_at).getTime();
    const firstValueAt = firstValue ? new Date(firstValue).getTime() : Number.NaN;
    const timeToFirstValueMinutes = firstValue && Number.isFinite(startedAt) && Number.isFinite(firstValueAt)
      ? Math.max(0, Math.round((firstValueAt - startedAt) / 60_000))
      : null;

    return {
      generatedAt: now(),
      progressPercent: scoreable.length ? Math.round(complete / scoreable.length * 100) : 0,
      readyForFirstValue: coreReady,
      firstValueAt: firstValue,
      timeToFirstValueMinutes,
      nextStep,
      steps,
      migration,
    };
  }
}
