import type { SessionPayload } from "../shared/types";

async function errorFrom(response: Response) {
  const payload = await response.json().catch(() => ({ error: response.statusText }));
  return new Error(payload.error || `Request failed (${response.status})`);
}

export async function getSession(): Promise<SessionPayload | null> {
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
