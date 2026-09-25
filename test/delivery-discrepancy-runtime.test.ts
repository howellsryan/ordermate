import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { DeliveryDiscrepancyRecord } from "../src/shared/delivery-discrepancy";
import type { TenantStore } from "../src/worker/tenant-store-discrepancies";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`delivery-discrepancy-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "buyer-user",
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

async function setupPo(stub: Stub) {
  const location = await request<{ id: string }>(stub, "/locations", "POST", { name: "Main warehouse", code: `DD${crypto.randomUUID().slice(0, 5)}` });
  const supplier = await request<{ id: string }>(stub, "/suppliers", "POST", { name: "Discrepancy supplier" });
  const product = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Discrepancy widget",
    variants: [{ name: "Default", sku: `DD-${crypto.randomUUID().slice(0, 8)}`, priceMinor: 1200, costMinor: 600, taxRateBps: 2000, options: {} }],
  });
  const products = await request<Array<{ id: string; variants: Array<{ id: string }> }>>(stub, "/products");
  const variantId = products.data.find(item => item.id === product.data.id)!.variants[0].id;
  const po = await request<{ id: string; number: string }>(stub, "/purchase-orders", "POST", {
    supplierId: supplier.data.id,
    locationId: location.data.id,
    lines: [{ variantId, quantity: 10, unitCostMinor: 600, taxRateBps: 2000 }],
  });
  expect(po.response.status).toBe(201);
  return po.data;
}

describe("delivery discrepancy runtime", () => {
  it("creates one idempotent operational record per proposal and resolves it with audit history", async () => {
    const stub = tenant();
    const po = await setupPo(stub);
    const proposalKey = `tenant/delivery-proposal/${crypto.randomUUID()}.json`;
    const createBody = {
      proposalKey,
      proposalEventId: "event-1",
      purchaseOrderId: po.id,
      purchaseOrderNumber: po.number,
      documentReference: "DN-100",
      documentDate: "2026-09-25",
      issues: [
        {
          type: "quantity_variance",
          lineId: "line-1",
          sku: "DD-1",
          description: "Discrepancy widget",
          documentQuantity: 10,
          receivedQuantity: 8,
        },
      ],
    } as const;

    const created = await request<{ id: string; status: string; created: boolean }>(stub, "/internal/delivery-discrepancies", "POST", createBody);
    expect(created.response.status).toBe(201);
    expect(created.data).toMatchObject({ status: "open", created: true });

    const retried = await request<{ id: string; status: string; created: boolean }>(stub, "/internal/delivery-discrepancies", "POST", createBody);
    expect(retried.response.ok).toBe(true);
    expect(retried.data).toEqual({ ok: true, id: created.data.id, status: "open", created: false });

    const listed = await request<DeliveryDiscrepancyRecord[]>(stub, `/delivery-discrepancies?purchaseOrderId=${encodeURIComponent(po.id)}`);
    expect(listed.response.ok).toBe(true);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]).toMatchObject({
      id: created.data.id,
      purchase_order_id: po.id,
      purchase_order_number: po.number,
      status: "open",
      issue_count: 1,
      resolution_code: null,
    });
    expect(JSON.parse(listed.data[0].evidence_json).issues[0]).toMatchObject({ type: "quantity_variance", documentQuantity: 10, receivedQuantity: 8 });

    const resolved = await request<{ ok: true; status: string }>(stub, `/delivery-discrepancies/${created.data.id}`, "PATCH", {
      resolutionCode: "supplier_follow_up",
      resolutionNote: "Supplier confirmed the remaining two units will ship tomorrow.",
    });
    expect(resolved.response.ok).toBe(true);
    expect(resolved.data.status).toBe("resolved");

    const resolvedList = await request<DeliveryDiscrepancyRecord[]>(stub, "/delivery-discrepancies?status=resolved");
    expect(resolvedList.data).toHaveLength(1);
    expect(resolvedList.data[0]).toMatchObject({
      id: created.data.id,
      status: "resolved",
      resolution_code: "supplier_follow_up",
      resolution_note: "Supplier confirmed the remaining two units will ship tomorrow.",
      resolved_by: "buyer-user",
    });

    const duplicateResolve = await request<{ error: string }>(stub, `/delivery-discrepancies/${created.data.id}`, "PATCH", {
      resolutionCode: "accepted_variance",
      resolutionNote: "Trying to resolve twice",
    });
    expect(duplicateResolve.response.status).toBe(409);

    await runInDurableObject(stub, async (_instance, state) => {
      const audit = state.storage.sql.exec<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at",
        created.data.id,
      ).toArray();
      expect(audit.map(row => row.action)).toEqual(["delivery_discrepancy.opened", "delivery_discrepancy.resolved"]);
      const count = state.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM delivery_discrepancies WHERE proposal_key = ?", proposalKey).toArray()[0].count;
      expect(count).toBe(1);
    });
  });

  it("rejects an internal discrepancy whose PO identity does not match the tenant record", async () => {
    const stub = tenant();
    const po = await setupPo(stub);
    const result = await request<{ error: string }>(stub, "/internal/delivery-discrepancies", "POST", {
      proposalKey: "tenant/delivery-proposal/bad.json",
      proposalEventId: "event-bad",
      purchaseOrderId: po.id,
      purchaseOrderNumber: "PO-WRONG",
      documentReference: "DN-X",
      documentDate: "",
      issues: [{ type: "reference_mismatch", documentPurchaseOrderReference: "PO-WRONG", expectedPurchaseOrderNumber: po.number }],
    });
    expect(result.response.status).toBe(409);
  });
});
