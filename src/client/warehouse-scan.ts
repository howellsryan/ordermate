export type WarehouseScanTarget = {
  lineId: string;
  variantId: string;
  barcode?: string | null;
  remaining: number;
};

export type WarehouseScanCounts = Record<string, number>;

export type WarehouseScanResult = {
  counts: WarehouseScanCounts;
  outcome: "matched" | "not_found" | "ambiguous" | "complete";
  lineId?: string;
};

export function applyWarehouseBarcodeScan(
  targets: WarehouseScanTarget[],
  counts: WarehouseScanCounts,
  rawBarcode: string,
): WarehouseScanResult {
  const barcode = rawBarcode.trim();
  if (!barcode) return { counts, outcome: "not_found" };

  const matchingTargets = targets.filter(target => (target.barcode || "").trim() === barcode);
  if (!matchingTargets.length) return { counts, outcome: "not_found" };

  const variants = new Set(matchingTargets.map(target => target.variantId));
  if (variants.size > 1) return { counts, outcome: "ambiguous" };

  const target = matchingTargets.find(candidate => (counts[candidate.lineId] || 0) < candidate.remaining);
  if (!target) return { counts, outcome: "complete" };

  return {
    counts: { ...counts, [target.lineId]: (counts[target.lineId] || 0) + 1 },
    outcome: "matched",
    lineId: target.lineId,
  };
}

export function setWarehouseLineCount(
  counts: WarehouseScanCounts,
  target: WarehouseScanTarget,
  nextValue: number,
): WarehouseScanCounts {
  const next = Math.max(0, Math.min(target.remaining, Math.trunc(nextValue)));
  if (next === 0) {
    const copy = { ...counts };
    delete copy[target.lineId];
    return copy;
  }
  return { ...counts, [target.lineId]: next };
}
