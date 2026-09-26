import {
  WORKSPACE_MODULES,
  WORKSPACE_MODULE_KEYS,
  defaultModuleConfiguration,
  isWorkspaceModuleKey,
  validateModuleConfiguration,
  type WorkspaceModuleKey,
} from "../shared/modules";

const DEMO_MODULES_KEY = "operating-layer:demo-modules:v1";

type DemoModuleConfig = Record<WorkspaceModuleKey, boolean>;

function readConfig(): DemoModuleConfig {
  if (typeof window === "undefined") return defaultModuleConfiguration();
  const raw = window.localStorage.getItem(DEMO_MODULES_KEY);
  if (!raw) return defaultModuleConfiguration();
  try {
    const parsed = JSON.parse(raw) as Partial<DemoModuleConfig>;
    return Object.fromEntries(WORKSPACE_MODULE_KEYS.map(key => [key, typeof parsed[key] === "boolean" ? parsed[key] : defaultModuleConfiguration()[key]])) as DemoModuleConfig;
  } catch {
    return defaultModuleConfiguration();
  }
}

function saveConfig(config: DemoModuleConfig) {
  window.localStorage.setItem(DEMO_MODULES_KEY, JSON.stringify(config));
}

export function resetDemoModules() {
  window.localStorage.removeItem(DEMO_MODULES_KEY);
}

export function demoModules() {
  const config = readConfig();
  return {
    modules: WORKSPACE_MODULES.map(module => ({
      ...module,
      enabled: config[module.key],
      updated_at: null,
      updated_by: "demo-user",
    })),
  };
}

export async function demoModulesApi(path: string, init?: RequestInit) {
  const url = new URL(path, "https://demo.local");
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" && url.pathname === "/modules") return demoModules();

  const match = url.pathname.match(/^\/modules\/([^/]+)$/);
  if (method === "PATCH" && match) {
    const key = decodeURIComponent(match[1]);
    if (!isWorkspaceModuleKey(key)) throw new Error("Unknown workspace module");
    let body: unknown = {};
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { throw new Error("Invalid module configuration"); }
    }
    const enabled = body && typeof body === "object" && "enabled" in body ? (body as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled !== "boolean") throw new Error("Enabled must be true or false");

    const config = readConfig();
    config[key] = enabled;
    const errors = validateModuleConfiguration(config);
    if (errors.length) throw new Error(errors.join(" "));
    saveConfig(config);
    return demoModules();
  }

  throw new Error("Demo module route not found");
}

export function demoModuleEnabled(key: WorkspaceModuleKey) {
  return readConfig()[key];
}
