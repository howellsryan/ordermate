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
  "catalogue_import",
  "wave_picking",
  "cycle_counts",
  "barcode_lookup",
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
    key: "catalogue_import",
    label: "Catalogue CSV import",
    description: "Allow reviewed CSV catalogue imports for products, variants, supplier mappings and opening stock.",
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
  {
    key: "barcode_lookup",
    label: "Barcode lookup",
    description: "Show the quick inventory barcode lookup tool for scanner-led stock checks.",
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

export function validateFeatureConfiguration(states: Record<WorkspaceFeatureKey, boolean>) {
  const errors: string[] = [];
  for (const definition of WORKSPACE_FEATURES) {
    if (!states[definition.key]) continue;
    for (const dependency of definition.dependencies) {
      if (!states[dependency]) {
        errors.push(`${definition.label} requires ${WORKSPACE_FEATURE_BY_KEY[dependency].label}.`);
      }
    }
  }
  return errors;
}
