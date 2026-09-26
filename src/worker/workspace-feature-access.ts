import {
  effectiveWorkspaceFeatures,
  type WorkspaceFeatureKey,
} from "../shared/features";
import type { WorkspaceModuleKey } from "../shared/modules";
import type { Role } from "../shared/types";

type FeatureState = { key: WorkspaceFeatureKey; enabled: boolean };
type FeaturesResponse = { features: FeatureState[] };
type ModulesResponse = { modules: Array<{ key: WorkspaceModuleKey; enabled: boolean }> };
type Actor = { id: string; role: Role; name?: string };
type TenantFeatureStub = { fetch(request: Request): Promise<Response> };

async function tenantJson<T>(stub: TenantFeatureStub, path: string, actor: Actor) {
  const response = await stub.fetch(new Request(`https://tenant.internal${path}`, {
    headers: {
      "x-ordermate-actor-id": actor.id,
      "x-ordermate-actor-role": actor.role,
      ...(actor.name ? { "x-ordermate-actor-name": actor.name } : {}),
    },
  }));
  if (!response.ok) throw new Error(`Workspace feature read failed (${response.status})`);
  return response.json<T>();
}

export async function workspaceFeatureEnabled(
  stub: TenantFeatureStub,
  key: WorkspaceFeatureKey,
  actor: Actor,
) {
  const [features, modules] = await Promise.all([
    tenantJson<FeaturesResponse>(stub, "/features", actor),
    tenantJson<ModulesResponse>(stub, "/modules", actor),
  ]);
  const configured = Object.fromEntries(features.features.map(feature => [feature.key, feature.enabled])) as Record<WorkspaceFeatureKey, boolean>;
  const enabledModules = new Set(modules.modules.filter(module => module.enabled).map(module => module.key));
  return effectiveWorkspaceFeatures(configured, enabledModules).has(key);
}
