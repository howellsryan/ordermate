import { z } from "zod";
import {
  WORKSPACE_FEATURES,
  WORKSPACE_FEATURE_KEYS,
  isWorkspaceFeatureKey,
  validateFeatureConfiguration,
  type WorkspaceFeatureKey,
} from "../shared/features";

type Actor = { id: string; role: string };
type FeatureRow = { feature_key: string; enabled: number; updated_at: string; updated_by: string };

const featurePatchInput = z.object({ enabled: z.boolean() });
const timestamp = () => new Date().toISOString();
const responseError = (message: string, status = 400) => Response.json({ error: message }, { status });

const FEATURE_ROUTE_PREFIXES: ReadonlyArray<{ feature: WorkspaceFeatureKey; matches: (path: string) => boolean }> = [
  { feature: "operating_intelligence", matches: path => path.startsWith("/replenishment") },
  { feature: "delivery_discrepancies", matches: path => path.startsWith("/delivery-discrepancies") },
  { feature: "saved_views", matches: path => path.startsWith("/saved-views") },
  { feature: "cycle_counts", matches: path => path === "/inventory/stocktake" },
  { feature: "barcode_lookup", matches: path => path.startsWith("/inventory/barcode/") },
  { feature: "catalogue_import", matches: path => path.startsWith("/imports/catalogue") },
];

export class FeatureRuntime {
  constructor(private readonly ctx: DurableObjectState) {}

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = request.method;

    if (method === "GET" && path === "/features") return this.listFeatures();
    const featureMatch = path.match(/^\/features\/([^/]+)$/);
    if (method === "PATCH" && featureMatch) return this.updateFeature(decodeURIComponent(featureMatch[1]), request);

    const requiredFeature = FEATURE_ROUTE_PREFIXES.find(entry => entry.matches(path))?.feature;
    if (requiredFeature && !this.featureEnabled(requiredFeature)) {
      const definition = WORKSPACE_FEATURES.find(feature => feature.key === requiredFeature);
      return responseError(`${definition?.label || requiredFeature} is disabled for this workspace.`, 404);
    }

    return null;
  }

  private actor(request: Request): Actor {
    return {
      id: request.headers.get("x-ordermate-actor-id") || "system",
      role: request.headers.get("x-ordermate-actor-role") || "unknown",
    };
  }

  private featureRows() {
    return this.ctx.storage.sql.exec<FeatureRow>("SELECT feature_key, enabled, updated_at, updated_by FROM workspace_features ORDER BY feature_key").toArray();
  }

  private featureEnabled(key: WorkspaceFeatureKey) {
    return this.ctx.storage.sql.exec<{ enabled: number }>("SELECT enabled FROM workspace_features WHERE feature_key = ?", key).toArray()[0]?.enabled === 1;
  }

  private listFeatures() {
    const rows = new Map(this.featureRows().map(row => [row.feature_key, row]));
    return Response.json({
      features: WORKSPACE_FEATURES.map(definition => {
        const row = rows.get(definition.key);
        return {
          ...definition,
          requiredModules: [...definition.requiredModules],
          dependencies: [...definition.dependencies],
          enabled: row?.enabled === 1,
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
        `INSERT INTO workspace_features (feature_key, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(feature_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        rawKey,
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
