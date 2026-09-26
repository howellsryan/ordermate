import type { WorkspaceModuleKey } from "./modules";

export const WORKSPACE_FEATURE_KEYS = [
  "flow_plan",
  "operating_intelligence",
  "operations_copilot",
  "smart_buy_batches",
  "document_assist",
  "delivery_discrepancies",
  "saved_views",
  "inventory_history",
  "wave_picking",
  "cycle_counts",
] as const;

export type WorkspaceFeatureKey = typeof WORKSPACE_FEATURE_KEYS[number];

export type WorkspaceFeatureDefinition = {
  key: WorkspaceFeatureKey;
  label: string;
  description: string;
  group: "Automation & intelligence" | "Purchasing" | "Inventory & warehouse" | "Productivity";
  requiredModules: readonly WorkspaceModuleKey[];
  dependencies: readonly WorkspaceFeatureKey[];
  defaultEnabled: boolean;
};

export const WORKSPACE_FEATURES: readonly WorkspaceFeatureDefinition[] = [
  {
    key: "flow_plan",
    label: "Automatic Flow Plan",
    description: "Prioritise the most important customer, stock, supply and receiving exceptions on Overview.",
    group: "Automation & intelligence",
    requiredModules: ["orders", "inventory", "purchasing"],
    dependencies: ["operating_intelligence"],
    defaultEnabled: true,
  },
  {
    key: "operating_intelligence",
    label: "Operating Intelligence",
    description: "Forward stock forecasting, shortage planning, scenarios and replenishment recommendations.",
    group: "Automation & intelligence",
    requiredModules: ["inventory", "purchasing"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "operations_copilot",
    label: "Operations copilot",
    description: "Show Ask Operating Layer, the read-only assistant over permitted operational data.",
    group: "Automation & intelligence",
    requiredModules: ["orders", "inventory", "purchasing"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "smart_buy_batches",
    label: "Smart Buy batches",
    description: "Group due replenishment recommendations into reviewable supplier purchase-order drafts.",
    group: "Automation & intelligence",
    requiredModules: ["inventory", "purchasing"],
    dependencies: ["operating_intelligence"],
    defaultEnabled: true,
  },
  {
    key: "document_assist",
    label: "Document assist",
    description: "Show purchase-document and delivery-note assisted workflows where available.",
    group: "Purchasing",
    requiredModules: ["purchasing"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "delivery_discrepancies",
    label: "Delivery discrepancies",
    description: "Track and resolve receiving discrepancies against purchase orders.",
    group: "Purchasing",
    requiredModules: ["purchasing"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "saved_views",
    label: "Saved views",
    description: "Save reusable inventory and purchasing filter combinations for the signed-in user.",
    group: "Productivity",
    requiredModules: [],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "inventory_history",
    label: "Inventory history",
    description: "Show the detailed immutable movement history beneath Inventory.",
    group: "Inventory & warehouse",
    requiredModules: ["inventory"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "wave_picking",
    label: "Wave picking",
    description: "Batch compatible confirmed orders into one reviewed warehouse picking session.",
    group: "Inventory & warehouse",
    requiredModules: ["orders", "warehouse"],
    dependencies: [],
    defaultEnabled: true,
  },
  {
    key: "cycle_counts",
    label: "Cycle counts",
    description: "Show the cycle-count workflow for reconciling physical stock with recorded stock.",
    group: "Inventory & warehouse",
    requiredModules: ["inventory"],
    dependencies: [],
    defaultEnabled: true,
  },
] as const;

export const WORKSPACE_FEATURE_BY_KEY = Object.fromEntries(
  WORKSPACE_FEATURES.map(feature => [feature.key, feature]),
) as Record<WorkspaceFeatureKey, WorkspaceFeatureDefinition>;

export function isWorkspaceFeatureKey(value: string): value is WorkspaceFeatureKey {
  return (WORKSPACE_FEATURE_KEYS as readonly string[]).includes(value);
}

export function defaultFeatureConfiguration(): Record<WorkspaceFeatureKey, boolean> {
  return Object.fromEntries(WORKSPACE_FEATURES.map(feature => [feature.key, feature.defaultEnabled])) as Record<WorkspaceFeatureKey, boolean>;
}

/**
 * Feature dependencies are activation requirements, not destructive configuration
 * constraints. A child preference stays remembered when its parent feature or module
 * is temporarily disabled, so switching the parent back on restores the prior setup.
 */
export function validateFeatureConfiguration(_states: Record<WorkspaceFeatureKey, boolean>) {
  return [] as string[];
}

/** Resolve configured preferences into the features that are actually usable now. */
export function effectiveWorkspaceFeatures(
  states: Record<WorkspaceFeatureKey, boolean>,
  enabledModules: ReadonlySet<WorkspaceModuleKey>,
): Set<WorkspaceFeatureKey> {
  const effective = new Set<WorkspaceFeatureKey>();
  const resolving = new Set<WorkspaceFeatureKey>();

  const active = (key: WorkspaceFeatureKey): boolean => {
    if (effective.has(key)) return true;
    if (!states[key] || resolving.has(key)) return false;
    const definition = WORKSPACE_FEATURE_BY_KEY[key];
    if (!definition.requiredModules.every(module => enabledModules.has(module))) return false;
    resolving.add(key);
    const dependenciesActive = definition.dependencies.every(active);
    resolving.delete(key);
    if (dependenciesActive) effective.add(key);
    return dependenciesActive;
  };

  for (const key of WORKSPACE_FEATURE_KEYS) active(key);
  return effective;
}
