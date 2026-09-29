export const WORK_QUEUE_CATEGORIES = [
  "customer_promise",
  "stock_risk",
  "supply_risk",
  "receiving_exception",
  "integration_exception",
] as const;

export const WORK_QUEUE_STATUSES = ["open", "acknowledged", "snoozed", "resolved", "dismissed"] as const;
export const WORK_QUEUE_SEVERITIES = ["critical", "warning", "info"] as const;

export type WorkQueueCategory = typeof WORK_QUEUE_CATEGORIES[number];
export type WorkQueueStatus = typeof WORK_QUEUE_STATUSES[number];
export type WorkQueueSeverity = typeof WORK_QUEUE_SEVERITIES[number];

export type WorkQueuePage = "orders" | "warehouse" | "inventory" | "purchasing" | "service" | "settings";

export type WorkQueueSignal = {
  source: "flow_plan" | "integration_exception";
  fingerprint: string;
  category: WorkQueueCategory;
  severity: WorkQueueSeverity;
  title: string;
  detail: string;
  nextAction: string;
  page: WorkQueuePage;
  score: number;
  evidence: string[];
  entityType?: string | null;
  entityId?: string | null;
};

export type WorkQueueItem = WorkQueueSignal & {
  id: string;
  status: WorkQueueStatus;
  activeSignal: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  snoozedUntil: string | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  clearedAt: string | null;
  updatedAt: string;
};

export type WorkQueueSummary = {
  actionable: number;
  critical: number;
  acknowledged: number;
  snoozed: number;
  assignedToMe: number;
};

export type WorkQueueResponse = {
  generatedAt: string;
  checks: string[];
  summary: WorkQueueSummary;
  items: WorkQueueItem[];
};

export type WorkQueueHistoryEvent = {
  id: string;
  type: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
