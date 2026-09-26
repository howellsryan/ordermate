import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  effectiveWorkspaceFeatures,
  type WorkspaceFeatureKey,
} from "../shared/features";
import type { WorkspaceModuleKey } from "../shared/modules";
import { tenantApi } from "./api";
import { demoFeatures, demoFeaturesApi } from "./demo-features";
import { isDemoTenant } from "./demo-store";

export type WorkspaceFeatureState = {
  key: WorkspaceFeatureKey;
  label: string;
  description: string;
  group: string;
  requiredModules: WorkspaceModuleKey[];
  dependencies: WorkspaceFeatureKey[];
  enabled: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

type ModulesResponse = { modules: Array<{ key: WorkspaceModuleKey; enabled: boolean }> };
export type FeaturesResponse = { features: WorkspaceFeatureState[] };

export async function getWorkspaceFeatures(tenantId: string): Promise<FeaturesResponse> {
  return isDemoTenant(tenantId) ? demoFeatures() : tenantApi<FeaturesResponse>(tenantId, "/features");
}

export async function updateWorkspaceFeature(tenantId: string, key: WorkspaceFeatureKey, enabled: boolean): Promise<FeaturesResponse> {
  if (isDemoTenant(tenantId)) {
    return demoFeaturesApi(`/features/${key}`, { method: "PATCH", body: JSON.stringify({ enabled }) }) as Promise<FeaturesResponse>;
  }
  return tenantApi<FeaturesResponse>(tenantId, `/features/${key}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function useWorkspaceFeatures(tenantId?: string) {
  const query = useQuery({
    queryKey: ["tenant", tenantId, "features"],
    queryFn: () => getWorkspaceFeatures(tenantId!),
    enabled: !!tenantId,
  });
  const modules = useQuery({
    queryKey: ["tenant", tenantId, "modules"],
    queryFn: () => tenantApi<ModulesResponse>(tenantId!, "/modules"),
    enabled: !!tenantId,
  });
  const enabled = useMemo(() => {
    if (!query.data || !modules.data) return new Set<WorkspaceFeatureKey>();
    const configured = Object.fromEntries(query.data.features.map(feature => [feature.key, feature.enabled])) as Record<WorkspaceFeatureKey, boolean>;
    const enabledModules = new Set(modules.data.modules.filter(module => module.enabled).map(module => module.key));
    return effectiveWorkspaceFeatures(configured, enabledModules);
  }, [query.data, modules.data]);
  return { ...query, enabled, modulesReady: !!modules.data, modulesError: modules.error };
}

export function featureEnabled(response: FeaturesResponse | undefined, key: WorkspaceFeatureKey) {
  return response?.features.some(feature => feature.key === key && feature.enabled) ?? false;
}
