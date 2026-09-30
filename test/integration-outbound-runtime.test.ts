import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationOutboundRuntime } from "../src/worker/integration-outbound-runtime";

type Job = {
  id: string; connection_id: string; operation: string; entity_type: string; entity_id: string;
  desired_json: string; status: string; attempts: number; generation: number;
  lease_token: string | null; lease_expires_at: string | null; last_error: string | null;
};
type Input = { connectionId: string; operation: string; coalescingKey: string; entityType: string; entityId: string; desired: unknown };
type Connection = { id: string; provider: string; external_account_id: string; status: string };
type Harness = {
  upsertJob(input: Input): void;
  processJob(job: Job): Promise<{ providerRequestId: string | null }>;
  processInventory(job: Job, connection: Connection): Promise<unknown>;
  usableShopify(connection: Connection): Promise<{ accessToken: string; apiVersion: string }>;
  shopifyGraphql(connection: Connection, query: string, variables: Record<string, unknown>, unsafeCreate?: boolean): Promise<unknown>;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture(run: (runtime: IntegrationOutboundRuntime, harness: Harness, storage: DurableObjectState["storage"], connection: Connection, setAlarm: ReturnType<typeof vi.fn>) => Promise<void>) {
  const stub = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
  await stub.fetch(new Request("https://tenant.test/integrations"));
  await runInDurableObject(stub, async (_instance, state) => {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    state.storage.sql.exec(
      "INSERT INTO integration_connections (id, provider, external_account_id, display_name, status, capabilities_json, created_at, updated_at) VALUES (?, 'shopify', 'example.myshopify.com', 'Example', 'active', '[]', ?, ?)",
      id, timestamp, timestamp,
    );
    // Real tenant SQLite with alarm I/O controlled so tests never publish externally.
    const setAlarm = vi.fn(async (_time: number) => {});
    const storage = {
      sql: state.storage.sql,
      transactionSync: state.storage.transactionSync.bind(state.storage),
      getAlarm: async () => null,
      setAlarm,
    };
    const runtime = new IntegrationOutboundRuntime(
      { storage } as unknown as DurableObjectState,
      {},
      async () => Response.json({ ok: true }),
    );
    await run(runtime, runtime as unknown as Harness, state.storage,
      { id, provider: "shopify", external_account_id: "example.myshopify.com", status: "active" }, setAlarm);
  });
}

function enqueue(harness: Harness, connection: Connection, available = 10, operation = "inventory_publish") {
  harness.upsertJob({
    connectionId: connection.id, operation, coalescingKey: "test:position", entityType: operation === "fulfilment_publish" ? "fulfilment" : "inventory_level",
    entityId: "position-1",
    desired: operation === "fulfilment_publish"
      ? { localFulfilmentId: "position-1", localOrderId: "order-1", externalOrderId: "gid://shopify/Order/1" }
      : { localVariantId: "variant-1", localLocationId: "location-1", externalVariantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1", externalLocationId: "gid://shopify/Location/1", available },
  });
}

function job(storage: DurableObjectState["storage"]) {
  return storage.sql.exec<Job>("SELECT * FROM integration_outbound_jobs LIMIT 1").toArray()[0];
}

describe("outbound publishing concurrency and recovery", () => {
  it.each(["success", "failure"])("retains a newer stock generation after an older %s", async outcome => {
    await fixture(async (runtime, harness, storage, connection, setAlarm) => {
      enqueue(harness, connection, 10);
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { started = resolve; });
      const publish = vi.spyOn(harness, "processJob").mockImplementationOnce(async () => {
        started();
        await gate;
        if (outcome === "failure") throw new Error("Old request failed");
        return { providerRequestId: "published-10" };
      }).mockResolvedValue({ providerRequestId: "published-7" });
      const draining = runtime.processDue();
      await ready;
      expect(job(storage).lease_token).toBeTruthy();
      expect(setAlarm).toHaveBeenCalled();
      enqueue(harness, connection, 7);
      expect(job(storage).status).toBe("running");
      release();
      await draining;
      expect(job(storage)).toMatchObject({ status: "pending", generation: 2, attempts: 0, last_error: null, lease_token: null });
      expect(JSON.parse(job(storage).desired_json).available).toBe(7);
      await runtime.processDue();
      expect(publish).toHaveBeenCalledTimes(2);
      expect(job(storage).status).toBe("succeeded");
    });
  });

  it("serializes a manual drain with a concurrent alarm", async () => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection);
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const ready = new Promise<void>(resolve => { started = resolve; });
      const publish = vi.spyOn(harness, "processJob").mockImplementation(async () => {
        started(); await gate; return { providerRequestId: null };
      });
      const manual = runtime.processDue(connection.id);
      await ready;
      const alarm = runtime.alarm();
      release();
      await Promise.all([manual, alarm]);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(job(storage).status).toBe("succeeded");
    });
  });

  it.each([null, "2020-01-01T00:00:00.000Z"])("recovers an interrupted inventory claim with expiry %s", async expiry => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection);
      storage.sql.exec("UPDATE integration_outbound_jobs SET status = 'running', lease_token = 'lost', lease_expires_at = ?", expiry);
      const publish = vi.spyOn(harness, "processJob").mockResolvedValue({ providerRequestId: null });
      await runtime.processDue();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(job(storage)).toMatchObject({ status: "succeeded", lease_token: null, lease_expires_at: null });
    });
  });

  it("does not reclaim a live lease", async () => {
    await fixture(async (runtime, harness, storage, connection, setAlarm) => {
      enqueue(harness, connection);
      const expiry = new Date(Date.now() + 60_000).toISOString();
      storage.sql.exec("UPDATE integration_outbound_jobs SET status = 'running', lease_token = 'live', lease_expires_at = ?", expiry);
      const publish = vi.spyOn(harness, "processJob");
      await runtime.processDue();
      expect(publish).not.toHaveBeenCalled();
      expect(job(storage).status).toBe("running");
      expect(setAlarm).toHaveBeenCalled();
    });
  });

  it("turns an interrupted unlinked fulfilment into a non-retryable exception", async () => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection, 2, "fulfilment_publish");
      storage.sql.exec("UPDATE integration_outbound_jobs SET status = 'running', lease_token = 'lost', lease_expires_at = NULL");
      const publish = vi.spyOn(harness, "processJob");
      await runtime.processDue();
      expect(publish).not.toHaveBeenCalled();
      expect(job(storage).status).toBe("failed");
      expect(storage.sql.exec("SELECT retryable, status FROM integration_exceptions").toArray()[0]).toMatchObject({ retryable: 0, status: "open" });
      enqueue(harness, connection, 2, "fulfilment_publish");
      await runtime.processDue();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  it("can reconcile an interrupted fulfilment that already has a durable external identity", async () => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection, 2, "fulfilment_publish");
      storage.sql.exec("UPDATE integration_outbound_jobs SET status = 'running', lease_token = 'lost'");
      storage.sql.exec(
        "INSERT INTO integration_fulfilment_links (connection_id, local_fulfilment_id, external_fulfilment_id, external_order_id, updated_at) VALUES (?, 'position-1', 'external-1', 'order-1', ?)",
        connection.id, new Date().toISOString(),
      );
      // The real processFulfilment checks the link before reading its desired order payload.
      await runtime.processDue();
      expect(job(storage)).toMatchObject({ status: "succeeded" });
    });
  });

  it("leaves other tenant jobs untouched", async () => {
    const other = env.TENANT_STORES.get(env.TENANT_STORES.newUniqueId());
    await other.fetch(new Request("https://tenant.test/integrations"));
    await fixture(async (runtime, harness, _storage, connection) => {
      enqueue(harness, connection);
      vi.spyOn(harness, "processJob").mockResolvedValue({ providerRequestId: null });
      await runtime.processDue();
    });
    await runInDurableObject(other, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM integration_outbound_jobs").toArray()).toEqual([]);
      expect(state.storage.sql.exec("SELECT * FROM integration_exceptions").toArray()).toEqual([]);
    });
  });
});

describe("Shopify outbound request safety", () => {
  it("changes inventory keys for new desired values and CAS payloads, retaining identical retry keys", async () => {
    await fixture(async (_runtime, harness, storage, connection) => {
      vi.spyOn(harness, "usableShopify").mockResolvedValue({ accessToken: "test", apiVersion: "2026-07" });
      const keys: string[] = [];
      let observed = 10;
      vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        if (body.query.includes("InventoryObserved")) return Response.json({ data: { inventoryItem: { inventoryLevel: { quantities: [{ name: "available", quantity: observed }] } } } });
        keys.push(body.variables.idempotencyKey);
        return Response.json({ data: { inventorySetQuantities: { userErrors: [], inventoryAdjustmentGroup: { changes: [{ name: "available", quantityAfterChange: body.variables.input.quantities[0].quantity }] } } } });
      }));
      enqueue(harness, connection, 7);
      await harness.processInventory(job(storage), connection);
      await harness.processInventory(job(storage), connection);
      enqueue(harness, connection, 5);
      await harness.processInventory(job(storage), connection);
      observed = 11;
      await harness.processInventory(job(storage), connection);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[2]).not.toBe(keys[1]);
      expect(keys[3]).not.toBe(keys[2]);
    });
  });

  it.each(["network", "decode"])("does not replay an uncertain fulfilment after a %s failure", async failure => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection, 2, "fulfilment_publish");
      vi.spyOn(harness, "usableShopify").mockResolvedValue({ accessToken: "test", apiVersion: "2026-07" });
      const transport = vi.fn(async () => {
        if (failure === "network") throw new TypeError("Response lost after Shopify accepted");
        return new Response("{invalid");
      });
      vi.stubGlobal("fetch", transport);
      vi.spyOn(harness, "processJob").mockImplementation(async () => {
        await harness.shopifyGraphql(connection, "mutation fulfillmentCreate", {}, true);
        return { providerRequestId: "unreachable" };
      });
      await runtime.processDue();
      await runtime.processDue();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(job(storage).status).toBe("failed");
      expect(storage.sql.exec("SELECT retryable FROM integration_exceptions").toArray()[0]).toMatchObject({ retryable: 0 });
    });
  });

  it("retries a known throttle rejection rather than treating it as an uncertain create", async () => {
    await fixture(async (runtime, harness, storage, connection) => {
      enqueue(harness, connection, 2, "fulfilment_publish");
      vi.spyOn(harness, "usableShopify").mockResolvedValue({ accessToken: "test", apiVersion: "2026-07" });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "5" } })));
      vi.spyOn(harness, "processJob").mockImplementation(async () => {
        await harness.shopifyGraphql(connection, "mutation fulfillmentCreate", {}, true);
        return { providerRequestId: null };
      });
      await runtime.processDue();
      expect(job(storage).status).toBe("retry_wait");
      expect(storage.sql.exec("SELECT * FROM integration_exceptions").toArray()).toEqual([]);
    });
  });
});
