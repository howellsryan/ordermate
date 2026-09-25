import type { OperationsReport } from "../shared/operations-report";
import { TenantStore as BulkTenantStore } from "./tenant-store-bulk";
import type { TenantEnv } from "./tenant-store";

type CountRow = { count: number };
type SumRow = { total: number | null };
type SettingsRow = { currency: string; low_stock_threshold: number };
type InventorySummaryRow = {
  on_hand: number | null;
  reserved: number | null;
  available: number | null;
  value_minor: number | null;
  positions: number;
};
type HealthRow = { low_stock: number | null; stockouts: number | null };
type LocationRow = { location_id: string; location_name: string; on_hand: number | null; available: number | null; value_minor: number | null };
type TopRow = { variant_id: string; product_name: string; variant_name: string; sku: string; units: number };
type OrderTrendRow = { day: string; orders: number; gross_minor: number | null };
type MovementTrendRow = { day: string; units: number };

function numeric(value: number | null | undefined) {
  return Number(value || 0);
}

function dateWindow(days: number) {
  return `-${Math.max(0, days - 1)} days`;
}

function dateKeys(days: number) {
  const keys: string[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    keys.push(date.toISOString().slice(0, 10));
  }
  return keys;
}

/** Deterministic operational aggregates. No report value mutates business state. */
export class TenantStore extends BulkTenantStore {
  private readonly reportsCtx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: TenantEnv) {
    super(ctx, env);
    this.reportsCtx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (request.method === "GET" && path === "/reports/operations") return this.operationsReport(url);
    return super.fetch(request);
  }

  private operationsReport(url: URL) {
    const requestedDays = Number(url.searchParams.get("days") || 30);
    if (!Number.isInteger(requestedDays) || requestedDays < 7 || requestedDays > 90) {
      return Response.json({ error: "Report window must be a whole number between 7 and 90 days" }, { status: 400 });
    }
    const days = requestedDays;
    const window = dateWindow(days);
    const sql = this.reportsCtx.storage.sql;
    const settings = sql.exec<SettingsRow>("SELECT currency, low_stock_threshold FROM tenant_settings WHERE id = 1").toArray()[0] || { currency: "GBP", low_stock_threshold: 5 };

    const inventory = sql.exec<InventorySummaryRow>(
      `SELECT SUM(il.on_hand) AS on_hand,
              SUM(il.reserved) AS reserved,
              SUM(il.on_hand - il.reserved) AS available,
              SUM(il.on_hand * v.cost_minor) AS value_minor,
              COUNT(*) AS positions
       FROM inventory_levels il
       JOIN product_variants v ON v.id = il.variant_id`,
    ).toArray()[0];
    const incoming = sql.exec<SumRow>(
      `SELECT SUM(pol.quantity_ordered - pol.quantity_received) AS total
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
       WHERE po.status IN ('ordered','partially_received')`,
    ).toArray()[0];
    const health = sql.exec<HealthRow>(
      `SELECT SUM(CASE WHEN (il.on_hand - il.reserved) > 0 AND (il.on_hand - il.reserved) <= ? THEN 1 ELSE 0 END) AS low_stock,
              SUM(CASE WHEN (il.on_hand - il.reserved) <= 0 THEN 1 ELSE 0 END) AS stockouts
       FROM inventory_levels il
       JOIN product_variants v ON v.id = il.variant_id AND v.active = 1
       JOIN products p ON p.id = v.product_id AND p.status = 'active'
       JOIN locations l ON l.id = il.location_id AND l.active = 1`,
      settings.low_stock_threshold,
    ).toArray()[0];

    const ordersCreated = sql.exec<CountRow>(
      "SELECT COUNT(*) AS count FROM orders WHERE date(created_at) >= date('now', ?)",
      window,
    ).toArray()[0]?.count || 0;
    const openOrders = sql.exec<CountRow>(
      "SELECT COUNT(*) AS count FROM orders WHERE status IN ('draft','confirmed')",
    ).toArray()[0]?.count || 0;
    const orderValue = sql.exec<SumRow>(
      "SELECT SUM(total_minor) AS total FROM orders WHERE status IN ('confirmed','completed') AND date(created_at) >= date('now', ?)",
      window,
    ).toArray()[0];
    const fulfilledUnits = sql.exec<SumRow>(
      `SELECT SUM(fl.quantity) AS total
       FROM fulfilment_lines fl
       JOIN fulfilments f ON f.id = fl.fulfilment_id
       WHERE date(f.created_at) >= date('now', ?)`,
      window,
    ).toArray()[0];
    const returnedUnits = sql.exec<SumRow>(
      `SELECT SUM(rl.quantity) AS total
       FROM return_lines rl
       JOIN returns r ON r.id = rl.return_id
       WHERE date(r.created_at) >= date('now', ?)`,
      window,
    ).toArray()[0];

    const openPurchaseOrders = sql.exec<CountRow>(
      "SELECT COUNT(*) AS count FROM purchase_orders WHERE status IN ('ordered','partially_received')",
    ).toArray()[0]?.count || 0;
    const overduePurchaseOrders = sql.exec<CountRow>(
      `SELECT COUNT(*) AS count FROM purchase_orders
       WHERE status IN ('ordered','partially_received')
         AND expected_delivery_date IS NOT NULL
         AND expected_delivery_date < date('now')`,
    ).toArray()[0]?.count || 0;
    const outstandingCommitment = sql.exec<SumRow>(
      `SELECT ROUND(SUM(pol.gross_minor * (pol.quantity_ordered - pol.quantity_received) * 1.0 / pol.quantity_ordered)) AS total
       FROM purchase_order_lines pol
       JOIN purchase_orders po ON po.id = pol.purchase_order_id
       WHERE po.status IN ('ordered','partially_received')`,
    ).toArray()[0];
    const receivedUnits = sql.exec<SumRow>(
      `SELECT SUM(quantity_delta) AS total FROM inventory_movements
       WHERE movement_type = 'purchase_receipt'
         AND date(created_at) >= date('now', ?)`,
      window,
    ).toArray()[0];

    const locations = sql.exec<LocationRow>(
      `SELECT l.id AS location_id,
              l.name AS location_name,
              SUM(COALESCE(il.on_hand, 0)) AS on_hand,
              SUM(COALESCE(il.on_hand, 0) - COALESCE(il.reserved, 0)) AS available,
              SUM(COALESCE(il.on_hand, 0) * COALESCE(v.cost_minor, 0)) AS value_minor
       FROM locations l
       LEFT JOIN inventory_levels il ON il.location_id = l.id
       LEFT JOIN product_variants v ON v.id = il.variant_id
       WHERE l.active = 1
       GROUP BY l.id, l.name
       ORDER BY value_minor DESC, l.name`,
    ).toArray();

    const topFulfilled = sql.exec<TopRow>(
      `SELECT ol.variant_id,
              ol.product_name_snapshot AS product_name,
              ol.variant_name_snapshot AS variant_name,
              ol.sku_snapshot AS sku,
              SUM(fl.quantity) AS units
       FROM fulfilment_lines fl
       JOIN fulfilments f ON f.id = fl.fulfilment_id
       JOIN order_lines ol ON ol.id = fl.order_line_id
       WHERE date(f.created_at) >= date('now', ?)
       GROUP BY ol.variant_id, ol.product_name_snapshot, ol.variant_name_snapshot, ol.sku_snapshot
       ORDER BY units DESC, product_name, variant_name
       LIMIT 10`,
      window,
    ).toArray();

    const orderTrendRows = sql.exec<OrderTrendRow>(
      `SELECT date(created_at) AS day,
              COUNT(*) AS orders,
              SUM(CASE WHEN status IN ('confirmed','completed') THEN total_minor ELSE 0 END) AS gross_minor
       FROM orders
       WHERE date(created_at) >= date('now', ?)
       GROUP BY date(created_at)
       ORDER BY day`,
      window,
    ).toArray();
    const fulfilTrendRows = sql.exec<MovementTrendRow>(
      `SELECT date(f.created_at) AS day, SUM(fl.quantity) AS units
       FROM fulfilment_lines fl JOIN fulfilments f ON f.id = fl.fulfilment_id
       WHERE date(f.created_at) >= date('now', ?)
       GROUP BY date(f.created_at)`,
      window,
    ).toArray();
    const receiptTrendRows = sql.exec<MovementTrendRow>(
      `SELECT date(created_at) AS day, SUM(quantity_delta) AS units
       FROM inventory_movements
       WHERE movement_type = 'purchase_receipt' AND date(created_at) >= date('now', ?)
       GROUP BY date(created_at)`,
      window,
    ).toArray();
    const returnTrendRows = sql.exec<MovementTrendRow>(
      `SELECT date(r.created_at) AS day, SUM(rl.quantity) AS units
       FROM return_lines rl JOIN returns r ON r.id = rl.return_id
       WHERE date(r.created_at) >= date('now', ?)
       GROUP BY date(r.created_at)`,
      window,
    ).toArray();

    const orderByDay = new Map(orderTrendRows.map(row => [row.day, row]));
    const fulfilByDay = new Map(fulfilTrendRows.map(row => [row.day, row.units]));
    const receiptByDay = new Map(receiptTrendRows.map(row => [row.day, row.units]));
    const returnByDay = new Map(returnTrendRows.map(row => [row.day, row.units]));
    const daysInWindow = dateKeys(days);

    const report: OperationsReport = {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      currency: settings.currency,
      inventory: {
        onHandUnits: numeric(inventory?.on_hand),
        reservedUnits: numeric(inventory?.reserved),
        availableUnits: numeric(inventory?.available),
        incomingUnits: numeric(incoming?.total),
        inventoryValueMinor: numeric(inventory?.value_minor),
        trackedPositions: numeric(inventory?.positions),
        lowStockPositions: numeric(health?.low_stock),
        stockoutPositions: numeric(health?.stockouts),
      },
      orders: {
        createdOrders: ordersCreated,
        openOrders,
        grossOrderValueMinor: numeric(orderValue?.total),
        fulfilledUnits: numeric(fulfilledUnits?.total),
        returnedUnits: numeric(returnedUnits?.total),
      },
      purchasing: {
        openPurchaseOrders,
        overduePurchaseOrders,
        outstandingCommitmentMinor: numeric(outstandingCommitment?.total),
        receivedUnits: numeric(receivedUnits?.total),
      },
      locations: locations.map(row => ({
        locationId: row.location_id,
        locationName: row.location_name,
        onHandUnits: numeric(row.on_hand),
        availableUnits: numeric(row.available),
        inventoryValueMinor: numeric(row.value_minor),
      })),
      topFulfilled: topFulfilled.map(row => ({
        variantId: row.variant_id,
        productName: row.product_name,
        variantName: row.variant_name,
        sku: row.sku,
        fulfilledUnits: row.units,
      })),
      orderTrend: daysInWindow.map(day => ({ day, orders: orderByDay.get(day)?.orders || 0, grossMinor: numeric(orderByDay.get(day)?.gross_minor) })),
      movementTrend: daysInWindow.map(day => ({
        day,
        fulfilledUnits: fulfilByDay.get(day) || 0,
        receivedUnits: receiptByDay.get(day) || 0,
        returnedUnits: returnByDay.get(day) || 0,
      })),
    };
    return Response.json(report);
  }
}
