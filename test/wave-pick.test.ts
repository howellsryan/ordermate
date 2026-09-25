import { describe, expect, it, vi } from "vitest";
import type { OrderDetail, OrderLine } from "../src/client/model";
import { aggregatePlanCounts, buildWaveTargets, commitWaveFulfilments, distributeWaveCounts, type WaveFulfilmentOrder } from "../src/client/wave-pick";

function line(id: string, variantId: string, quantity: number, fulfilled = 0, sku = variantId): OrderLine {
  return {
    id,
    variant_id: variantId,
    product_name_snapshot: `Product ${variantId}`,
    variant_name_snapshot: "Default",
    sku_snapshot: sku,
    quantity,
    quantity_fulfilled: fulfilled,
    quantity_returned: 0,
    unit_price_minor: 1000,
    tax_rate_bps: 2000,
    modifiers: [],
  };
}

function order(id: string, lines: OrderLine[]): OrderDetail {
  return {
    id,
    number: id,
    customer_name: "Customer",
    customer_id: null,
    location_id: "loc-1",
    location_name: "Main",
    status: "confirmed",
    fulfilment_status: "unfulfilled",
    priority: "normal",
    required_by_date: null,
    subtotal_minor: 1000,
    tax_minor: 200,
    total_minor: 1200,
    currency: "GBP",
    line_count: lines.length,
    created_at: "2026-09-25T10:00:00Z",
    lines,
  };
}

function plannedOrder(id: string): WaveFulfilmentOrder {
  return { orderId: id, orderNumber: id, lines: [{ lineId: `line-${id}`, variantId: "variant-a", quantity: 1 }] };
}

describe("wave pick planning", () => {
  it("aggregates the same variant across several orders without losing outstanding quantities", () => {
    const orders = [
      order("ORD-1", [line("line-1", "variant-a", 3, 1), line("line-2", "variant-b", 1)]),
      order("ORD-2", [line("line-3", "variant-a", 4, 0)]),
    ];
    const barcodes = new Map([["variant-a", "111"], ["variant-b", "222"]]);

    expect(buildWaveTargets(orders, barcodes)).toEqual([
      expect.objectContaining({ variantId: "variant-a", barcode: "111", remaining: 6 }),
      expect.objectContaining({ variantId: "variant-b", barcode: "222", remaining: 1 }),
    ]);
  });

  it("distributes aggregate picks back to exact lines in supplied order priority", () => {
    const orders = [
      order("urgent-first", [line("line-u", "variant-a", 2)]),
      order("normal-second", [line("line-n", "variant-a", 4)]),
    ];

    const plan = distributeWaveCounts(orders, { "variant-a": 5 });
    expect(plan.unallocated).toEqual({});
    expect(plan.orders).toEqual([
      { orderId: "urgent-first", orderNumber: "urgent-first", lines: [{ lineId: "line-u", variantId: "variant-a", quantity: 2 }] },
      { orderId: "normal-second", orderNumber: "normal-second", lines: [{ lineId: "line-n", variantId: "variant-a", quantity: 3 }] },
    ]);
    expect(aggregatePlanCounts(plan.orders)).toEqual({ "variant-a": 5 });
  });

  it("respects previous fulfilment and reports impossible excess instead of inventing an order allocation", () => {
    const orders = [order("ORD-1", [line("line-1", "variant-a", 5, 3)])];
    const plan = distributeWaveCounts(orders, { "variant-a": 4 });

    expect(plan.orders[0].lines[0].quantity).toBe(2);
    expect(plan.unallocated).toEqual({ "variant-a": 2 });
  });

  it("does not submit untouched orders or zero aggregate counts", () => {
    const orders = [
      order("ORD-1", [line("line-1", "variant-a", 2)]),
      order("ORD-2", [line("line-2", "variant-b", 2)]),
    ];
    const plan = distributeWaveCounts(orders, { "variant-a": 1, "variant-b": 0 });
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0].orderId).toBe("ORD-1");
  });

  it("commits a successful wave exactly once per order in plan order", async () => {
    const orders = [plannedOrder("ORD-1"), plannedOrder("ORD-2"), plannedOrder("ORD-3")];
    const fulfil = vi.fn(async () => undefined);

    await expect(commitWaveFulfilments(orders, fulfil)).resolves.toEqual([
      { orderId: "ORD-1", orderNumber: "ORD-1", status: "fulfilled" },
      { orderId: "ORD-2", orderNumber: "ORD-2", status: "fulfilled" },
      { orderId: "ORD-3", orderNumber: "ORD-3", status: "fulfilled" },
    ]);
    expect(fulfil.mock.calls.map(([value]) => value.orderId)).toEqual(["ORD-1", "ORD-2", "ORD-3"]);
  });

  it("keeps successful orders committed but stops after the first failure and never retries them", async () => {
    const orders = [plannedOrder("ORD-1"), plannedOrder("ORD-2"), plannedOrder("ORD-3")];
    const fulfil = vi.fn(async (value: WaveFulfilmentOrder) => {
      if (value.orderId === "ORD-2") throw new Error("reservation changed");
    });

    const results = await commitWaveFulfilments(orders, fulfil);

    expect(fulfil.mock.calls.map(([value]) => value.orderId)).toEqual(["ORD-1", "ORD-2"]);
    expect(results).toEqual([
      { orderId: "ORD-1", orderNumber: "ORD-1", status: "fulfilled" },
      { orderId: "ORD-2", orderNumber: "ORD-2", status: "failed", error: "reservation changed" },
      { orderId: "ORD-3", orderNumber: "ORD-3", status: "not_attempted", error: "Not attempted after an earlier wave fulfilment failed" },
    ]);
    expect(fulfil).toHaveBeenCalledTimes(2);
  });
});
