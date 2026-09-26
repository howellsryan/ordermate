import type { DemoModuleConfig } from "./demo-modules";
import { resetDemoModules, setDemoModules } from "./demo-modules";
import { applyDemoProfileData } from "./demo-profile-data";

export const DEMO_PROFILE_KEY = "operating-layer:demo-profile:v1";
const DEMO_BUSINESS_PROFILE_KEY = "operating-layer:demo-business-profile:v1";

export type DemoProfileKey = "ecommerce" | "retail" | "electrician" | "salon" | "cafe" | "dropship";

export type DemoProfile = {
  key: DemoProfileKey;
  name: string;
  businessName: string;
  description: string;
  workstream: string;
  modules: Partial<DemoModuleConfig>;
};

export const DEMO_PROFILES: readonly DemoProfile[] = [
  {
    key: "ecommerce",
    name: "Online ecommerce",
    businessName: "Northstar Commerce — Demo",
    description: "See urgent orders rise to the top, stock stay protected, warehouse work keep moving and supplier buying start before availability becomes a customer problem.",
    workstream: "Order arrives → protect stock → ship the right work → replenish before risk becomes urgent",
    modules: { crm: true, service: false, orders: true, inventory: true, purchasing: true, warehouse: true, reports: true },
  },
  {
    key: "retail",
    name: "Retail shop",
    businessName: "Foundry Home & Gifts — Demo",
    description: "See store stock stay trustworthy, replenishment start before shelves run dry and deliveries and counts happen without a spreadsheet catch-up afterwards.",
    workstream: "Sale happens → see the stock position → replenish → receive → count with confidence",
    modules: { crm: true, service: false, orders: true, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "electrician",
    name: "Electrician",
    businessName: "WiredRight Electrical — Demo",
    description: "Follow an enquiry from quote to scheduled work and payment while the customer history, visits, materials and supplier buying stay connected.",
    workstream: "Enquiry → quote → schedule the work → use materials → invoice → get paid",
    modules: { crm: true, service: true, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "salon",
    name: "Hair salon",
    businessName: "Juniper Hair Studio — Demo",
    description: "Keep the client, booked work, checkout and product stock in one operational story instead of juggling separate customer and stock admin.",
    workstream: "Client need → book the work → complete the service → invoice → payment → restock",
    modules: { crm: true, service: true, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "cafe",
    name: "Coffee shop",
    businessName: "Morrow Coffee — Demo",
    description: "See stock, supplier buying and counts in the live core, with clearly labelled prototype steps showing how recipe depletion and wastage could fit without pretending those capabilities are finished.",
    workstream: "Opening count → sales and usage → waste → replenish → receive → closing count",
    modules: { crm: false, service: false, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "dropship",
    name: "Dropship ecommerce",
    businessName: "Atlas Direct — Demo",
    description: "Explore how customer and supplier exceptions should stay visible when the supplier ships direct, without pretending the business owns warehouse stock it never handles.",
    workstream: "Customer buys → supplier takes the work → track the promise → surface exceptions → resolve the outcome",
    modules: { crm: true, service: false, orders: false, inventory: false, purchasing: false, warehouse: false, reports: false },
  },
] as const;

export function getDemoProfile(): DemoProfile {
  if (typeof window === "undefined") return DEMO_PROFILES[0];
  const key = window.localStorage.getItem(DEMO_PROFILE_KEY) as DemoProfileKey | null;
  return DEMO_PROFILES.find(profile => profile.key === key) || DEMO_PROFILES[0];
}

export function chooseDemoProfile(key: DemoProfileKey) {
  const profile = DEMO_PROFILES.find(item => item.key === key);
  if (!profile) throw new Error("Unknown demo profile");
  window.localStorage.setItem(DEMO_PROFILE_KEY, key);
  window.localStorage.removeItem(DEMO_BUSINESS_PROFILE_KEY);
  resetDemoModules();
  setDemoModules(profile.modules);
  return profile;
}

export function resetDemoProfile() {
  window.localStorage.removeItem(DEMO_PROFILE_KEY);
  window.localStorage.removeItem(DEMO_BUSINESS_PROFILE_KEY);
  resetDemoModules();
}

// Demo starts/resets reseed the canonical local store and then reload the workspace.
// Applying the selected profile at module boot keeps the proven demo engine/IDs while
// ensuring the visitor sees business-specific products, locations and contacts.
if (typeof window !== "undefined") applyDemoProfileData(getDemoProfile().key);
