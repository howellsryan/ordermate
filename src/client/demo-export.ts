import type { DeliveryDiscrepancyRecord } from "../shared/delivery-discrepancy";
import type { AuditEvent, Customer, InventoryRow, Order, Product, PurchaseOrder, Supplier } from "./model";
import { demoCsv as ensureAcceptanceCsv } from "./demo-acceptance";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";

type DemoExportState = {
  products: Product[];
  inventory: InventoryRow[];
  orders: Order[];
  purchaseOrders: PurchaseOrder[];
  customers: Customer[];
  suppliers: Supplier[];
  audit: AuditEvent[];
  demoAcceptance?: { discrepancies?: DeliveryDiscrepancyRecord[] };
};

function readState(): DemoExportState {
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!raw) throw new Error("Local demo state is not initialised");
  return JSON.parse(raw) as DemoExportState;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
}

function filename(kind: string) {
  return `operating-layer-demo-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Browser-only equivalents of the Worker export schemas. Keeping the column
 * contracts identical makes the guest demo representative without sending any
 * sample data to the API.
 */
export function demoCsv(kind: string) {
  // The acceptance layer reconciles derived state and seeds demo discrepancy
  // evidence. Ignore its legacy CSV string; we rebuild the production schema below.
  ensureAcceptanceCsv(kind);
  const state = readState();

  if (kind === "products") {
    const rows = state.products.flatMap(product => product.variants.map(variant => [
      product.name,
      product.category_name,
      product.status,
      variant.name,
      variant.sku,
      variant.barcode,
      variant.options || {},
      variant.price_minor,
      variant.cost_minor,
      variant.tax_rate_bps,
    ]));
    return { filename: filename(kind), content: csv(["product", "category", "status", "variant", "sku", "barcode", "options", "price_minor", "cost_minor", "tax_rate_bps"], rows) };
  }

  if (kind === "inventory") {
    const rows = state.inventory.map(row => [row.product_name, row.variant_name, row.sku, row.barcode, row.location_name, row.on_hand, row.reserved, row.available, row.incoming, row.tracked ?? 1]);
    return { filename: filename(kind), content: csv(["product", "variant", "sku", "barcode", "location", "on_hand", "reserved", "available", "incoming", "tracked"], rows) };
  }

  if (kind === "orders") {
    const rows = state.orders.map(row => [row.number, row.customer_name, row.location_name, row.status, row.fulfilment_status, row.priority, row.required_by_date, row.line_count, row.subtotal_minor, row.tax_minor, row.total_minor, row.currency, row.created_at]);
    return { filename: filename(kind), content: csv(["order_number", "customer", "location", "status", "fulfilment_status", "priority", "required_by_date", "line_count", "subtotal_minor", "tax_minor", "total_minor", "currency", "created_at"], rows) };
  }

  if (kind === "purchase-orders") {
    const rows = state.purchaseOrders.map(row => [row.number, row.supplier_name, row.location_name, row.status, row.expected_delivery_date, row.ordered_at, row.line_count, row.subtotal_minor, row.tax_minor, row.total_minor, row.currency, row.created_at]);
    return { filename: filename(kind), content: csv(["purchase_order_number", "supplier", "location", "status", "expected_delivery_date", "ordered_at", "line_count", "subtotal_minor", "tax_minor", "total_minor", "currency", "created_at"], rows) };
  }

  if (kind === "delivery-discrepancies") {
    const records = state.demoAcceptance?.discrepancies || [];
    const rows = records.map(row => [row.purchase_order_number, row.supplier_name, row.location_name, row.status, row.issue_count, row.proposal_event_id, row.created_at, row.resolution_code, row.resolution_note, row.resolved_at, row.evidence_json]);
    return { filename: filename(kind), content: csv(["purchase_order_number", "supplier", "location", "status", "issue_count", "proposal_event_id", "created_at", "resolution_code", "resolution_note", "resolved_at", "evidence_json"], rows) };
  }

  if (kind === "audit") {
    const rows = state.audit.map(row => [row.created_at, row.actor_id, row.actor_role, row.action, row.entity_type, row.entity_id, row.metadata_json]);
    return { filename: filename(kind), content: csv(["created_at", "actor_id", "actor_role", "action", "entity_type", "entity_id", "metadata_json"], rows) };
  }

  if (kind === "customers" || kind === "suppliers") {
    const people = kind === "customers" ? state.customers : state.suppliers;
    const rows = people.map(row => [row.name, row.email, row.phone]);
    return { filename: filename(kind), content: csv(["name", "email", "phone"], rows) };
  }

  throw new Error(`Unknown demo export: ${kind}`);
}
