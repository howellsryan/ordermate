import { describe, expect, it } from "vitest";
import type { Order } from "../src/client/model";
import { compareOrderUrgency, isRequiredByOverdue } from "../src/client/order-priority";

function order(id: string, priority: Order["priority"], requiredByDate: string | null, createdAt: string): Order {
  return {
    id,
    number: id,
    customer_name: null,
    location_name: "Main",
    status: "confirmed",
    fulfilment_status: "unfulfilled",
    priority,
    required_by_date: requiredByDate,
    subtotal_minor: 0,
    tax_minor: 0,
    total_minor: 0,
    currency: "GBP",
    line_count: 1,
    created_at: createdAt,
  };
}

describe("warehouse order urgency", () => {
  it("sorts by priority, then due date, then oldest order", () => {
    const values = [
      order("normal-undated", "normal", null, "2026-09-20T10:00:00Z"),
      order("high-later", "high", "2026-10-02", "2026-09-20T10:00:00Z"),
      order("urgent-new", "urgent", "2026-09-30", "2026-09-24T10:00:00Z"),
      order("urgent-old", "urgent", "2026-09-30", "2026-09-21T10:00:00Z"),
      order("high-earlier", "high", "2026-09-28", "2026-09-22T10:00:00Z"),
      order("low", "low", "2026-09-26", "2026-09-19T10:00:00Z"),
    ];

    expect(values.sort(compareOrderUrgency).map(value => value.id)).toEqual([
      "urgent-old",
      "urgent-new",
      "high-earlier",
      "high-later",
      "normal-undated",
      "low",
    ]);
  });

  it("places dated orders before undated orders within the same priority", () => {
    const values = [
      order("undated", "normal", null, "2026-09-01T10:00:00Z"),
      order("dated", "normal", "2026-10-01", "2026-09-20T10:00:00Z"),
    ];
    expect(values.sort(compareOrderUrgency).map(value => value.id)).toEqual(["dated", "undated"]);
  });

  it("compares overdue required-by dates using the UTC business date convention", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(isRequiredByOverdue("2026-09-24", now)).toBe(true);
    expect(isRequiredByOverdue("2026-09-25", now)).toBe(false);
    expect(isRequiredByOverdue(null, now)).toBe(false);
  });
});
