import type { Order, OrderPriority } from "./model";

const rank: Record<OrderPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function compareOrderUrgency(a: Order, b: Order) {
  const priority = rank[a.priority || "normal"] - rank[b.priority || "normal"];
  if (priority !== 0) return priority;

  const aDue = a.required_by_date || "9999-12-31";
  const bDue = b.required_by_date || "9999-12-31";
  const due = aDue.localeCompare(bDue);
  if (due !== 0) return due;

  return a.created_at.localeCompare(b.created_at);
}

export function isRequiredByOverdue(requiredByDate?: string | null, now = new Date()) {
  if (!requiredByDate) return false;
  return requiredByDate < now.toISOString().slice(0, 10);
}

export function priorityLabel(priority: OrderPriority | undefined) {
  if (!priority || priority === "normal") return "Normal";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}
