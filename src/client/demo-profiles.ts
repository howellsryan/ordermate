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
    description: "Own stock, online customer orders, warehouse fulfilment, returns, replenishment and supplier purchasing.",
    workstream: "Order → reserve → pick/pack → fulfil → return · forecast → buy → receive",
    modules: { crm: true, service: false, orders: true, inventory: true, purchasing: true, warehouse: true, reports: true },
  },
  {
    key: "retail",
    name: "Retail shop",
    businessName: "Foundry Home & Gifts — Demo",
    description: "Store stock, replenishment, transfers, customer orders, purchase orders, receiving and cycle counts.",
    workstream: "Sell/reserve → replenish → PO → receive → count/adjust",
    modules: { crm: true, service: false, orders: true, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "electrician",
    name: "Electrician",
    businessName: "WiredRight Electrical — Demo",
    description: "Enquiries, prospects, quotes, scheduled site work, van/depot materials, invoice and payment.",
    workstream: "Request → qualify → quote → job/visit → complete → invoice → payment",
    modules: { crm: true, service: true, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "salon",
    name: "Hair salon",
    businessName: "Juniper Hair Studio — Demo",
    description: "Client CRM and booked service work, with optional retail product stock and purchasing.",
    workstream: "Client enquiry → service quote/booking → appointment job → checkout/invoice → payment",
    modules: { crm: true, service: true, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "cafe",
    name: "Coffee shop",
    businessName: "Morrow Coffee — Demo",
    description: "Ingredient stock, supplier buying and counts use the live core; recipe depletion and wastage are playable food-service prototypes kept separate from ordinary SKU orders.",
    workstream: "Opening count → menu sale/recipe depletion → waste → replenish → PO → receive → closing count",
    modules: { crm: false, service: false, orders: false, inventory: true, purchasing: true, warehouse: false, reports: true },
  },
  {
    key: "dropship",
    name: "Dropship ecommerce",
    businessName: "Atlas Direct — Demo",
    description: "Customer and supplier-direct fulfilment without owned stock. The demo does not misuse warehouse Orders or Inventory to represent a supplier shipping straight to the customer.",
    workstream: "Checkout → supplier route → acknowledgement → direct dispatch/tracking → delivered → exception/return",
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
