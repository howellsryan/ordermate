import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WorkQueueResponse } from "../src/shared/work-queue";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`work-queue-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "manager-user",
    "x-ordermate-actor-role": "manager",
    "x-ordermate-actor-name": "Morgan Manager",
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>();
  return { response, data };
}

async function createUrgentOrder(stub: Stub) {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Dispatch", code: `WQ${crypto.randomUUID().slice(0, 4)}` });
  expect(location.response.status).toBe(201);
  const sku = `WQ-${crypto.randomUUID().slice(0, 8)}`;
  const product = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Queue product",
    variants: [{ name: "Default", sku, priceMinor: 1500, costMinor: 600, taxRateBps: 2000, options: {} }],
  });
  expect(product.response.status).toBe(201);
  const products = await request<Array<{ variants: Array<{ id: string; sku: string }> }>>(stub, "/products");
  const variantId = products.data.flatMap(item => item.variants).find(item => item.sku === sku)!.id;
  const order = await request<{ id: string }>(stub, "/orders", "POST", {
    locationId: location.data.id,
    lines: [{ variantId, quantity: 1, modifiers: [] }],
  });
  expect(order.response.status).toBe(201);
  await request(stub, `/orders/${order.data.id}/planning`, "PATCH", { requiredByDate: null, priority: "urgent" });
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec("UPDATE orders SET status = 'confirmed', fulfilment_status = 'unfulfilled' WHERE id = ?", order.data.id);
  });
  return order.data.id;
}

function customerPromise(queue: WorkQueueResponse, orderId: string) {
  return queue.items.find(item => item.category === "customer_promise" && item.entityId === orderId);
}

describe("persistent operations work queue", () => {
  it("keeps stable identity through assignment, automatic clear and recurrence", async () => {
    const stub = tenant();
    const orderId = await createUrgentOrder(stub);

    const first = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    expect(first.response.ok).toBe(true);
    const initial = customerPromise(first.data, orderId);
    expect(initial).toBeTruthy();
    expect(initial).toMatchObject({ status: "open", activeSignal: true, assigneeId: null });

    const second = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    expect(customerPromise(second.data, orderId)?.id).toBe(initial!.id);

    const assigned = await request<{ item: { assigneeId: string; assigneeName: string } }>(stub, `/work-queue/${initial!.id}/assign-to-me`, "POST");
    expect(assigned.data.item).toMatchObject({ assigneeId: "manager-user", assigneeName: "Morgan Manager" });
    const acknowledged = await request<{ item: { status: string } }>(stub, `/work-queue/${initial!.id}/acknowledge`, "POST");
    expect(acknowledged.data.item.status).toBe("acknowledged");

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE orders SET status = 'completed' WHERE id = ?", orderId);
    });
    const cleared = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    expect(customerPromise(cleared.data, orderId)).toBeUndefined();

    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql.exec<{ id: string; status: string; active_signal: number; resolution_reason: string }>(
        "SELECT id, status, active_signal, resolution_reason FROM work_items WHERE source = 'flow_plan' AND fingerprint = ?",
        `flow:order:${orderId}`,
      ).toArray()[0];
      expect(row).toMatchObject({ id: initial!.id, status: "resolved", active_signal: 0, resolution_reason: "Underlying condition cleared automatically" });
    });

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE orders SET status = 'confirmed', priority = 'urgent', fulfilment_status = 'unfulfilled' WHERE id = ?", orderId);
    });
    const reopened = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    const recurrent = customerPromise(reopened.data, orderId);
    expect(recurrent).toMatchObject({ id: initial!.id, status: "open", activeSignal: true, assigneeId: "manager-user" });

    const history = await request<{ events: Array<{ type: string }> }>(stub, `/work-queue/${initial!.id}/history`);
    const types = history.data.events.map(event => event.type);
    expect(types).toContain("created");
    expect(types).toContain("assigned");
    expect(types).toContain("acknowledged");
    expect(types).toContain("condition_cleared");
    expect(types).toContain("reopened");

    await runInDurableObject(stub, async (_instance, state) => {
      const count = state.storage.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM work_items WHERE source = 'flow_plan' AND fingerprint = ?",
        `flow:order:${orderId}`,
      ).toArray()[0]?.count;
      expect(count).toBe(1);
    });
  });

  it("unifies open Shopify exceptions and auto-clears them when the integration condition resolves", async () => {
    const stub = tenant();
    await request(stub, "/work-queue", "GET"); // initialise tenant/integration/work-queue schemas
    const connectionId = crypto.randomUUID();
    const exceptionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO integration_connections (
           id, provider, external_account_id, display_name, status, capabilities_json, created_at, updated_at
         ) VALUES (?, 'shopify', 'queue-test.myshopify.com', 'Queue Test Store', 'active', '[]', ?, ?)`,
        connectionId,
        timestamp,
        timestamp,
      );
      state.storage.sql.exec(
        `INSERT INTO integration_exceptions (
           id, connection_id, event_id, code, message, retryable, status, entity_type, external_id, created_at
         ) VALUES (?, ?, NULL, 'unmapped_variant', 'Variant needs an approved mapping', 1, 'open', 'variant', 'gid://shopify/ProductVariant/1', ?)`,
        exceptionId,
        connectionId,
        timestamp,
      );
    });

    const active = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    const integrationItem = active.data.items.find(item => item.category === "integration_exception");
    expect(integrationItem).toMatchObject({
      title: "Queue Test Store needs attention",
      page: "settings",
      detail: "Variant needs an approved mapping",
    });

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE integration_exceptions SET status = 'resolved', resolved_at = ? WHERE id = ?", new Date().toISOString(), exceptionId);
    });
    const resolved = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    expect(resolved.data.items.some(item => item.id === integrationItem!.id)).toBe(false);

    await runInDurableObject(stub, async (_instance, state) => {
      const item = state.storage.sql.exec<{ active_signal: number; status: string }>(
        "SELECT active_signal, status FROM work_items WHERE id = ?",
        integrationItem!.id,
      ).toArray()[0];
      expect(item).toMatchObject({ active_signal: 0, status: "resolved" });
    });
  });

  it("treats an intentionally disabled module as absent operational scope rather than a source failure", async () => {
    const stub = tenant();
    const orderId = await createUrgentOrder(stub);
    const active = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    const item = customerPromise(active.data, orderId);
    expect(item).toBeTruthy();

    const disabled = await request<{ modules: Array<{ key: string; enabled: boolean }> }>(stub, "/modules/orders", "PATCH", { enabled: false });
    expect(disabled.response.ok).toBe(true);
    expect(disabled.data.modules.find(module => module.key === "orders")?.enabled).toBe(false);

    const afterDisable = await request<WorkQueueResponse>(stub, "/work-queue/refresh", "POST");
    expect(afterDisable.response.ok).toBe(true);
    expect(customerPromise(afterDisable.data, orderId)).toBeUndefined();

    await runInDurableObject(stub, async (_instance, state) => {
      const persisted = state.storage.sql.exec<{ active_signal: number; status: string }>(
        "SELECT active_signal, status FROM work_items WHERE source = 'flow_plan' AND fingerprint = ?",
        `flow:order:${orderId}`,
      ).toArray()[0];
      expect(persisted).toMatchObject({ active_signal: 0, status: "resolved" });
    });
  });
});
