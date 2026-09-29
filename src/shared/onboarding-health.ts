export type OnboardingStepKey = "business" | "locations" | "catalogue" | "inventory" | "integration" | "first_value";
export type OnboardingStepStatus = "complete" | "ready" | "blocked" | "optional";

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  detail: string;
  status: OnboardingStepStatus;
  actionLabel: string | null;
  page: "settings" | "inventory" | "products" | "orders" | "purchasing" | "overview";
  evidence: string[];
};

export type MigrationHealth = {
  connections: number;
  healthyConnections: number;
  mappingsApproved: number;
  mappingsNeedingReview: number;
  openIntegrationExceptions: number;
  outboundPending: number;
  outboundRetrying: number;
  outboundFailed: number;
  reconciliationDrift: number;
  pendingReturnDispositions: number;
  lastIntegrationSuccessAt: string | null;
  blockers: string[];
};

export type OnboardingHealth = {
  generatedAt: string;
  progressPercent: number;
  readyForFirstValue: boolean;
  firstValueAt: string | null;
  timeToFirstValueMinutes: number | null;
  nextStep: OnboardingStep | null;
  steps: OnboardingStep[];
  migration: MigrationHealth;
};
