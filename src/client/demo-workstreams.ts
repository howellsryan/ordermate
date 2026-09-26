import type { DemoProfileKey } from "./demo-profiles";

export type DemoWorkstreamKind = "live_core" | "vertical_prototype";

export type DemoWorkstreamStep = {
  id: string;
  title: string;
  detail: string;
  kind: DemoWorkstreamKind;
  target?: "crm" | "service" | "orders" | "warehouse" | "stocktake" | "inventory" | "purchasing" | "suppliers" | "reports";
  targetLabel?: string;
};

export type DemoWorkstream = {
  profile: DemoProfileKey;
  headline: string;
  scenario: string;
  steps: readonly DemoWorkstreamStep[];
};

const WORKSTREAM_PROGRESS_KEY = "operating-layer:demo-workstream-progress:v1";

export const DEMO_WORKSTREAMS: Record<DemoProfileKey, DemoWorkstream> = {
  ecommerce: {
    profile: "ecommerce",
    headline: "From online order to replenished shelf",
    scenario: "A stock-owning ecommerce operator receives demand, reserves stock, executes warehouse fulfilment, handles returns and replenishes through suppliers.",
    steps: [
      { id: "order", title: "Customer order confirmed", detail: "Demand becomes a canonical customer order and stock is reserved before physical fulfilment.", kind: "live_core", target: "orders", targetLabel: "Open orders" },
      { id: "pick", title: "Pick and pack", detail: "Warehouse operators scan and pick confirmed demand; batches can be wave-picked where appropriate.", kind: "live_core", target: "warehouse", targetLabel: "Open warehouse" },
      { id: "fulfil", title: "Dispatch order", detail: "Fulfilment consumes the reservation and posts the physical stock movement.", kind: "live_core", target: "orders", targetLabel: "Open orders" },
      { id: "return", title: "Handle a return", detail: "Returned quantities follow the canonical reverse-logistics path and can be restocked where valid.", kind: "live_core", target: "orders", targetLabel: "Open orders" },
      { id: "replenish", title: "Review replenishment risk", detail: "Available stock, incoming supply and demand history drive buying attention without silently placing orders.", kind: "live_core", target: "inventory", targetLabel: "Open inventory" },
      { id: "buy", title: "Buy and receive", detail: "A supplier purchase order is reviewed, submitted, partially or fully received, and stock arrives through the movement ledger.", kind: "live_core", target: "purchasing", targetLabel: "Open purchase orders" },
    ],
  },
  retail: {
    profile: "retail",
    headline: "Store sale, stock risk and replenishment",
    scenario: "A small retailer balances customer demand, shop-floor and stockroom availability, supplier purchasing, receiving and physical counts without warehouse-scale execution screens.",
    steps: [
      { id: "sale", title: "Record customer demand", detail: "A sale or reserved customer order reduces what is available to promise.", kind: "live_core", target: "orders", targetLabel: "Open orders" },
      { id: "stock", title: "Spot stock risk", detail: "Low availability and incoming supply are visible by location before the buyer acts.", kind: "live_core", target: "inventory", targetLabel: "Open inventory" },
      { id: "po", title: "Prepare supplier PO", detail: "The buyer creates and submits a supplier/location purchase order with explicit quantities and costs.", kind: "live_core", target: "purchasing", targetLabel: "Open purchase orders" },
      { id: "receive", title: "Receive delivery", detail: "Partial and complete receipts add accepted stock rather than treating the commercial PO as the physical receipt itself.", kind: "live_core", target: "purchasing", targetLabel: "Receive stock" },
      { id: "count", title: "Cycle count the store", detail: "A physical count adjusts only deliberately counted positions and leaves untouched stock alone.", kind: "live_core", target: "stocktake", targetLabel: "Open cycle count" },
    ],
  },
  electrician: {
    profile: "electrician",
    headline: "Enquiry to paid electrical job",
    scenario: "A domestic electrical enquiry is qualified, quoted or sent directly to a job, scheduled across visits, completed, invoiced and paid. Materials remain a separate stock concern.",
    steps: [
      { id: "lead", title: "Capture prospect", detail: "Name, email, mobile, address, source and notes live on one CRM identity that can later become a customer without losing history.", kind: "live_core", target: "crm", targetLabel: "Open CRM" },
      { id: "request", title: "Qualify request", detail: "The service request captures the problem and site context. It can branch to a quote or directly to a job when quoting is unnecessary.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "quote", title: "Quote and approval", detail: "Commercial scope is snapshotted in a quote with its own lifecycle rather than overloading an Order status.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "visit", title: "Schedule and attend", detail: "A job can contain multiple visits, allowing return visits and assigned engineers without duplicating the job itself.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "materials", title: "Post parts used", detail: "When stock is enabled, cable, sockets and other parts are issued through the canonical inventory movement ledger.", kind: "live_core", target: "inventory", targetLabel: "Open inventory" },
      { id: "invoice", title: "Complete, invoice and collect", detail: "Completed work produces a separate invoice with durable business/customer snapshots, followed by append-only partial or full payments.", kind: "live_core", target: "service", targetLabel: "Open service" },
    ],
  },
  salon: {
    profile: "salon",
    headline: "Client enquiry to completed salon service",
    scenario: "A salon keeps a durable client record, turns an enquiry or booking into scheduled service work, checks out through an invoice/payment flow and separately manages backbar or retail stock.",
    steps: [
      { id: "client", title: "Create or recognise client", detail: "The client lives in CRM with contact details, address and notes instead of being recreated per appointment.", kind: "live_core", target: "crm", targetLabel: "Open CRM" },
      { id: "booking", title: "Book service work", detail: "The service bounded context represents the appointment/job lifecycle without pretending a haircut is a warehouse Order.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "appointment", title: "Attend and complete", detail: "Scheduled visits provide the appointment slot, assigned operator and completion history.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "checkout", title: "Invoice and payment", detail: "Service checkout is a financial document/payment flow with immutable snapshots after issue.", kind: "live_core", target: "service", targetLabel: "Open service" },
      { id: "backbar", title: "Count retail/backbar stock", detail: "Product stock is optional and independent from the appointment model; counts and adjustments use Inventory.", kind: "live_core", target: "inventory", targetLabel: "Open inventory" },
      { id: "restock", title: "Restock salon products", detail: "Low-stock retail or backbar products can be purchased and received from suppliers.", kind: "live_core", target: "purchasing", targetLabel: "Open purchase orders" },
    ],
  },
  cafe: {
    profile: "cafe",
    headline: "Daily café stock, recipes and waste",
    scenario: "A café buys ingredients and counts stock through the reusable core, while menu-item recipes and wastage remain explicit food-service prototypes until those primitives deserve a production module.",
    steps: [
      { id: "opening-count", title: "Opening ingredient count", detail: "Beans, milk, syrups, cups and retail stock are physically counted through the normal inventory process.", kind: "live_core", target: "stocktake", targetLabel: "Open cycle count" },
      { id: "recipe-sale", title: "Sell menu item and deplete recipe", detail: "A flat white should consume multiple measured ingredients from its recipe. This is deliberately not faked as one ordinary SKU fulfilment.", kind: "vertical_prototype" },
      { id: "waste", title: "Record waste or spoilage", detail: "Spilt milk, dial-in coffee and expired food should record quantity, reason and value as a dedicated wastage event.", kind: "vertical_prototype" },
      { id: "reorder", title: "Review ingredient stock risk", detail: "Ingredient availability and reorder policy can use the reusable inventory/replenishment core.", kind: "live_core", target: "inventory", targetLabel: "Open inventory" },
      { id: "buy", title: "Order from supplier", detail: "The café buyer raises a supplier PO for ingredients and consumables.", kind: "live_core", target: "purchasing", targetLabel: "Open purchase orders" },
      { id: "receive", title: "Receive delivery", detail: "Accepted quantities are received into stock and discrepancies remain explicit.", kind: "live_core", target: "purchasing", targetLabel: "Receive stock" },
    ],
  },
  dropship: {
    profile: "dropship",
    headline: "Supplier-direct ecommerce fulfilment",
    scenario: "A pure dropship merchant never owns or picks the stock. The supplier accepts the routed demand and ships directly to the customer, so warehouse reservation and fulfilment are intentionally absent.",
    steps: [
      { id: "customer", title: "Know the customer", detail: "Customer identity and contact history are reusable CRM concerns even when physical stock is supplier-owned.", kind: "live_core", target: "crm", targetLabel: "Open CRM" },
      { id: "checkout", title: "Capture customer checkout", detail: "The storefront creates supplier-direct demand without reserving merchant warehouse inventory.", kind: "vertical_prototype" },
      { id: "route", title: "Route demand to supplier", detail: "The merchant selects the supplier/offer and sends the fulfilment assignment with the customer delivery details.", kind: "vertical_prototype" },
      { id: "ack", title: "Supplier acknowledgement", detail: "Supplier acceptance, rejection or substitution is tracked before the merchant promises fulfilment progress.", kind: "vertical_prototype" },
      { id: "dispatch", title: "Direct dispatch and tracking", detail: "The supplier picks, packs and ships straight to the customer. Tracking belongs to that supplier fulfilment assignment, not a merchant warehouse pick.", kind: "vertical_prototype" },
      { id: "exception", title: "Delivery exception or return", detail: "Late supply, unavailable items, returns and refunds remain visible merchant responsibilities even though the merchant never held the stock.", kind: "vertical_prototype" },
    ],
  },
};

function progressKey(profile: DemoProfileKey) {
  return `${WORKSTREAM_PROGRESS_KEY}:${profile}`;
}

export function demoWorkstream(profile: DemoProfileKey) {
  return DEMO_WORKSTREAMS[profile];
}

export function completedDemoWorkstreamSteps(profile: DemoProfileKey): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(progressKey(profile));
  if (!raw) return new Set();
  try {
    const value = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(value) ? value.filter(item => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function setDemoWorkstreamStep(profile: DemoProfileKey, stepId: string, complete: boolean) {
  const workstream = demoWorkstream(profile);
  const step = workstream.steps.find(item => item.id === stepId);
  if (!step || step.kind !== "vertical_prototype") throw new Error("Only vertical prototype steps are simulated locally");
  const completed = completedDemoWorkstreamSteps(profile);
  if (complete) completed.add(stepId); else completed.delete(stepId);
  window.localStorage.setItem(progressKey(profile), JSON.stringify([...completed]));
  return completed;
}

export function resetDemoWorkstream(profile?: DemoProfileKey) {
  if (typeof window === "undefined") return;
  if (profile) {
    window.localStorage.removeItem(progressKey(profile));
    return;
  }
  for (const key of Object.keys(DEMO_WORKSTREAMS) as DemoProfileKey[]) window.localStorage.removeItem(progressKey(key));
}
