import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DeliveryDiscrepancyRecord } from "../shared/delivery-discrepancy";
import type { OrganizationSummary } from "../shared/types";
import { tenantApi } from "./api";
import { OrderDetailModal, PurchaseOrderDetailModal } from "./RecordDetails";
import { ErrorText, Modal, Status } from "./ui";

type DeepLinkTarget = {
  page: string | null;
  entity: string | null;
  record: string | null;
};

type IntegrationConnection = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
};

type ConnectionsResponse = { connections: IntegrationConnection[] };

type IntegrationException = {
  id: string;
  code: string;
  message: string;
  retryable: boolean;
  status: "open" | "resolved";
  entityType: string | null;
  externalId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type ExceptionsResponse = { exceptions: IntegrationException[] };

type IntegrationExceptionTarget = {
  connection: IntegrationConnection;
  exception: IntegrationException;
};

function targetFromLocation(): DeepLinkTarget {
  const params = new URLSearchParams(window.location.search);
  return {
    page: params.get("page"),
    entity: params.get("entity"),
    record: params.get("record"),
  };
}

function clearRecordTarget() {
  const url = new URL(window.location.href);
  url.searchParams.delete("entity");
  url.searchParams.delete("record");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export default function DeepLinkRecord({ tenant }: { tenant: OrganizationSummary }) {
  const [target, setTarget] = useState<DeepLinkTarget>(() => targetFromLocation());

  useEffect(() => {
    const onPopState = () => setTarget(targetFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setTarget(targetFromLocation());
  }, [tenant.id]);

  const close = () => {
    clearRecordTarget();
    setTarget(current => ({ ...current, entity: null, record: null }));
  };

  if (!target.record) return null;

  if ((target.page === "orders" || target.page === "warehouse") && target.entity === "order") {
    return <OrderDetailModal tenant={tenant} orderId={target.record} onClose={close} />;
  }

  if (target.page === "purchasing" && target.entity === "purchase_order") {
    return <PurchaseOrderDetailModal tenant={tenant} purchaseOrderId={target.record} onClose={close} />;
  }

  if (target.page === "purchasing" && target.entity === "delivery_discrepancy") {
    return <DeliveryDiscrepancyDeepLink tenant={tenant} recordId={target.record} onClose={close} />;
  }

  if (target.page === "settings") {
    return <IntegrationExceptionDeepLink tenant={tenant} recordId={target.record} onClose={close} />;
  }

  return null;
}

function DeliveryDiscrepancyDeepLink({ tenant, recordId, onClose }: { tenant: OrganizationSummary; recordId: string; onClose: () => void }) {
  const record = useQuery({
    queryKey: ["tenant", tenant.id, "delivery-discrepancy-deep-link", recordId],
    queryFn: async () => {
      const [open, resolved] = await Promise.all([
        tenantApi<DeliveryDiscrepancyRecord[]>(tenant.id, "/delivery-discrepancies?status=open"),
        tenantApi<DeliveryDiscrepancyRecord[]>(tenant.id, "/delivery-discrepancies?status=resolved"),
      ]);
      return [...open, ...resolved].find(item => item.id === recordId) || null;
    },
  });

  return <Modal title={record.data ? `Delivery discrepancy · ${record.data.purchase_order_number}` : "Delivery discrepancy"} subtitle="Opened directly from the Operations Work Queue." onClose={onClose} wide>
    {record.isLoading ? <div className="detail-loading"><div className="loader" /><span>Loading discrepancy…</span></div>
      : record.error ? <ErrorText error={record.error} />
        : !record.data ? <div className="empty-state"><strong>Record no longer available</strong><span>The discrepancy may have been removed from the current workspace scope.</span></div>
          : <div className="record-detail">
            <div className="record-summary">
              <Summary label="Supplier" value={record.data.supplier_name} />
              <Summary label="Location" value={record.data.location_name} />
              <Summary label="Issues" value={String(record.data.issue_count)} />
              <Summary label="Created" value={formatDate(record.data.created_at)} />
            </div>
            <div className="record-status-row"><span>Status <Status value={record.data.status} /></span></div>
            {record.data.resolution_note && <div className="automation-callout"><div><strong>Resolution</strong><span>{record.data.resolution_note}</span></div></div>}
            <p>The full discrepancy workflow remains on the Purchase Orders page underneath this record view, including source evidence and resolution controls.</p>
          </div>}
  </Modal>;
}

function IntegrationExceptionDeepLink({ tenant, recordId, onClose }: { tenant: OrganizationSummary; recordId: string; onClose: () => void }) {
  const target = useQuery({
    queryKey: ["tenant", tenant.id, "integration-exception-deep-link", recordId],
    queryFn: async (): Promise<IntegrationExceptionTarget | null> => {
      const connections = await tenantApi<ConnectionsResponse>(tenant.id, "/integrations");
      const active = connections.connections.filter(connection => connection.status !== "disconnected");
      const results = await Promise.all(active.map(async connection => {
        try {
          const response = await tenantApi<ExceptionsResponse>(tenant.id, `/integrations/${connection.id}/exceptions`);
          const exception = response.exceptions.find(item => item.id === recordId || item.externalId === recordId);
          return exception ? { connection, exception } : null;
        } catch {
          return null;
        }
      }));
      return results.find((item): item is IntegrationExceptionTarget => !!item) || null;
    },
  });

  return <Modal title={target.data ? `${target.data.connection.displayName} · ${titleCase(target.data.exception.code)}` : "Integration exception"} subtitle="Opened directly from the Operations Work Queue." onClose={onClose} wide>
    {target.isLoading ? <div className="detail-loading"><div className="loader" /><span>Loading integration exception…</span></div>
      : target.error ? <ErrorText error={target.error} />
        : !target.data ? <div className="empty-state"><strong>Exception no longer active</strong><span>The linked provider condition may have cleared or the connection may have been disconnected.</span></div>
          : <div className="record-detail">
            <div className="record-summary">
              <Summary label="Provider" value={target.data.connection.provider} />
              <Summary label="Connection" value={target.data.connection.displayName} />
              <Summary label="Created" value={formatDate(target.data.exception.createdAt)} />
              <Summary label="Retry" value={target.data.exception.retryable ? "Allowed after correction" : "Manual review required"} />
            </div>
            <div className="record-status-row"><span>Status <Status value={target.data.exception.status} /></span></div>
            <div className="automation-callout"><div><strong>{titleCase(target.data.exception.code)}</strong><span>{target.data.exception.message}</span></div></div>
            {target.data.exception.externalId && <p><strong>{target.data.exception.entityType || "Provider record"}:</strong> {target.data.exception.externalId}</p>}
            <p>The Shopify integration controls and mappings remain visible on Settings underneath this record view.</p>
          </div>}
  </Modal>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="summary-cell"><small>{label}</small><strong>{value}</strong></div>;
}
