import {
  WORKSPACE_FEATURES,
  WORKSPACE_FEATURE_KEYS,
  defaultFeatureConfiguration,
  isWorkspaceFeatureKey,
  validateFeatureConfiguration,
  type WorkspaceFeatureKey,
} from "../shared/features";

const DEMO_FEATURES_KEY = "operating-layer:demo-features:v1";

type DemoFeatureConfig = Record<WorkspaceFeatureKey, boolean>;

function readConfig(): DemoFeatureConfig {
  if (typeof window === "undefined") return defaultFeatureConfiguration();
  const raw = window.localStorage.getItem(DEMO_FEATURES_KEY);
  if (!raw) return defaultFeatureConfiguration();
  try {
    const parsed = JSON.parse(raw) as Partial<DemoFeatureConfig>;
    const defaults = defaultFeatureConfiguration();
    return Object.fromEntries(WORKSPACE_FEATURE_KEYS.map(key => [key, typeof parsed[key] === "boolean" ? parsed[key] : defaults[key]])) as DemoFeatureConfig;
  } catch {
    return defaultFeatureConfiguration();
  }
}

function saveConfig(config: DemoFeatureConfig) {
  window.localStorage.setItem(DEMO_FEATURES_KEY, JSON.stringify(config));
}

export function resetDemoFeatures() {
  window.localStorage.removeItem(DEMO_FEATURES_KEY);
}

export function demoFeatures() {
  const config = readConfig();
  return {
    features: WORKSPACE_FEATURES.map(feature => ({
      ...feature,
      requiredModules: [...feature.requiredModules],
      dependencies: [...feature.dependencies],
      enabled: config[feature.key],
      updated_at: null,
      updated_by: "demo-user",
    })),
  };
}

export async function demoFeaturesApi(path: string, init?: RequestInit) {
  const url = new URL(path, "https://demo.local");
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" && url.pathname === "/features") return demoFeatures();

  const match = url.pathname.match(/^\/features\/([^/]+)$/);
  if (method === "PATCH" && match) {
    const key = decodeURIComponent(match[1]);
    if (!isWorkspaceFeatureKey(key)) throw new Error("Unknown workspace feature");
    let body: unknown = {};
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { throw new Error("Invalid feature configuration"); }
    }
    const enabled = body && typeof body === "object" && "enabled" in body ? (body as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled !== "boolean") throw new Error("Enabled must be true or false");
    const config = readConfig();
    config[key] = enabled;
    const errors = validateFeatureConfiguration(config);
    if (errors.length) throw new Error(errors.join(" "));
    saveConfig(config);
    return demoFeatures();
  }

  throw new Error("Demo feature route not found");
}

export function demoFeatureEnabled(key: WorkspaceFeatureKey) {
  return readConfig()[key];
}
