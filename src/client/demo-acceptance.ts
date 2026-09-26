import type {
  DeliveryDiscrepancyEvidence,
  DeliveryDiscrepancyRecord,
  DeliveryDiscrepancyResolutionCode,
} from "../shared/delivery-discrepancy";
import type { OperationsReport } from "../shared/operations-report";
import type { AuditEvent, InventoryRow, OrderDetail, Product, PurchaseOrderDetail, SupplierVariant } from "./model";
import {
  demoControlApi as runtimeControlApi,
  demoCsv as runtimeCsv,
  demoOpsApi as runtimeOpsApi,
  demoTenantApi as runtimeTenantApi,
  repairDemoState,
} from "./demo-runtime";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";
const ACCEPTANCE_VERSION = 1;

type ReturnEvent = {
  id: string;
  created_at: string;
  order_id: string;
  lines: Array<{ variant_id: string; quantity: number }>;
};

type AcceptanceState = {
  version: number;
  discrepancies: DeliveryDiscrepancyRecord[];
  returnEvents: ReturnEvent[];
};

type ExtendedDemoState = {
  settings: { low_stock_threshold: number; currency: string };
  products: Product[];
  inventory: InventoryRow[];
  supplierVariants: SupplierVariant[];
  purchaseOrders: PurchaseOrderDetail[];
  orders: OrderDetail[];
  audit: AuditEvent[];
  demoAcceptance?: AcceptanceState;
};

type JsonRecord = Record<string, unknown>;

function parseBody(init?: RequestInit): JsonRecord {
  if (typeof init?.body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    return parsed && typeof parsed === "object" ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function readState(): ExtendedDemoState {
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!raw) throw new Error("Local demo state is not initialised");
  return JSON.parse(raw) as ExtendedDemoState;
}

function writeState(state: ExtendedDemoState) {
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}

function isoStamp(offsetDays: number, hour = 10) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function seededDiscrepancy(): DeliveryDiscrepancyRecord {
  const evidence: DeliveryDiscrepancyEvidence = {
    version: 1,
    proposalKey: "demo-delivery-proposal-1",
    proposalEventId: "demo-delivery-event-1",
    purchaseOrderId: "po-2",
    purchaseOrderNumber: "PO-2026-000141",
    documentReference: "DN-AW-8841",
    documentDate: isoStamp(-2).slice(0, 10),
    issues: [
      {
        type: "quantity_variance",
        lineId: "pol-2a",
        sku: "PPE-GLOVE-L",
        description: "Warehouse Grip Gloves · Large",
        documentQuantity: 30,
        receivedQuantity: 24,
      },
      {
        type: "unexpected_line",
        description: "Protective arm sleeves",
        supplierSku: "AW-SLEEVE-01",
        sku: "",
        barcode: "",
        quantity: 2,
        warnings: ["Item is not present on the reviewed purchase order."],
      },
    ],
  };
  return {
    id: "demo-discrepancy-1",
    purchase_order_id: "po-2",
    purchase_order_number: "PO-2026-000141",
    supplier_name: "Apex Workwear",
    location_name: "Nottingham Warehouse",
    proposal_key: evidence.proposalKey,
    proposal_event_id: evidence.proposalEventId,
    status: "open",
    issue_count: evidence.issues.length,
    evidence_json: JSON.stringify(evidence),
    created_at: isoStamp(-1, 14),
    created_by: "demo-user",
    resolved_at: null,
    resolved_by: null,
    resolution_code: null,
    resolution_note: null,
  };
}

function deriveExistingReturns(state: ExtendedDemoState): ReturnEvent[] {
  return state.orders.flatMap(order => {
    const lines = order.lines
      .filter(line => line.quantity_returned > 0)
      .map(line => ({ variant_id: line.variant_id, quantity: line.quantity_returned }));
    return lines.length ? [{ id: `demo-return-seed-${order.id}`, created_at: order.created_at, order_id: order.id, lines }] : [];
  });
}

function acceptance(state: ExtendedDemoState) {
  if (!state.demoAcceptance || state.demoAcceptance.version !== ACCEPTANCE_VERSION) {
    state.demoAcceptance = {
      version: ACCEPTANCE_VERSION,
      discrepancies: [seededDiscrepancy()],
      returnEvents: deriveExistingReturns(state),
    };
    writeState(state);
  }
  return state.demoAcceptance;
}

async function stateReady() {
  await repairDemoState();
  const state = readState();
  acceptance(state);
  return state;
}

function startOfWindow(days: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - (days - 1));
  return value.getTime();
}

function dayKey(offsetDays: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function isCommercialOrder(order: OrderDetail) {
  return order.status === "confirmed" || order.status === "completed";
}

function activeVariantIds(state: ExtendedDemoState) {
  return new Set(
    state.products
      .filter(product => product.status === "active")
      .flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => variant.id)),
  );
}

function outstandingPurchaseCommitment(state: ExtendedDemoState) {
  return state.purchaseOrders
    .filter(po => po.status === "ordered" || po.status === "partially_received")
    .reduce((sum, po) => sum + po.lines.reduce((lineSum, line) => {
      const outstanding = Math.max(0, line.quantity_ordered - line.quantity_received);
      if (!outstanding || line.quantity_ordered <= 0) return lineSum;
      const lineNet = line.unit_cost_minor * line.quantity_ordered;
      const lineTax = Math.round(lineNet * line.tax_rate_bps / 10000);
      const lineGross = lineNet + lineTax;
      return lineSum + Math.round(lineGross * outstanding / line.quantity_ordered);
    }, 0), 0);
}

function hardenReport(state: ExtendedDemoState, base: OperationsReport, days: number): OperationsReport {
  const cutoff = startOfWindow(days);
  const recentOrders = state.orders.filter(order => new Date(order.created_at).getTime() >= cutoff);
  const commercialOrders = recentOrders.filter(isCommercialOrder);
  const returns = acceptance(state).returnEvents.filter(event => new Date(event.created_at).getTime() >= cutoff);
  const activeVariants = activeVariantIds(state);
  const healthRows = state.inventory.filter(row => activeVariants.has(row.variant_id) && row.tracked !== 0);
  const openPurchaseOrders = state.purchaseOrders.filter(po => po.status === "ordered" || po.status === "partially_received");
  const today = new Date().toISOString().slice(0, 10);

  const returnsByDay = new Map<string, number>();
  for (const event of returns) {
    const day = event.created_at.slice(0, 10);
    const quantity = event.lines.reduce((sum, line) => sum + line.quantity, 0);
    returnsByDay.set(day, (returnsByDay.get(day) || 0) + quantity);
  }

  const orderTrend: OperationsReport["orderTrend"] = [];
  const movementTrend: OperationsReport["movementTrend"] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = dayKey(-offset);
    const orders = recentOrders.filter(order => order.created_at.slice(0, 10) === day);
    const baseMovement = base.movementTrend.find(point => point.day === day);
    orderTrend.push({
      day,
      orders: orders.length,
      grossMinor: orders.filter(isCommercialOrder).reduce((sum, order) => sum + order.total_minor, 0),
    });
    movementTrend.push({
      day,
      fulfilledUnits: baseMovement?.fulfilledUnits || 0,
      receivedUnits: baseMovement?.receivedUnits || 0,
      returnedUnits: returnsByDay.get(day) || 0,
    });
  }

  return {
    ...base,
    windowDays: days,
    inventory: {
      ...base.inventory,
      lowStockPositions: healthRows.filter(row => row.available > 0 && row.available <= state.settings.low_stock_threshold).length,
      stockoutPositions: healthRows.filter(row => row.available <= 0).length,
    },
    orders: {
      ...base.orders,
      createdOrders: recentOrders.length,
      grossOrderValueMinor: commercialOrders.reduce((sum, order) => sum + order.total_minor, 0),
      returnedUnits: returns.reduce((sum, event) => sum + event.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0),
    },
    purchasing: {
      ...base.purchasing,
      openPurchaseOrders: openPurchaseOrders.length,
      overduePurchaseOrders: openPurchaseOrders.filter(po => !!po.expected_delivery_date && po.expected_delivery_date < today).length,
      outstandingCommitmentMinor: outstandingPurchaseCommitment(state),
    },
    orderTrend,
    movementTrend,
  };
}

async function recordReturnEvent(path: string, init: RequestInit | undefined) {
  const match = path.match(/^\/orders\/([^/]+)\/return(?:\?|$)/);
  if (!match) return runtimeTenantApi(path, init);
  const orderId = decodeURIComponent(match[1]);
  const beforeState = await stateReady();
  const before = beforeState.orders.find(order => order.id === orderId);
  const beforeReturned = new Map(before?.lines.map(line => [line.id, line.quantity_returned]) || []);

  const result = await runtimeTenantApi(path, init);
  const afterState = await stateReady();
  const after = afterState.orders.find(order => order.id === orderId);
  if (!after) return result;

  const lines = after.lines.flatMap(line => {
    const quantity = line.quantity_returned - (beforeReturned.get(line.id) || 0);
    return quantity > 0 ? [{ variant_id: line.variant_id, quantity }] : [];
  });
  if (lines.length) {
    acceptance(afterState).returnEvents.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), order_id: orderId, lines });
    writeState(afterState);
  }
  return result;
}

function normalizedSupplierSku(value: string) {
  return value.trim().normalize("NFKC").toUpperCase();
}

async function validateSupplierVariant(init?: RequestInit) {
  const body = parseBody(init);
  const supplierId = String(body.supplierId || "");
  const variantId = String(body.variantId || "");
  const supplierSku = typeof body.supplierSku === "string" ? body.supplierSku.trim() : "";
  if (!supplierId || !variantId || !supplierSku) return;

  const state = await stateReady();
  const normalized = normalizedSupplierSku(supplierSku);
  const conflict = state.supplierVariants.find(mapping =>
    mapping.supplier_id === supplierId
    && mapping.variant_id !== variantId
    && normalizedSupplierSku(mapping.supplier_sku || "") === normalized,
  );
  if (!conflict) return;

  throw new Error(`Supplier SKU ${supplierSku} is already mapped to ${conflict.product_name} · ${conflict.variant_name} (${conflict.sku})`);
}

async function validateStocktake(init?: RequestInit) {
  const body = parseBody(init);
  const locationId = String(body.locationId || "");
  const lines = Array.isArray(body.lines) ? body.lines as JsonRecord[] : [];
  if (!locationId) throw new Error("Choose a stock location before committing the cycle count");
  if (!lines.length) throw new Error("A cycle count needs at least one line");

  const seen = new Set<string>();
  const state = await stateReady();
  for (const line of lines) {
    const variantId = String(line.variantId || "");
    if (!variantId) throw new Error("Every cycle-count line needs a product variant");
    if (seen.has(variantId)) throw new Error("A variant can only appear once in a cycle count");
    seen.add(variantId);

    const expectedOnHand = Number(line.expectedOnHand);
    const expectedReserved = Number(line.expectedReserved);
    const countedOnHand = Number(line.countedOnHand);
    if (![expectedOnHand, expectedReserved, countedOnHand].every(value => Number.isInteger(value) && value >= 0)) {
      throw new Error("Cycle-count quantities must be non-negative whole numbers");
    }

    const row = state.inventory.find(item => item.variant_id === variantId && item.location_id === locationId);
    if (!row) throw new Error(`Product variant ${variantId} no longer exists at this location`);
    if (row.on_hand !== expectedOnHand || row.reserved !== expectedReserved) {
      throw new Error(`Stock changed while you were counting ${row.product_name} · ${row.variant_name} (${row.sku}). Expected ${expectedOnHand} on hand / ${expectedReserved} reserved; it is now ${row.on_hand} on hand / ${row.reserved} reserved. Refresh the location and review the count before committing.`);
    }
    if (countedOnHand < row.reserved) {
      throw new Error(`${row.product_name} · ${row.variant_name} (${row.sku}) has ${row.reserved} reserved units, so on-hand stock cannot be counted below ${row.reserved}. Resolve the outstanding reservations before applying this variance.`);
    }
  }
}

export async function demoTenantApi<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");

  if (method === "GET" && url.pathname === "/delivery-discrepancies") {
    const state = await stateReady();
    const status = url.searchParams.get("status");
    const records = acceptance(state).discrepancies.filter(record => !status || record.status === status);
    return structuredClone(records) as T;
  }

  if (method === "PATCH" && /^\/delivery-discrepancies\/[^/]+$/.test(url.pathname)) {
    const state = await stateReady();
    const id = decodeURIComponent(url.pathname.split("/")[2]);
    const record = acceptance(state).discrepancies.find(item => item.id === id);
    if (!record) throw new Error("Delivery discrepancy not found");
    if (record.status !== "open") throw new Error("Only open delivery discrepancies can be resolved");
    const body = parseBody(init);
    const allowed: DeliveryDiscrepancyResolutionCode[] = ["supplier_follow_up", "accepted_variance", "corrected_document", "other"];
    const resolutionCode = allowed.includes(body.resolutionCode as DeliveryDiscrepancyResolutionCode)
      ? body.resolutionCode as DeliveryDiscrepancyResolutionCode
      : "other";
    const resolutionNote = String(body.resolutionNote || "").trim();
    if (resolutionNote.length < 3) throw new Error("Add a short resolution note before closing this discrepancy");
    const now = new Date().toISOString();
    record.status = "resolved";
    record.resolved_at = now;
    record.resolved_by = "demo-user";
    record.resolution_code = resolutionCode;
    record.resolution_note = resolutionNote;
    state.audit.unshift({
      id: crypto.randomUUID(),
      actor_id: "demo-user",
      actor_role: "owner",
      action: "delivery_discrepancy.resolved",
      entity_type: "delivery_discrepancy",
      entity_id: record.id,
      metadata_json: JSON.stringify({ resolutionCode, resolutionNote }),
      created_at: now,
    });
    writeState(state);
    return { ok: true } as T;
  }

  if (method === "POST" && url.pathname === "/inventory/stocktake") {
    await validateStocktake(init);
  }

  if (method === "POST" && url.pathname === "/supplier-variants") {
    await validateSupplierVariant(init);
  }

  if (method === "POST" && /^\/orders\/[^/]+\/return$/.test(url.pathname)) {
    return await recordReturnEvent(url.pathname, init) as T;
  }

  const result = await runtimeTenantApi<T>(path, init);
  if (method === "GET" && url.pathname === "/reports/operations") {
    const state = await stateReady();
    const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days")) || 30));
    return hardenReport(state, result as OperationsReport, days) as T;
  }
  return result;
}

export async function demoOpsApi<T>(path: string): Promise<T> {
  return runtimeOpsApi<T>(path);
}

export async function demoControlApi<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  if (method === "GET" && url.pathname === "/delivery-documents/proposal") {
    return { sourceKey: "", sourceName: "Local demo delivery note" } as T;
  }
  return runtimeControlApi<T>(path, init);
}

function csv(rows: string[][]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return rows.map(row => row.map(escape).join(",")).join("\n");
}

export function demoCsv(kind: string) {
  if (kind !== "delivery-discrepancies") return runtimeCsv(kind);
  const state = readState();
  const records = acceptance(state).discrepancies;
  const rows = [["purchase_order", "supplier", "status", "issue_count", "created_at", "resolution"]];
  for (const record of records) {
    rows.push([
      record.purchase_order_number,
      record.supplier_name,
      record.status,
      String(record.issue_count),
      record.created_at,
      record.resolution_note || "",
    ]);
  }
  return { filename: "operating-layer-demo-delivery-discrepancies.csv", content: csv(rows) };
}
