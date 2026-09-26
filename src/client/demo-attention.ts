import type { DeliveryDiscrepancyRecord } from "../shared/delivery-discrepancy";
import type { AttentionResponse } from "./model";
import { demoOpsApi as acceptanceOpsApi, demoTenantApi } from "./demo-acceptance";

export async function demoOpsApi<T>(path: string): Promise<T> {
  const result = await acceptanceOpsApi<unknown>(path);
  const url = new URL(path, "https://demo.local");
  if (url.pathname !== "/attention") return result as T;

  const data = result as AttentionResponse;
  const discrepancies = await demoTenantApi<DeliveryDiscrepancyRecord[]>("/delivery-discrepancies?status=open");
  const existing = new Set(data.items.map(item => item.id));
  const items = [...data.items];
  for (const discrepancy of discrepancies) {
    const id = `delivery-discrepancy:${discrepancy.id}`;
    if (existing.has(id)) continue;
    items.push({
      id,
      severity: "warning",
      type: "Open delivery discrepancy",
      title: discrepancy.purchase_order_number,
      detail: `${discrepancy.supplier_name} · ${discrepancy.issue_count} issue${discrepancy.issue_count === 1 ? "" : "s"} · ${discrepancy.location_name}`,
      page: "purchasing",
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
  return { total: items.length, items: items.slice(0, 20) } as T;
}
