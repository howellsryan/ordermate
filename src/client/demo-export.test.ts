import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoCsv } from "./demo-export";
import { resetDemoData } from "./demo-store";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

function header(csv: string) {
  return csv.split("\n", 1)[0];
}

describe("guest demo CSV export parity", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://demo.example" } });
    vi.stubGlobal("localStorage", window.localStorage);
    resetDemoData();
  });

  it("exports the same product commercial columns as the Worker", () => {
    const exported = demoCsv("products");
    expect(header(exported.content)).toBe('"product","category","status","variant","sku","barcode","options","price_minor","cost_minor","tax_rate_bps"');
    expect(exported.content).toContain("Recycled Mailer Box");
    expect(exported.content).toContain("BOX-MAIL-S");
  });

  it("exports the same order and purchase-order accounting columns as the Worker", () => {
    expect(header(demoCsv("orders").content)).toBe('"order_number","customer","location","status","fulfilment_status","priority","required_by_date","line_count","subtotal_minor","tax_minor","total_minor","currency","created_at"');
    expect(header(demoCsv("purchase-orders").content)).toBe('"purchase_order_number","supplier","location","status","expected_delivery_date","ordered_at","line_count","subtotal_minor","tax_minor","total_minor","currency","created_at"');
  });

  it("includes discrepancy evidence and resolution columns", () => {
    const exported = demoCsv("delivery-discrepancies");
    expect(header(exported.content)).toBe('"purchase_order_number","supplier","location","status","issue_count","proposal_event_id","created_at","resolution_code","resolution_note","resolved_at","evidence_json"');
    expect(exported.content).toContain("PO-2026-000141");
    expect(exported.content).toContain("quantity_variance");
    expect(exported.content).toContain("unexpected_line");
  });

  it("keeps inventory, people and audit schemas aligned with production", () => {
    expect(header(demoCsv("inventory").content)).toBe('"product","variant","sku","barcode","location","on_hand","reserved","available","incoming","tracked"');
    expect(header(demoCsv("customers").content)).toBe('"name","email","phone"');
    expect(header(demoCsv("suppliers").content)).toBe('"name","email","phone"');
    expect(header(demoCsv("audit").content)).toBe('"created_at","actor_id","actor_role","action","entity_type","entity_id","metadata_json"');
  });
});
