import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceFeatureKey } from "../shared/features";
import { tenantApi } from "./api";
import { demoFeatures, demoFeaturesApi } from "./demo-features";
import { isDemoTenant } from "./demo-store";

export type WorkspaceFeatureState = {
  key: WorkspaceFeatureKey;
  label: string;
  description: string;
  group: string;
  requiredModules: string[];
  dependencies: WorkspaceFeatureKey[];
  enabled: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

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

export function useWorkspaceFeatures(tenantId: string) {
  const query = useQuery({
    queryKey: ["tenant", tenantId, "features"],
    queryFn: () => getWorkspaceFeatures(tenantId),
  });
  const enabled = useMemo(
    () => new Set(query.data?.features.filter(feature => feature.enabled).map(feature => feature.key) || []),
    [query.data],
  );
  return { ...query, enabled };
}

export function featureEnabled(response: FeaturesResponse | undefined, key: WorkspaceFeatureKey) {
  return response?.features.some(feature => feature.key === key && feature.enabled) ?? false;
}
