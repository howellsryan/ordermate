import type { DashboardSummary, SessionPayload } from "../shared/types";
import type { AttentionResponse, InventoryRow, Product, ReplenishmentResponse } from "./model";
import { demoOpsApi } from "./demo-attention";
import { demoControlApi, demoTenantApi } from "./demo-acceptance";
import { demoCsv } from "./demo-export";
import { demoSession, isDemoMode, isDemoTenant } from "./demo-store";

export async function errorFrom(response: Response) {
  const payload: unknown = await response.json().catch(() => ({ error: response.statusText }));
  const message = payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : `Request failed (${response.status})`;
  return new Error(message);
}

export async function getSession(): Promise<SessionPayload | null> {
  if (isDemoMode()) return demoSession();

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
  if (isDemoMode()) {
    const method = (init?.method || "GET").toUpperCase();
    const pathname = new URL(path, "https://demo.local").pathname;
    if (method === "GET" && pathname === "/delivery-documents/sources") return { sources: [], truncated: false } as T;
    if (method === "GET" && pathname === "/delivery-documents/proposals") return { proposals: [], truncated: false } as T;
    if (method === "GET" && pathname === "/delivery-documents/proposal") return demoControlApi<T>(path, init);
    if (pathname.startsWith("/delivery-documents")) throw new Error("Delivery-document upload and AI extraction are disabled in the local guest demo because files never leave this browser.");
    return demoControlApi<T>(path, init);
  }

  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

async function activeDemoVariantIds() {
  const products = await demoTenantApi<Product[]>("/products");
  return new Set(products.filter(product => product.status === "active").flatMap(product => product.variants.filter(variant => variant.active !== 0).map(variant => variant.id)));
}

export async function tenantApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  if (isDemoTenant(tenantId)) {
    const result = await demoTenantApi<unknown>(path, init);
    const method = (init?.method || "GET").toUpperCase();
    const pathname = new URL(path, "https://demo.local").pathname;
    if (method === "POST" && pathname === "/inventory/stocktake" && typeof init?.body === "string") {
      let lines: Array<{ expectedOnHand?: number; countedOnHand?: number }> = [];
      try {
        const parsed = JSON.parse(init.body) as { lines?: Array<{ expectedOnHand?: number; countedOnHand?: number }> };
        if (Array.isArray(parsed.lines)) lines = parsed.lines;
      } catch {
        // The demo store already validates the request. This fallback only adapts the response shape.
      }
      const totalVariance = lines.reduce((sum, line) => sum + ((Number(line.countedOnHand) || 0) - (Number(line.expectedOnHand) || 0)), 0);
      const changedLines = lines.filter(line => (Number(line.countedOnHand) || 0) !== (Number(line.expectedOnHand) || 0)).length;
      return {
        ok: true,
        stocktakeId: crypto.randomUUID(),
        countedLines: lines.length,
        changedLines,
        totalVariance,
      } as T;
    }
    if (method === "GET" && pathname === "/replenishment") {
      const activeVariants = await activeDemoVariantIds();
      const data = result as ReplenishmentResponse;
      return { ...data, suggestions: data.suggestions.filter(item => activeVariants.has(item.variant_id)) } as T;
    }
    if (method === "GET" && pathname === "/dashboard") {
      const activeVariants = await activeDemoVariantIds();
      const inventory = await demoTenantApi<InventoryRow[]>("/inventory");
      const settings = await demoTenantApi<{ low_stock_threshold: number }>("/settings");
      const data = result as DashboardSummary;
      return {
        ...data,
        lowStockVariants: inventory.filter(row => activeVariants.has(row.variant_id) && row.tracked !== 0 && row.available <= settings.low_stock_threshold).length,
      } as T;
    }
    return result as T;
  }

  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/tenant${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function tenantOpsApi<T>(tenantId: string, path: string, init?: RequestInit): Promise<T> {
  if (isDemoTenant(tenantId)) {
    const result = await demoOpsApi<unknown>(path);
    const pathname = new URL(path, "https://demo.local").pathname;
    if (pathname === "/attention") {
      const activeVariants = await activeDemoVariantIds();
      const data = result as AttentionResponse;
      const items = data.items.filter(item => {
        if (item.type !== "Low stock") return true;
        const [, variantId] = item.id.split(":");
        return activeVariants.has(variantId || "");
      });
      return { total: items.length, items } as T;
    }
    return result as T;
  }

  const headers = new Headers(init?.headers);
  headers.set("x-ordermate-tenant", tenantId);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`/api/ops${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function downloadTenantCsv(tenantId: string, kind: string) {
  if (isDemoTenant(tenantId)) {
    const demo = demoCsv(kind);
    const url = URL.createObjectURL(new Blob([demo.content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = demo.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const response = await fetch(`/api/ops/export/${encodeURIComponent(kind)}`, {
    credentials: "include",
    headers: { "x-ordermate-tenant": tenantId },
  });
  if (!response.ok) throw await errorFrom(response);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `operating-layer-${kind}.csv`;
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
