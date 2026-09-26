import type { SessionPayload } from "../shared/types";

export async function errorFrom(response: Response) {
  const payload: unknown = await response.json().catch(() => ({ error: response.statusText }));
  const message = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : `Request failed (${response.status})`;
  return new Error(message);
}

export async function getSession(): Promise<SessionPayload | null> {
  // Better Auth deliberately returns 200 + null for an anonymous visitor. Probe
  // that lightweight endpoint first so the public landing page does not create
  // an expected 401 network error before we ask for the richer Operating Layer session.
  const authResponse = await fetch("/api/auth/get-session", { credentials: "include" });
  if (!authResponse.ok) throw await errorFrom(authResponse);
  const authSession: unknown = await authResponse.json();
  if (!authSession) return null;

  const response = await fetch("/api/session", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function createOrganization(name: string) {
  return controlApi("/organizations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function controlApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function tenantApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/tenant${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function tenantOpsApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/ops${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function downloadTenantCsv(tenantId: string, kind: string) {
  const response = await fetch(`/api/ops/export/${encodeURIComponent(kind)}`, {
    credentials: "include",
    headers: { "x-ordermate-tenant": tenantId },
  });
  if (!response.ok) throw await errorFrom(response);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `ordermate-${kind}.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function money(minor: number | null | undefined, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format((minor ?? 0) / 100);
}

export function date(value: string | number | null | undefined) {
  if (!value) return "—";
  const parsed = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function calendarDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

export function todayUtcIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdueDate(value: string | null | undefined) {
  return !!value && value < todayUtcIsoDate();
}
