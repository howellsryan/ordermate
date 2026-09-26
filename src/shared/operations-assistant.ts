import type { OperatingIntelligenceResponse } from "./operating-intelligence";

export type AssistantPage = "overview" | "orders" | "warehouse" | "inventory" | "purchasing" | "reports";

export type AssistantOrder = {
  number: string;
  customer: string;
  location: string;
  priority: string;
  requiredBy?: string | null;
};

export type AssistantPurchaseOrder = {
  number: string;
  supplier: string;
  location: string;
  status: string;
  expected?: string | null;
};

export type OperationsAssistantContext = {
  generatedAt: string;
  dashboard: {
    ordersOpen: number;
    ordersAwaitingFulfilment: number;
    purchaseOrdersOpen: number;
    lowStockVariants: number;
    inventoryValueMinor: number;
    currency: string;
  } | null;
  intelligence: Pick<OperatingIntelligenceResponse, "summary" | "suggestions"> | null;
  confirmedOrders: AssistantOrder[];
  openPurchaseOrders: AssistantPurchaseOrder[];
};

export type OperationsAssistantResponse = {
  mode: "deterministic" | "ai" | "demo";
  answer: string;
  facts: string[];
  recommendedPages: Array<{ page: AssistantPage; label: string }>;
};

function hasAny(question: string, terms: string[]) {
  return terms.some(term => question.includes(term));
}

function page(page: AssistantPage, label: string) {
  return { page, label };
}

function topRiskFacts(context: OperationsAssistantContext) {
  const risks = context.intelligence?.suggestions.slice(0, 3) || [];
  return risks.map(item => {
    const timing = item.stockout_date ? `stockout ${item.stockout_date}` : `${item.days_of_cover ?? "unknown"} days cover`;
    return `${item.product_name} · ${item.variant_name} at ${item.location_name}: ${timing}; recommended +${item.scenarios.recommended}.`;
  });
}

export function deterministicOperationsAnswer(question: string, context: OperationsAssistantContext, mode: OperationsAssistantResponse["mode"] = "deterministic"): OperationsAssistantResponse {
  const q = question.trim().toLocaleLowerCase();
  const stockQuestion = hasAny(q, ["stock", "inventory", "reorder", "short", "run out", "stockout", "buy", "replen"]);
  const orderQuestion = hasAny(q, ["order", "customer", "fulfil", "fulfill", "pick", "urgent", "late"]);
  const purchasingQuestion = hasAny(q, ["purchase", "supplier", "po", "delivery", "incoming", "overdue"]);

  if (stockQuestion && context.intelligence) {
    const summary = context.intelligence.summary;
    const facts = topRiskFacts(context);
    return {
      mode,
      answer: summary.at_risk
        ? `${summary.at_risk} tracked stock position${summary.at_risk === 1 ? " is" : "s are"} currently forecast to need intervention, including ${summary.critical} critical position${summary.critical === 1 ? "" : "s"}. ${summary.projected_stockouts_30d} position${summary.projected_stockouts_30d === 1 ? " is" : "s are"} projected to stock out within 30 days.`
        : "The current forecast does not show any tracked stock positions needing replenishment intervention.",
      facts: facts.length ? facts : ["No current replenishment suggestions are open."],
      recommendedPages: [page("purchasing", "Review operating intelligence"), page("inventory", "Open inventory")],
    };
  }

  if (orderQuestion) {
    const orders = context.confirmedOrders.slice(0, 4);
    return {
      mode,
      answer: orders.length
        ? `${orders.length} of the highest-priority confirmed orders are shown below. There are ${context.dashboard?.ordersAwaitingFulfilment ?? orders.length} orders awaiting fulfilment overall.`
        : "There are no confirmed orders currently waiting in the prioritised assistant view.",
      facts: orders.map(order => `${order.number}: ${order.customer} · ${order.location} · ${order.priority} priority${order.requiredBy ? ` · required ${order.requiredBy}` : ""}.`),
      recommendedPages: [page("warehouse", "Open warehouse queue"), page("orders", "Review orders")],
    };
  }

  if (purchasingQuestion) {
    const purchaseOrders = context.openPurchaseOrders.slice(0, 4);
    return {
      mode,
      answer: purchaseOrders.length
        ? `${context.dashboard?.purchaseOrdersOpen ?? purchaseOrders.length} purchase orders are open. The items below are the first open or partially received purchase orders in the current operational context.`
        : "There are no open purchase orders in the current assistant context.",
      facts: purchaseOrders.map(po => `${po.number}: ${po.supplier} · ${po.location} · ${po.status}${po.expected ? ` · expected ${po.expected}` : " · no expected date"}.`),
      recommendedPages: [page("purchasing", "Open purchasing")],
    };
  }

  const dashboard = context.dashboard;
  const intelligence = context.intelligence?.summary;
  const facts = [
    dashboard ? `${dashboard.ordersAwaitingFulfilment} orders awaiting fulfilment.` : null,
    intelligence ? `${intelligence.at_risk} forecast stock risks, ${intelligence.critical} critical.` : null,
    dashboard ? `${dashboard.purchaseOrdersOpen} open purchase orders.` : null,
  ].filter((value): value is string => !!value);
  return {
    mode,
    answer: "The highest-value next step is to work the exceptions: urgent fulfilment first, then forecast stock risk, then incoming supply that may miss demand. Ask about stock, orders or suppliers for a more focused answer.",
    facts,
    recommendedPages: [page("overview", "Stay on overview"), page("warehouse", "Open warehouse"), page("purchasing", "Open purchasing")],
  };
}
