import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";
import { can, permissionForRequest } from "../src/worker/permissions";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`order-plan-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "planner-user",
    "x-ordermate-actor-role": "manager",
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

async function createDraftOrder(stub: Stub) {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Dispatch", code: `D${crypto.randomUUID().slice(0, 5)}` });
  expect(location.response.status).toBe(201);
  const sku = `PLAN-${crypto.randomUUID().slice(0, 8)}`;
  const product = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Planning product",
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
  return order.data.id;
}

describe("order planning metadata", () => {
  it("defaults new orders to normal priority, persists reviewed urgency and audits the change", async () => {
    const stub = tenant();
    const orderId = await createDraftOrder(stub);

    const initial = await request<{ priority: string; required_by_date: string | null }>(stub, `/orders/${orderId}`);
    expect(initial.data.priority).toBe("normal");
    expect(initial.data.required_by_date).toBeNull();

    const updated = await request<{ ok: true; requiredByDate: string; priority: string }>(stub, `/orders/${orderId}/planning`, "PATCH", {
      requiredByDate: "2026-10-15",
      priority: "urgent",
    });
    expect(updated.response.ok).toBe(true);
    expect(updated.data).toMatchObject({ requiredByDate: "2026-10-15", priority: "urgent" });

    const detail = await request<{ priority: string; required_by_date: string | null }>(stub, `/orders/${orderId}`);
    expect(detail.data).toMatchObject({ priority: "urgent", required_by_date: "2026-10-15" });

    await runInDurableObject(stub, async (_instance, state) => {
      const audit = state.storage.sql.exec<{ action: string; entity_id: string; metadata_json: string }>(
        "SELECT action, entity_id, metadata_json FROM audit_events WHERE action = 'order.planning_updated' ORDER BY created_at DESC LIMIT 1",
      ).toArray()[0];
      expect(audit.action).toBe("order.planning_updated");
      expect(audit.entity_id).toBe(orderId);
      expect(JSON.parse(audit.metadata_json)).toMatchObject({ previousPriority: "normal", priority: "urgent", requiredByDate: "2026-10-15" });
    });
  });

  it("rejects impossible calendar dates and planning changes after cancellation", async () => {
    const stub = tenant();
    const orderId = await createDraftOrder(stub);

    const invalid = await request<{ error: string }>(stub, `/orders/${orderId}/planning`, "PATCH", {
      requiredByDate: "2026-02-30",
      priority: "high",
    });
    expect(invalid.response.status).toBe(400);

    const cancelled = await request(stub, `/orders/${orderId}/cancel`, "POST", {});
    expect(cancelled.response.ok).toBe(true);

    const closed = await request<{ error: string }>(stub, `/orders/${orderId}/planning`, "PATCH", {
      requiredByDate: null,
      priority: "low",
    });
    expect(closed.response.status).toBe(409);
  });
});

describe("order planning authorization", () => {
  it("separates promise/priority edits from warehouse lifecycle permissions", () => {
    const permission = permissionForRequest("/orders/order-1/planning", "PATCH");
    expect(permission).toEqual({ resource: "order_planning", action: "update" });
    expect(can("owner", permission.resource, permission.action)).toBe(true);
    expect(can("admin", permission.resource, permission.action)).toBe(true);
    expect(can("manager", permission.resource, permission.action)).toBe(true);
    expect(can("fulfilment", permission.resource, permission.action)).toBe(false);
    expect(can("inventory", permission.resource, permission.action)).toBe(false);
    expect(can("viewer", permission.resource, permission.action)).toBe(false);
    expect(can("fulfilment", "orders", "update")).toBe(true);
  });
});
