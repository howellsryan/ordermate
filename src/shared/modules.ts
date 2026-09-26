export const WORKSPACE_MODULE_KEYS = [
  "crm",
  "service",
  "orders",
  "inventory",
  "purchasing",
  "warehouse",
  "reports",
] as const;

export type WorkspaceModuleKey = typeof WORKSPACE_MODULE_KEYS[number];

export type WorkspaceModuleDefinition = {
  key: WorkspaceModuleKey;
  label: string;
  description: string;
  dependencies: readonly WorkspaceModuleKey[];
  defaultEnabled: boolean;
};

export const WORKSPACE_MODULES: readonly WorkspaceModuleDefinition[] = [
  {
    key: "crm",
    label: "CRM",
    description: "Prospects, customers and shared contact history.",
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "service",
    label: "Service",
    description: "Requests, quotes, jobs, visits, invoices and payments.",
    dependencies: ["crm"],
    defaultEnabled: false,
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Stock levels, movements, transfers and cycle counts.",
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "orders",
    label: "Orders",
    description: "Customer sales, reservations, fulfilment and returns.",
    dependencies: ["inventory"],
    defaultEnabled: true,
  },
  {
    key: "purchasing",
    label: "Purchasing",
    description: "Suppliers, replenishment, purchase orders and receiving.",
    dependencies: ["inventory"],
    defaultEnabled: true,
  },
  {
    key: "warehouse",
    label: "Warehouse",
    description: "Operational picking, receiving and warehouse execution.",
    dependencies: ["inventory"],
    defaultEnabled: true,
  },
  {
    key: "reports",
    label: "Reports",
    description: "Operational and commercial read models across enabled modules.",
    dependencies: [],
    defaultEnabled: true,
  },
] as const;

export const WORKSPACE_MODULE_BY_KEY = Object.fromEntries(
  WORKSPACE_MODULES.map(module => [module.key, module]),
) as Record<WorkspaceModuleKey, WorkspaceModuleDefinition>;

export type WorkspaceModuleState = {
  key: WorkspaceModuleKey;
  enabled: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
};

export function isWorkspaceModuleKey(value: string): value is WorkspaceModuleKey {
  return (WORKSPACE_MODULE_KEYS as readonly string[]).includes(value);
}

export function validateModuleConfiguration(states: Record<WorkspaceModuleKey, boolean>) {
  const errors: string[] = [];
  for (const definition of WORKSPACE_MODULES) {
    if (!states[definition.key]) continue;
    for (const dependency of definition.dependencies) {
      if (!states[dependency]) {
        errors.push(`${definition.label} requires ${WORKSPACE_MODULE_BY_KEY[dependency].label}.`);
      }
    }
  }

  if (states.warehouse && !states.orders && !states.purchasing) {
    errors.push("Warehouse requires Orders or Purchasing as an execution source.");
  }

  return errors;
}

export function defaultModuleConfiguration(): Record<WorkspaceModuleKey, boolean> {
  return Object.fromEntries(WORKSPACE_MODULES.map(module => [module.key, module.defaultEnabled])) as Record<WorkspaceModuleKey, boolean>;
}
