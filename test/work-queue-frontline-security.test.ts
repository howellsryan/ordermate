import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FrontlineWorkQueueResponse, WorkQueueResponse } from "../src/shared/work-queue";
import type { TenantStore } from "../src/worker/tenant-store-xero";

type Stub = DurableObjectStub<TenantStore>;

type Role = "owner" | "admin" | "manager" | "inventory" | "fulfilment" | "viewer";

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`frontline-security-${crypto.randomUUID()}`);
}

function actorHeaders(role: Role, id: string, name: string, json = false) {
  const headers = new Headers({
    "x-ordermate-actor-id": id,
    "x-ordermate-actor-role": role,
    "x-ordermate-actor-name": name,
  });
  if (json) headers.set("content-type", "application/json");
  return headers;
}

async function request<T>(stub: Stub, path: string, role: Role, id: string, name: string, method = "GET", body?: unknown) {
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers: actorHeaders(role, id, name, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>().catch(() => null as T);
  return { response, data };
}

async function seedIntegrationException(stub: Stub) {
  const timestamp = new Date().toISOString();
  const connectionId = crypto.randomUUID();
  const exceptionId = crypto.randomUUID();
  await request(stub, "/work-queue", "manager", "manager-1", "Manager One");
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO integration_connections (
         id, provider, external_account_id, display_name, status, capabilities_json, created_at, updated_at
       ) VALUES (?, 'shopify', 'frontline-security.myshopify.com', 'Frontline Security Store', 'active', '[]', ?, ?)`,
      connectionId,
      timestamp,
      timestamp,
    );
    state.storage.sql.exec(
      `INSERT INTO integration_exceptions (
         id, connection_id, event_id, code, message, retryable, status, entity_type, external_id, created_at
       ) VALUES (?, ?, NULL, 'unmapped_variant', 'Manager-only Shopify mapping review', 1, 'open', 'variant', 'gid://shopify/ProductVariant/999', ?)`,
      exceptionId,
      connectionId,
      timestamp,
    );
  });
  const refreshed = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "manager", "manager-1", "Manager One", "POST");
  expect(refreshed.response.status).toBe(200);
  const item = refreshed.data.items.find(candidate => candidate.category === "integration_exception");
  expect(item).toBeTruthy();
  return item!;
}

describe("frontline work queue API isolation", () => {
  it("does not expose or mutate cross-domain work through legacy queue routes", async () => {
    const stub = tenant();
    const integrationItem = await seedIntegrationException(stub);

    const refresh = await request<{ ok: boolean; items?: unknown[] }>(stub, "/work-queue/refresh", "fulfilment", "fulfilment-1", "Fulfilment One", "POST");
    expect(refresh.response.status).toBe(200);
    expect(refresh.data).toEqual({ ok: true });
    expect(refresh.data.items).toBeUndefined();

    const legacyList = await request<{ error: string }>(stub, "/work-queue", "fulfilment", "fulfilment-1", "Fulfilment One");
    expect(legacyList.response.status).toBe(403);

    const frontline = await request<FrontlineWorkQueueResponse>(stub, "/work-queue/frontline", "fulfilment", "fulfilment-1", "Fulfilment One");
    expect(frontline.response.status).toBe(200);
    expect(frontline.data.items.some(item => item.category === "integration_exception")).toBe(false);

    const history = await request<{ error: string }>(stub, `/work-queue/${integrationItem.id}/history`, "fulfilment", "fulfilment-1", "Fulfilment One");
    expect(history.response.status).toBe(403);

    const acknowledge = await request<{ error: string }>(stub, `/work-queue/${integrationItem.id}/acknowledge`, "fulfilment", "fulfilment-1", "Fulfilment One", "POST");
    expect(acknowledge.response.status).toBe(403);
  });

  it("prevents frontline assignment spoofing while preserving self/team ownership", async () => {
    const stub = tenant();
    await request(stub, "/work-queue", "manager", "manager-1", "Manager One");
    const itemId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO work_items (
           id, source, fingerprint, category, severity, title, detail, next_action, page, score,
           evidence_json, entity_type, entity_id, status, active_signal, first_seen_at, last_seen_at, created_at, updated_at
         ) VALUES (?, 'flow_plan', ?, 'customer_promise', 'warning', 'Urgent order', 'Customer promise needs attention',
           'Review the order', 'orders', 90, '[]', 'order', 'order-1', 'open', 1, ?, ?, ?, ?)`,
        itemId,
        `frontline-security:${itemId}`,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
      );
    });

    const spoof = await request<{ error: string }>(stub, `/work-queue/${itemId}/assign`, "fulfilment", "fulfilment-1", "Fulfilment One", "POST", {
      assigneeId: "other-user",
      assigneeName: "Other User",
      teamId: "dispatch",
      teamName: "Dispatch",
    });
    expect(spoof.response.status).toBe(403);

    const self = await request<{ item: { assigneeId: string | null; assigneeName: string | null; teamId?: string | null; teamName?: string | null } }>(stub, `/work-queue/${itemId}/assign`, "fulfilment", "fulfilment-1", "Fulfilment One", "POST", {
      assigneeId: "fulfilment-1",
      assigneeName: "Fulfilment One",
      teamId: "dispatch",
      teamName: "Dispatch",
    });
    expect(self.response.status).toBe(200);
    expect(self.data.item).toMatchObject({
      assigneeId: "fulfilment-1",
      assigneeName: "Fulfilment One",
      teamId: "dispatch",
      teamName: "Dispatch",
    });

    const managerReassign = await request<{ item: { assigneeId: string | null; assigneeName: string | null } }>(stub, `/work-queue/${itemId}/assign`, "manager", "manager-1", "Manager One", "POST", {
      assigneeId: "other-user",
      assigneeName: "Other User",
      teamId: "dispatch",
      teamName: "Dispatch",
    });
    expect(managerReassign.response.status).toBe(200);
    expect(managerReassign.data.item).toMatchObject({ assigneeId: "other-user", assigneeName: "Other User" });
  });
});
