import { describe, expect, it } from "vitest";
import { applyWarehouseBarcodeScan, setWarehouseLineCount, type WarehouseScanTarget } from "../src/client/warehouse-scan";

const targets: WarehouseScanTarget[] = [
  { lineId: "line-a", variantId: "variant-a", barcode: "5011111111111", remaining: 2 },
  { lineId: "line-b", variantId: "variant-b", barcode: "5022222222222", remaining: 1 },
];

describe("warehouse barcode counting", () => {
  it("increments exactly one outstanding unit for an expected barcode", () => {
    const result = applyWarehouseBarcodeScan(targets, {}, "5011111111111");
    expect(result).toEqual({ counts: { "line-a": 1 }, outcome: "matched", lineId: "line-a" });
  });

  it("rejects a barcode that is not on the selected order or PO", () => {
    const result = applyWarehouseBarcodeScan(targets, { "line-a": 1 }, "5099999999999");
    expect(result.outcome).toBe("not_found");
    expect(result.counts).toEqual({ "line-a": 1 });
  });

  it("does not scan past the outstanding quantity", () => {
    const result = applyWarehouseBarcodeScan(targets, { "line-a": 2 }, "5011111111111");
    expect(result.outcome).toBe("complete");
    expect(result.counts).toEqual({ "line-a": 2 });
  });

  it("refuses an ambiguous barcode shared by different variants", () => {
    const ambiguous = [
      { lineId: "line-a", variantId: "variant-a", barcode: "501", remaining: 1 },
      { lineId: "line-b", variantId: "variant-b", barcode: "501", remaining: 1 },
    ];
    const result = applyWarehouseBarcodeScan(ambiguous, {}, "501");
    expect(result.outcome).toBe("ambiguous");
    expect(result.counts).toEqual({});
  });

  it("allocates repeated scans across multiple lines of the same variant", () => {
    const duplicateLines = [
      { lineId: "line-a", variantId: "variant-a", barcode: "501", remaining: 1 },
      { lineId: "line-b", variantId: "variant-a", barcode: "501", remaining: 2 },
    ];
    const first = applyWarehouseBarcodeScan(duplicateLines, {}, "501");
    const second = applyWarehouseBarcodeScan(duplicateLines, first.counts, "501");
    expect(second.outcome).toBe("matched");
    expect(second.lineId).toBe("line-b");
    expect(second.counts).toEqual({ "line-a": 1, "line-b": 1 });
  });

  it("clamps manual correction between zero and outstanding quantity", () => {
    expect(setWarehouseLineCount({}, targets[0], 99)).toEqual({ "line-a": 2 });
    expect(setWarehouseLineCount({ "line-a": 2 }, targets[0], -1)).toEqual({});
  });
});
