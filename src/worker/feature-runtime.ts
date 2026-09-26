import { z } from "zod";
import {
  WORKSPACE_FEATURES,
  WORKSPACE_FEATURE_KEYS,
  WORKSPACE_FEATURE_BY_KEY,
  isWorkspaceFeatureKey,
  validateFeatureConfiguration,
  type WorkspaceFeatureKey,
} from "../shared/features";

type Actor = { id: string; role: string };
type FeatureRow = { module_key: string; enabled: number; updated_at: string; updated_by: string };

const featurePatchInput = z.object({ enabled: z.boolean() });
const timestamp = () => new Date().toISOString();
const responseError = (message: string, status = 400) => Response.json({ error: message }, { status });
const storageKey = (key: WorkspaceFeatureKey) => `feature:${key}`;

const FEATURE_ROUTE_PREFIXES: ReadonlyArray<{ feature: WorkspaceFeatureKey; matches: (path: string) => boolean }> = [
  { feature: "operating_intelligence", matches: path => path.startsWith("/replenishment") },
  { feature: "delivery_discrepancies", matches: path => path.startsWith("/delivery-discrepancies") },
  { feature: "saved_views", matches: path => path.startsWith("/saved-views") },
  { feature: "cycle_counts", matches: path => path === "/inventory/stocktake" },
];

export class FeatureRuntime {
  constructor(private readonly ctx: DurableObjectState) {}

  async handle(request: Request): Promise<Response | null> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const method = request.method;

      if (method === "GET" && path === "/features") return this.listFeatures();
      const featureMatch = path.match(/^\/features\/([^/]+)$/);
      if (method === "PATCH" && featureMatch) return await this.updateFeature(decodeURIComponent(featureMatch[1]), request);

      const requiredFeature = FEATURE_ROUTE_PREFIXES.find(entry => entry.matches(path))?.feature;
      if (requiredFeature && !this.featureEnabled(requiredFeature)) {
        // The shared attention aggregator reads the open discrepancy queue. Returning
        // an empty list keeps Overview healthy while ensuring the disabled feature
        // contributes no discrepancy work to the user's journey.
        if (requiredFeature === "delivery_discrepancies" && method === "GET") return Response.json([]);
        return responseError(`${WORKSPACE_FEATURE_BY_KEY[requiredFeature].label} is disabled for this workspace.`, 404);
      }

      return null;
    } catch (cause) {
      if (cause instanceof z.ZodError) return responseError(cause.issues[0]?.message || "Invalid feature configuration", 400);
      console.error("Feature runtime request failed", cause);
      return responseError(cause instanceof Error ? cause.message : "Unexpected error", 500);
    }
  }

  private actor(request: Request): Actor {
    return {
      id: request.headers.get("x-ordermate-actor-id") || "system",
      role: request.headers.get("x-ordermate-actor-role") || "unknown",
    };
  }

  private featureRows() {
    return this.ctx.storage.sql.exec<FeatureRow>(
      "SELECT module_key, enabled, updated_at, updated_by FROM workspace_modules WHERE module_key LIKE 'feature:%' ORDER BY module_key",
    ).toArray();
  }

  private featureEnabled(key: WorkspaceFeatureKey) {
    const row = this.ctx.storage.sql.exec<{ enabled: number }>(
      "SELECT enabled FROM workspace_modules WHERE module_key = ?",
      storageKey(key),
    ).toArray()[0];
    return row ? row.enabled === 1 : WORKSPACE_FEATURE_BY_KEY[key].defaultEnabled;
  }

  private listFeatures() {
    const rows = new Map(this.featureRows().map(row => [row.module_key.replace(/^feature:/, ""), row]));
    return Response.json({
      features: WORKSPACE_FEATURES.map(definition => {
        const row = rows.get(definition.key);
        return {
          ...definition,
          requiredModules: [...definition.requiredModules],
          dependencies: [...definition.dependencies],
          enabled: row ? row.enabled === 1 : definition.defaultEnabled,
          updated_at: row?.updated_at ?? null,
          updated_by: row?.updated_by ?? null,
        };
      }),
    });
  }

  private async updateFeature(rawKey: string, request: Request) {
    if (!isWorkspaceFeatureKey(rawKey)) return responseError("Unknown workspace feature", 404);
    const { enabled } = featurePatchInput.parse(await request.json());
    const actor = this.actor(request);
    const current = Object.fromEntries(WORKSPACE_FEATURE_KEYS.map(key => [key, this.featureEnabled(key)])) as Record<WorkspaceFeatureKey, boolean>;
    current[rawKey] = enabled;
    const errors = validateFeatureConfiguration(current);
    if (errors.length) return responseError(errors.join(" "), 409);

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_modules (module_key, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        storageKey(rawKey),
        enabled ? 1 : 0,
        timestamp(),
        actor.id,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'workspace_feature.updated', 'workspace_feature', ?, ?, ?)",
        crypto.randomUUID(),
        actor.id,
        actor.role,
        rawKey,
        JSON.stringify({ enabled }),
        timestamp(),
      );
    });
    return this.listFeatures();
  }
}
