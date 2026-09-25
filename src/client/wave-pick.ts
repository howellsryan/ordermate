import type { OrderDetail } from "./model";

export type WavePickTarget = {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string;
  remaining: number;
};

export type WaveFulfilmentOrder = {
  orderId: string;
  orderNumber: string;
  lines: Array<{ lineId: string; variantId: string; quantity: number }>;
};

export type WaveFulfilmentPlan = {
  orders: WaveFulfilmentOrder[];
  unallocated: Record<string, number>;
};

export function buildWaveTargets(orders: OrderDetail[], barcodeByVariant: Map<string, string>): WavePickTarget[] {
  const targets = new Map<string, WavePickTarget>();
  for (const order of orders) {
    for (const line of order.lines) {
      const remaining = Math.max(0, line.quantity - line.quantity_fulfilled);
      if (!remaining) continue;
      const existing = targets.get(line.variant_id);
      if (existing) {
        existing.remaining += remaining;
        continue;
      }
      targets.set(line.variant_id, {
        variantId: line.variant_id,
        productName: line.product_name_snapshot,
        variantName: line.variant_name_snapshot,
        sku: line.sku_snapshot,
        barcode: barcodeByVariant.get(line.variant_id) || "",
        remaining,
      });
    }
  }
  return [...targets.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName));
}

/**
 * Allocate aggregate picked quantities back to exact order lines in the order
 * supplied. Callers should supply orders in the same urgency order shown to the
 * picker so the allocation remains deterministic and explainable.
 */
export function distributeWaveCounts(orders: OrderDetail[], aggregateCounts: Record<string, number>): WaveFulfilmentPlan {
  const remainingByVariant = new Map<string, number>(
    Object.entries(aggregateCounts)
      .map(([variantId, quantity]) => [variantId, Math.max(0, Math.floor(quantity))] as const)
      .filter(([, quantity]) => quantity > 0),
  );
  const result: WaveFulfilmentOrder[] = [];

  for (const order of orders) {
    const lines: WaveFulfilmentOrder["lines"] = [];
    for (const line of order.lines) {
      const aggregateRemaining = remainingByVariant.get(line.variant_id) || 0;
      if (!aggregateRemaining) continue;
      const lineRemaining = Math.max(0, line.quantity - line.quantity_fulfilled);
      const quantity = Math.min(aggregateRemaining, lineRemaining);
      if (!quantity) continue;
      lines.push({ lineId: line.id, variantId: line.variant_id, quantity });
      const next = aggregateRemaining - quantity;
      if (next > 0) remainingByVariant.set(line.variant_id, next);
      else remainingByVariant.delete(line.variant_id);
    }
    if (lines.length) result.push({ orderId: order.id, orderNumber: order.number, lines });
  }

  return { orders: result, unallocated: Object.fromEntries(remainingByVariant) };
}

export function aggregatePlanCounts(orders: WaveFulfilmentOrder[]) {
  const counts: Record<string, number> = {};
  for (const order of orders) {
    for (const line of order.lines) counts[line.variantId] = (counts[line.variantId] || 0) + line.quantity;
  }
  return counts;
}
