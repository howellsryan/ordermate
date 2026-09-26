import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ClipboardList, PackageCheck, RotateCcw, ShoppingCart, TrendingUp, TriangleAlert, Warehouse } from "lucide-react";
import type { OrganizationSummary } from "../../shared/types";
import type { OperationsReport } from "../../shared/operations-report";
import { calendarDate, money, tenantApi } from "../api";
import { DataState, PageHeader } from "../ui";

const windows = [7, 30, 60, 90] as const;

export default function Reports({ tenant }: { tenant: OrganizationSummary }) {
  const [days, setDays] = useState<number>(30);
  const report = useQuery({
    queryKey: ["tenant", tenant.id, "operations-report", days],
    queryFn: () => tenantApi<OperationsReport>(tenant.id, `/reports/operations?days=${days}`),
  });

  return <>
    <PageHeader eyebrow="Reporting" title="Operations report" description="Understand stock, fulfilment and purchasing from the same canonical records that run Operating Layer. Order values are operational values, not payment or cash-receipt reporting." actions={<div className="report-window" aria-label="Report window">{windows.map(value => <button key={value} type="button" className={days === value ? "active" : ""} onClick={() => setDays(value)}>{value}d</button>)}</div>} />
    <DataState loading={report.isLoading} error={report.error} empty={!report.data} emptyText="Operational activity will appear here as you use Operating Layer.">
      {report.data && <ReportBody report={report.data} />}
    </DataState>
  </>;
}

function ReportBody({ report }: { report: OperationsReport }) {
  const orderMax = useMemo(() => Math.max(1, ...report.orderTrend.map(point => point.grossMinor)), [report.orderTrend]);
  const movementMax = useMemo(() => Math.max(1, ...report.movementTrend.map(point => point.fulfilledUnits + point.receivedUnits + point.returnedUnits)), [report.movementTrend]);

  return <div className="reports-stack">
    <section className="report-kpis">
      <Metric icon={<Boxes size={18} />} label="Inventory at cost" value={money(report.inventory.inventoryValueMinor, report.currency)} detail={`${report.inventory.onHandUnits} units on hand`} />
      <Metric icon={<ShoppingCart size={18} />} label={`Gross order value · ${report.windowDays}d`} value={money(report.orders.grossOrderValueMinor, report.currency)} detail={`${report.orders.createdOrders} orders created`} />
      <Metric icon={<ClipboardList size={18} />} label="Open PO commitment" value={money(report.purchasing.outstandingCommitmentMinor, report.currency)} detail={`${report.purchasing.openPurchaseOrders} open purchase orders`} />
      <Metric icon={<PackageCheck size={18} />} label={`Fulfilled · ${report.windowDays}d`} value={`${report.orders.fulfilledUnits} units`} detail={`${report.orders.returnedUnits} returned`} />
    </section>

    <section className="report-grid two">
      <div className="panel report-card">
        <div className="panel-heading"><div><p className="eyebrow">Inventory health</p><h3>Current stock position</h3></div><Warehouse size={20} /></div>
        <div className="report-facts">
          <ReportFact label="Available" value={`${report.inventory.availableUnits}`} suffix="units" />
          <ReportFact label="Reserved" value={`${report.inventory.reservedUnits}`} suffix="units" />
          <ReportFact label="Incoming" value={`${report.inventory.incomingUnits}`} suffix="units" />
          <ReportFact label="Tracked positions" value={`${report.inventory.trackedPositions}`} />
          <ReportFact label="Low stock" value={`${report.inventory.lowStockPositions}`} warning={report.inventory.lowStockPositions > 0} />
          <ReportFact label="Stockouts" value={`${report.inventory.stockoutPositions}`} warning={report.inventory.stockoutPositions > 0} />
        </div>
      </div>
      <div className="panel report-card">
        <div className="panel-heading"><div><p className="eyebrow">Purchasing attention</p><h3>Supplier commitments</h3></div><TriangleAlert size={20} /></div>
        <div className="report-facts compact">
          <ReportFact label="Open POs" value={`${report.purchasing.openPurchaseOrders}`} />
          <ReportFact label="Overdue POs" value={`${report.purchasing.overduePurchaseOrders}`} warning={report.purchasing.overduePurchaseOrders > 0} />
          <ReportFact label={`Units received · ${report.windowDays}d`} value={`${report.purchasing.receivedUnits}`} />
          <ReportFact label="Open orders" value={`${report.orders.openOrders}`} />
        </div>
      </div>
    </section>

    <section className="report-grid two">
      <TrendCard title="Gross order value" subtitle={`${report.windowDays}-day creation trend`} icon={<TrendingUp size={20} />}>
        <div className="trend-bars" aria-label="Gross order value trend">{report.orderTrend.map(point => <div className="trend-column" key={point.day} title={`${calendarDate(point.day)} · ${money(point.grossMinor, report.currency)} · ${point.orders} order${point.orders === 1 ? "" : "s"}`}><span style={{ height: `${Math.max(point.grossMinor ? 4 : 0, Math.round(point.grossMinor / orderMax * 100))}%` }} /><small>{point.day.slice(5)}</small></div>)}</div>
      </TrendCard>
      <TrendCard title="Physical movement" subtitle="Receipts, fulfilment and returns" icon={<RotateCcw size={20} />}>
        <div className="trend-bars movement" aria-label="Physical stock movement trend">{report.movementTrend.map(point => { const total = point.fulfilledUnits + point.receivedUnits + point.returnedUnits; return <div className="trend-column" key={point.day} title={`${calendarDate(point.day)} · ${point.receivedUnits} received · ${point.fulfilledUnits} fulfilled · ${point.returnedUnits} returned`}><span style={{ height: `${Math.max(total ? 4 : 0, Math.round(total / movementMax * 100))}%` }} /><small>{point.day.slice(5)}</small></div>; })}</div>
      </TrendCard>
    </section>

    <section className="report-grid two">
      <div className="panel report-card">
        <div className="panel-heading"><div><p className="eyebrow">Locations</p><h3>Stock value by location</h3></div><Warehouse size={20} /></div>
        {report.locations.length ? <div className="report-list">{report.locations.map(location => <div key={location.locationId}><span><strong>{location.locationName}</strong><small>{location.onHandUnits} on hand · {location.availableUnits} available</small></span><strong>{money(location.inventoryValueMinor, report.currency)}</strong></div>)}</div> : <p className="report-empty">No active stock locations yet.</p>}
      </div>
      <div className="panel report-card">
        <div className="panel-heading"><div><p className="eyebrow">Throughput</p><h3>Top fulfilled SKUs · {report.windowDays}d</h3></div><PackageCheck size={20} /></div>
        {report.topFulfilled.length ? <div className="report-list ranked">{report.topFulfilled.map((item, index) => <div key={`${item.variantId}:${item.sku}`}><b>{index + 1}</b><span><strong>{item.productName} · {item.variantName}</strong><small className="mono">{item.sku}</small></span><strong>{item.fulfilledUnits}</strong></div>)}</div> : <p className="report-empty">Fulfilled order lines will appear here.</p>}
      </div>
    </section>

    <p className="report-generated">Generated from tenant records at {new Date(report.generatedAt).toLocaleString()} · Window: {report.windowDays} days.</p>
  </div>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="panel report-metric"><span className="report-metric-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></div>;
}

function ReportFact({ label, value, suffix, warning = false }: { label: string; value: string; suffix?: string; warning?: boolean }) {
  return <div className={warning ? "warning" : ""}><small>{label}</small><strong>{value}{suffix ? <em>{suffix}</em> : null}</strong></div>;
}

function TrendCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="panel report-card"><div className="panel-heading"><div><p className="eyebrow">Trend</p><h3>{title}</h3><span>{subtitle}</span></div>{icon}</div>{children}</div>;
}
