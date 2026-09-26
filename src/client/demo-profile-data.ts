import type { DemoProfileKey } from "./demo-profiles";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";

type Row = Record<string, any>;
type DemoRawState = {
  products: Row[];
  locations: Row[];
  inventory: Row[];
  suppliers: Row[];
  customers: Row[];
  supplierVariants: Row[];
  inventoryPolicies: Row[];
  purchaseOrders: Row[];
  orders: Row[];
  movements: Row[];
  [key: string]: unknown;
};

type ProductIdentity = {
  productName: string;
  description: string;
  category: string;
  variants: Record<string, { name: string; sku: string }>;
};

type ProfileData = {
  products: Record<string, ProductIdentity>;
  locations: Record<string, string>;
  suppliers: Record<string, { name: string; email: string; phone: string; notes: string }>;
  customers: Record<string, { name: string; email: string; phone: string; notes: string }>;
  disableCommerceOrders?: boolean;
  disablePurchasing?: boolean;
  disableInventory?: boolean;
};

const RETAIL: ProfileData = {
  products: {
    "prod-mailer": { productName: "Stoneware Mug", description: "Hand-finished glazed mug for the homeware range.", category: "Homeware", variants: { "var-mailer-s": { name: "Sage", sku: "MUG-STONE-SAGE" }, "var-mailer-m": { name: "Oat", sku: "MUG-STONE-OAT" } } },
    "prod-tape": { productName: "Amber Glass Candle", description: "Soy wax candle in an amber glass jar.", category: "Fragrance", variants: { "var-tape": { name: "Cedar & Fig", sku: "CANDLE-CEDAR-FIG" } } },
    "prod-gloves": { productName: "Linen Cushion Cover", description: "Washed linen cushion cover.", category: "Textiles", variants: { "var-gloves-m": { name: "45 cm · Clay", sku: "CUSH-LINEN-45-CLAY" }, "var-gloves-l": { name: "50 cm · Moss", sku: "CUSH-LINEN-50-MOSS" } } },
    "prod-labels": { productName: "Recycled Gift Wrap", description: "Premium recycled wrapping paper pack.", category: "Gifting", variants: { "var-labels": { name: "3-sheet pack", sku: "WRAP-RECYCLED-3" } } },
  },
  locations: { "loc-nottingham": "Foundry Home & Gifts · Shop", "loc-birmingham": "Foundry Home & Gifts · Stockroom" },
  suppliers: {
    "sup-pack": { name: "Nottingham Homewares Co.", email: "trade@nottinghamhomewares.example", phone: "0115 555 0214", notes: "Primary ceramics, gifting and homeware supplier." },
    "sup-work": { name: "Midlands Textiles", email: "orders@midlandstextiles.example", phone: "0121 555 0260", notes: "Cushions and seasonal textiles." },
  },
  customers: {
    "cus-field": { name: "Olivia Harris", email: "olivia.harris@example.test", phone: "07700 900121", notes: "Local customer · click and collect." },
    "cus-trent": { name: "Maya Patel", email: "maya.patel@example.test", phone: "07700 900192", notes: "Priority gift order." },
    "cus-wren": { name: "The Willow House", email: "buying@willowhouse.example", phone: "0161 555 0140", notes: "Small trade customer." },
  },
};

const ELECTRICIAN: ProfileData = {
  products: {
    "prod-mailer": { productName: "Twin & Earth Cable", description: "6242Y PVC twin and earth cable for domestic installation work.", category: "Cable", variants: { "var-mailer-s": { name: "1.5 mm² · 10 m", sku: "CABLE-T&E-1.5-10" }, "var-mailer-m": { name: "2.5 mm² · 10 m", sku: "CABLE-T&E-2.5-10" } } },
    "prod-tape": { productName: "13A Double Socket", description: "White switched double socket for domestic jobs.", category: "Accessories", variants: { "var-tape": { name: "2 gang", sku: "SOCKET-13A-2G" } } },
    "prod-gloves": { productName: "RCBO", description: "Type A compact RCBO for consumer-unit work.", category: "Protection", variants: { "var-gloves-m": { name: "20A Type B", sku: "RCBO-20A-B" }, "var-gloves-l": { name: "32A Type B", sku: "RCBO-32A-B" } } },
    "prod-labels": { productName: "Lever Connectors", description: "Reusable lever wire connectors for maintenance and installation.", category: "Consumables", variants: { "var-labels": { name: "Box of 50", sku: "CONN-LEVER-50" } } },
  },
  locations: { "loc-nottingham": "WiredRight Workshop", "loc-birmingham": "Van 01 · Alex" },
  suppliers: {
    "sup-pack": { name: "Nottingham Electrical Trade", email: "trade@netelectrical.example", phone: "0115 555 0134", notes: "Cable and accessories · next-day trade delivery." },
    "sup-work": { name: "Midlands Circuit Supplies", email: "orders@midlandscircuit.example", phone: "0121 555 0188", notes: "Protective devices and consumer-unit components." },
  },
  customers: {
    "cus-field": { name: "Jamie Taylor", email: "jamie.taylor@example.test", phone: "07123 456789", notes: "Domestic customer." },
    "cus-trent": { name: "Ruth Williams", email: "ruth.williams@example.test", phone: "07700 900192", notes: "Domestic customer · kitchen fault." },
    "cus-wren": { name: "Trent Lettings", email: "maintenance@trentlettings.example", phone: "0115 555 0140", notes: "Property-maintenance account." },
  },
  disableCommerceOrders: true,
};

const SALON: ProfileData = {
  products: {
    "prod-mailer": { productName: "Professional Shampoo", description: "Backbar and retail colour-care shampoo.", category: "Hair care", variants: { "var-mailer-s": { name: "300 ml retail", sku: "HAIR-SHAMP-300" }, "var-mailer-m": { name: "1 L backbar", sku: "HAIR-SHAMP-1000" } } },
    "prod-tape": { productName: "Developer Cream", description: "Professional peroxide developer for colour services.", category: "Colour", variants: { "var-tape": { name: "6% · 1 L", sku: "COLOUR-DEV-6-1L" } } },
    "prod-gloves": { productName: "Permanent Colour", description: "Professional salon colour tube.", category: "Colour", variants: { "var-gloves-m": { name: "6.0 Natural", sku: "COLOUR-6-0" }, "var-gloves-l": { name: "7.1 Ash", sku: "COLOUR-7-1" } } },
    "prod-labels": { productName: "Heat Protection Spray", description: "Retail styling and heat-protection spray.", category: "Retail", variants: { "var-labels": { name: "200 ml", sku: "STYLE-HEAT-200" } } },
  },
  locations: { "loc-nottingham": "Juniper Hair Studio · Backbar", "loc-birmingham": "Juniper Hair Studio · Retail shelf" },
  suppliers: {
    "sup-pack": { name: "Salon Professional UK", email: "orders@salonprofessional.example", phone: "0115 555 0134", notes: "Colour and backbar products." },
    "sup-work": { name: "Pro Hair Wholesale", email: "trade@prohairwholesale.example", phone: "0121 555 0188", notes: "Retail haircare and styling products." },
  },
  customers: {
    "cus-field": { name: "Ava Robinson", email: "ava.robinson@example.test", phone: "07700 900121", notes: "Regular cut and finish client." },
    "cus-trent": { name: "Sophie Walker", email: "sophie.walker@example.test", phone: "07700 900192", notes: "Colour client · patch test recorded in CRM notes." },
    "cus-wren": { name: "Emily Clarke", email: "emily.clarke@example.test", phone: "07700 900140", notes: "New client." },
  },
  disableCommerceOrders: true,
};

const CAFE: ProfileData = {
  products: {
    "prod-mailer": { productName: "House Espresso Beans", description: "Freshly roasted house espresso blend.", category: "Coffee", variants: { "var-mailer-s": { name: "1 kg bag", sku: "BEANS-HOUSE-1KG" }, "var-mailer-m": { name: "6 × 1 kg case", sku: "BEANS-HOUSE-6KG" } } },
    "prod-tape": { productName: "Oat Milk", description: "Barista oat drink for espresso beverages.", category: "Dairy alternatives", variants: { "var-tape": { name: "1 L carton", sku: "MILK-OAT-1L" } } },
    "prod-gloves": { productName: "Takeaway Cups", description: "Compostable double-wall hot cups.", category: "Consumables", variants: { "var-gloves-m": { name: "8 oz · sleeve", sku: "CUP-8OZ-SLEEVE" }, "var-gloves-l": { name: "12 oz · sleeve", sku: "CUP-12OZ-SLEEVE" } } },
    "prod-labels": { productName: "Vanilla Syrup", description: "Coffee-shop vanilla syrup for menu drinks.", category: "Ingredients", variants: { "var-labels": { name: "1 L bottle", sku: "SYRUP-VANILLA-1L" } } },
  },
  locations: { "loc-nottingham": "Morrow Coffee · Bar & stockroom", "loc-birmingham": "Morrow Coffee · Dry store" },
  suppliers: {
    "sup-pack": { name: "Trent Coffee Roasters", email: "trade@trentcoffee.example", phone: "0115 555 0134", notes: "House coffee and weekly roast delivery." },
    "sup-work": { name: "Midlands Foodservice", email: "orders@midlandsfoodservice.example", phone: "0121 555 0188", notes: "Milk, syrups and disposables." },
  },
  customers: {
    "cus-field": { name: "Walk-in sales", email: "hello@morrowcoffee.example", phone: "0115 555 0200", notes: "Aggregate demo contact only; POS is not modelled as Orders." },
    "cus-trent": { name: "Trent Design Studio", email: "office@trentdesign.example", phone: "0115 555 0192", notes: "Office coffee catering account." },
    "cus-wren": { name: "Morrow Events", email: "events@morrowcoffee.example", phone: "0115 555 0140", notes: "Event catering placeholder." },
  },
  disableCommerceOrders: true,
};

const DROP_SHIP: ProfileData = {
  products: {}, locations: {}, suppliers: {}, customers: {},
  disableCommerceOrders: true,
  disablePurchasing: true,
  disableInventory: true,
};

const PROFILES: Partial<Record<DemoProfileKey, ProfileData>> = {
  retail: RETAIL,
  electrician: ELECTRICIAN,
  salon: SALON,
  cafe: CAFE,
  dropship: DROP_SHIP,
};

function productIdentity(data: ProfileData, variantId: string) {
  for (const [productId, product] of Object.entries(data.products)) {
    const variant = product.variants[variantId];
    if (variant) return { productId, product, variant };
  }
  return null;
}

function mapVariantSnapshots(state: DemoRawState, data: ProfileData) {
  for (const product of state.products) {
    const identity = data.products[String(product.id)];
    if (!identity) continue;
    product.name = identity.productName;
    product.description = identity.description;
    product.category_name = identity.category;
    for (const variant of (product.variants || []) as Row[]) {
      const mapped = identity.variants[String(variant.id)];
      if (!mapped) continue;
      variant.name = mapped.name;
      variant.sku = mapped.sku;
    }
  }

  const patchRow = (row: Row, variantId: string) => {
    const identity = productIdentity(data, variantId);
    if (!identity) return;
    row.product_name = identity.product.productName;
    row.variant_name = identity.variant.name;
    row.sku = identity.variant.sku;
  };
  for (const row of state.inventory) patchRow(row, String(row.variant_id));
  for (const row of state.supplierVariants) patchRow(row, String(row.variant_id));
  for (const row of state.inventoryPolicies) patchRow(row, String(row.variant_id));
  for (const row of state.movements) patchRow(row, String(row.variant_id));

  for (const po of state.purchaseOrders) {
    for (const line of (po.lines || []) as Row[]) {
      const identity = productIdentity(data, String(line.variant_id));
      if (!identity) continue;
      line.sku_snapshot = identity.variant.sku;
      line.description_snapshot = `${identity.product.productName} · ${identity.variant.name}`;
    }
  }
  for (const order of state.orders) {
    for (const line of (order.lines || []) as Row[]) {
      const identity = productIdentity(data, String(line.variant_id));
      if (!identity) continue;
      line.product_name_snapshot = identity.product.productName;
      line.variant_name_snapshot = identity.variant.name;
      line.sku_snapshot = identity.variant.sku;
    }
  }
}

function mapLocations(state: DemoRawState, data: ProfileData) {
  for (const location of state.locations) if (data.locations[String(location.id)]) location.name = data.locations[String(location.id)];
  for (const row of [...state.inventory, ...state.inventoryPolicies, ...state.movements, ...state.purchaseOrders, ...state.orders]) {
    const id = String(row.location_id || "");
    if (data.locations[id]) row.location_name = data.locations[id];
  }
}

function mapSuppliers(state: DemoRawState, data: ProfileData) {
  for (const supplier of state.suppliers) {
    const mapped = data.suppliers[String(supplier.id)];
    if (!mapped) continue;
    Object.assign(supplier, mapped);
  }
  for (const row of state.supplierVariants) {
    const mapped = data.suppliers[String(row.supplier_id)];
    if (mapped) row.supplier_name = mapped.name;
  }
  for (const po of state.purchaseOrders) {
    const mapped = data.suppliers[String(po.supplier_id)];
    if (mapped) po.supplier_name = mapped.name;
  }
  for (const policy of state.inventoryPolicies) {
    const mapped = data.suppliers[String(policy.preferred_supplier_id || "")];
    if (mapped) policy.preferred_supplier_name = mapped.name;
  }
}

function mapCustomers(state: DemoRawState, data: ProfileData) {
  for (const customer of state.customers) {
    const mapped = data.customers[String(customer.id)];
    if (!mapped) continue;
    Object.assign(customer, mapped);
  }
  for (const order of state.orders) {
    const mapped = data.customers[String(order.customer_id || "")];
    if (mapped) order.customer_name = mapped.name;
  }
}

export function applyDemoProfileData(profile: DemoProfileKey) {
  if (typeof window === "undefined" || profile === "ecommerce") return;
  const data = PROFILES[profile];
  if (!data) return;
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!raw) return;

  let state: DemoRawState;
  try { state = JSON.parse(raw) as DemoRawState; } catch { return; }

  mapVariantSnapshots(state, data);
  mapLocations(state, data);
  mapSuppliers(state, data);
  mapCustomers(state, data);

  if (data.disableCommerceOrders) {
    state.orders = [];
    for (const row of state.inventory) {
      row.reserved = 0;
      row.available = Number(row.on_hand || 0);
    }
  }
  if (data.disablePurchasing) {
    state.purchaseOrders = [];
    state.supplierVariants = [];
    state.inventoryPolicies = [];
  }
  if (data.disableInventory) {
    state.inventory = [];
    state.movements = [];
  }

  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}
