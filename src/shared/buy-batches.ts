import type { OperatingIntelligenceRow } from "./operating-intelligence";

export type BuyBatchLine = {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  costMinor: number | null;
  risk: OperatingIntelligenceRow["risk"];
  orderByDate: string | null;
};

export type BuyBatch = {
  id: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  lines: BuyBatchLine[];
  totalUnits: number;
  estimatedCostMinor: number | null;
  criticalLines: number;
};

export function deterministicPlanningSupplier(row: OperatingIntelligenceRow) {
  return row.suppliers.find(supplier => supplier.preferred)
    || (row.suppliers.length === 1 ? row.suppliers[0] : undefined);
}

/**
 * Groups recommendations that are due now into reviewable supplier/location POs.
 * Ambiguous multi-supplier positions are deliberately excluded until a preferred
 * supplier is chosen; the system never invents that commercial decision.
 */
export function buildBuyBatches(rows: OperatingIntelligenceRow[], planDate: string): BuyBatch[] {
  const groups = new Map<string, BuyBatch>();

  for (const row of rows) {
    const quantity = row.scenarios.recommended;
    const dueNow = row.risk === "critical" || (row.order_by_date !== null && row.order_by_date <= planDate);
    if (!dueNow || quantity <= 0) continue;

    const supplier = deterministicPlanningSupplier(row);
    if (!supplier) continue;

    const key = `${supplier.supplierId}:${row.location_id}`;
    const batch = groups.get(key) || {
      id: key,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
      locationId: row.location_id,
      locationName: row.location_name,
      lines: [],
      totalUnits: 0,
      estimatedCostMinor: 0,
      criticalLines: 0,
    };

    batch.lines.push({
      variantId: row.variant_id,
      productName: row.product_name,
      variantName: row.variant_name,
      sku: row.sku,
      quantity,
      costMinor: supplier.lastCostMinor ?? null,
      risk: row.risk,
      orderByDate: row.order_by_date,
    });
    batch.totalUnits += quantity;
    if (row.risk === "critical") batch.criticalLines += 1;
    if (supplier.lastCostMinor == null || batch.estimatedCostMinor == null) batch.estimatedCostMinor = null;
    else batch.estimatedCostMinor += supplier.lastCostMinor * quantity;
    groups.set(key, batch);
  }

  return [...groups.values()]
    .map(batch => ({
      ...batch,
      lines: [...batch.lines].sort((a, b) => {
        const risk = Number(b.risk === "critical") - Number(a.risk === "critical");
        if (risk) return risk;
        return a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName);
      }),
    }))
    .sort((a, b) => b.criticalLines - a.criticalLines || b.lines.length - a.lines.length || a.supplierName.localeCompare(b.supplierName));
}
