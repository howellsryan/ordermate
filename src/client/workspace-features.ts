import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceFeatureKey } from "../shared/features";
import { tenantApi } from "./api";

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

export function useWorkspaceFeatures(tenantId: string) {
  const query = useQuery({
    queryKey: ["tenant", tenantId, "features"],
    queryFn: () => tenantApi<FeaturesResponse>(tenantId, "/features"),
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
