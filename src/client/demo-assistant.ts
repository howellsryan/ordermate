import { deterministicOperationsAnswer, type OperationsAssistantContext, type OperationsAssistantResponse } from "../shared/operations-assistant";
import type { DashboardSummary } from "../shared/types";
import { demoOperatingIntelligence } from "./demo-operating-intelligence";
import type { OrderDetail, PurchaseOrderDetail } from "./model";
import { demoTenantApi } from "./demo-stocktake";

export async function demoAssistant(question: string): Promise<OperationsAssistantResponse> {
  const [dashboard, intelligence, orders, purchaseOrders] = await Promise.all([
    demoTenantApi<DashboardSummary>("/dashboard"),
    demoOperatingIntelligence(),
    demoTenantApi<OrderDetail[]>("/orders"),
    demoTenantApi<PurchaseOrderDetail[]>("/purchase-orders"),
  ]);

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  const confirmedOrders = orders
    .filter(order => order.status === "confirmed")
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]
      || (a.required_by_date || "9999-12-31").localeCompare(b.required_by_date || "9999-12-31")
      || a.created_at.localeCompare(b.created_at))
    .slice(0, 12)
    .map(order => ({
      number: order.number,
      customer: order.customer_name || "Guest",
      location: order.location_name,
      priority: order.priority,
      requiredBy: order.required_by_date,
    }));

  const openPurchaseOrders = purchaseOrders
    .filter(po => ["ordered", "partially_received"].includes(po.status))
    .sort((a, b) => (a.expected_delivery_date || "9999-12-31").localeCompare(b.expected_delivery_date || "9999-12-31") || a.created_at.localeCompare(b.created_at))
    .slice(0, 12)
    .map(po => ({
      number: po.number,
      supplier: po.supplier_name,
      location: po.location_name,
      status: po.status,
      expected: po.expected_delivery_date,
    }));

  const context: OperationsAssistantContext = {
    generatedAt: new Date().toISOString(),
    dashboard,
    intelligence: { summary: intelligence.summary, suggestions: intelligence.suggestions.slice(0, 12) },
    confirmedOrders,
    openPurchaseOrders,
  };
  return deterministicOperationsAnswer(question, context, "demo");
}
