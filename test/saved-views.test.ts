import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { SavedView } from "../src/shared/saved-views";
import type { TenantStore } from "../src/worker/tenant-store-saved-views";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`saved-views-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, actorId: string, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": actorId,
    "x-ordermate-actor-role": "owner",
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

describe("saved operational views", () => {
  it("persists a validated inventory view and returns it only to the owning actor", async () => {
    const stub = tenant();
    const created = await request<SavedView>(stub, "user-a", "/saved-views", "POST", {
      page: "inventory",
      name: "Low stock · Derby",
      config: { query: "shirt", locationId: "loc-derby", stock: "low" },
    });
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({
      owner_actor_id: "user-a",
      page: "inventory",
      name: "Low stock · Derby",
      config: { query: "shirt", locationId: "loc-derby", stock: "low" },
    });

    const ownerViews = await request<SavedView[]>(stub, "user-a", "/saved-views?page=inventory");
    expect(ownerViews.data).toHaveLength(1);
    expect(ownerViews.data[0].id).toBe(created.data.id);

    const colleagueViews = await request<SavedView[]>(stub, "user-b", "/saved-views?page=inventory");
    expect(colleagueViews.data).toEqual([]);
  });

  it("rejects invalid configs and case-insensitive duplicate names", async () => {
    const stub = tenant();
    const invalid = await request<{ error: string }>(stub, "user-a", "/saved-views", "POST", {
      page: "inventory",
      name: "Broken",
      config: { query: "", locationId: null, stock: "anything" },
    });
    expect(invalid.response.status).toBe(400);

    const first = await request<SavedView>(stub, "user-a", "/saved-views", "POST", {
      page: "purchasing",
      name: "Overdue",
      config: { query: "", supplierId: null, status: "all", due: "overdue" },
    });
    expect(first.response.status).toBe(201);

    const duplicate = await request<{ error: string }>(stub, "user-a", "/saved-views", "POST", {
      page: "purchasing",
      name: "overdue",
      config: { query: "supplier", supplierId: null, status: "ordered", due: "all" },
    });
    expect(duplicate.response.status).toBe(409);
  });

  it("does not allow one actor to delete another actor's saved view", async () => {
    const stub = tenant();
    const created = await request<SavedView>(stub, "user-a", "/saved-views", "POST", {
      page: "purchasing",
      name: "Due next week",
      config: { query: "", supplierId: null, status: "all", due: "due_7_days" },
    });
    expect(created.response.status).toBe(201);

    const guessedDelete = await request<{ error: string }>(stub, "user-b", `/saved-views/${created.data.id}`, "DELETE");
    expect(guessedDelete.response.status).toBe(404);

    const ownerDelete = await request<{ ok: true }>(stub, "user-a", `/saved-views/${created.data.id}`, "DELETE");
    expect(ownerDelete.response.ok).toBe(true);

    const views = await request<SavedView[]>(stub, "user-a", "/saved-views?page=purchasing");
    expect(views.data).toEqual([]);
  });
});
