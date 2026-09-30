export const OUTBOUND_OPERATIONS = [
  "inventory_publish",
  "fulfilment_publish",
  "tracking_publish",
  "accounting_contact_export",
  "accounting_sale_export",
  "accounting_purchase_export",
] as const;

export const OUTBOUND_JOB_STATUSES = ["pending", "running", "retry_wait", "succeeded", "failed", "superseded"] as const;
export const RECONCILIATION_STATUSES = ["pending", "in_sync", "drift", "error"] as const;
export const RETURN_DISPOSITIONS = ["pending", "restock", "quarantine", "scrap", "return_to_vendor", "no_restock"] as const;

export type OutboundOperation = typeof OUTBOUND_OPERATIONS[number];
export type OutboundJobStatus = typeof OUTBOUND_JOB_STATUSES[number];
export type ReconciliationStatus = typeof RECONCILIATION_STATUSES[number];
export type ReturnDisposition = typeof RETURN_DISPOSITIONS[number];

export type IntegrationOutboundJob = {
  id: string;
  connectionId: string;
  operation: OutboundOperation;
  coalescingKey: string;
  entityType: string;
  entityId: string;
  status: OutboundJobStatus;
  attempts: number;
  nextAttemptAt: string;
  providerRequestId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type IntegrationReconciliation = {
  connectionId: string;
  entityType: string;
  entityId: string;
  direction: "outbound" | "inbound";
  status: ReconciliationStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type IntegrationReturnCase = {
  id: string;
  connectionId: string;
  externalReturnId: string;
  externalOrderId: string | null;
  localOrderId: string | null;
  refundObserved: boolean;
  providerStatus: string | null;
  disposition: ReturnDisposition;
  restockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationOperationalHealth = {
  pendingOutbound: number;
  retryingOutbound: number;
  failedOutbound: number;
  reconciliationDrift: number;
  pendingReturns: number;
  oldestPendingAt: string | null;
};
