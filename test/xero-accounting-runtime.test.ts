import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-xero";

type Stub = DurableObjectStub<TenantStore>;

const ownerHeaders = {
  "x-ordermate-actor-id": "owner-1",
  "x-ordermate-actor-role": "owner",
  "x-ordermate-actor-name": "Owner One",
  "content-type": "application/json",
};

const internalHeaders = {
  ...ownerHeaders,
  "x-operating-layer-internal-integration": "integration-v1",
};

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`xero-accounting-${crypto.randomUUID()}`) as DurableObjectStub<TenantStore>;
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown, internal = false) {
  const response = await stub.fetch(new Request(`https://tenant.test${path}`, {
    method,
    headers: internal ? internalHeaders : ownerHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const data = await response.json<T>();
  return { response, data };
}

async function enableService(stub: Stub) {
  const enabled = await request(stub, "/modules/service", "PATCH", { enabled: true });
  expect(enabled.response.ok).toBe(true);
  const profile = await request(stub, "/business-profile", "PATCH", {
    address: { line1: "12 Market Street", city: "Nottingham", postcode: "NG1 2AB", country: "GB" },
    email: "accounts@example.test",
    phone: "0115 555 0199",
    vatNumber: "GB123456789",
  });
  expect(profile.response.ok).toBe(true);
}

async function createDraftInvoice(stub: Stub) {
  const contact = await request<{ id: string }>(stub, "/crm/contacts", "POST", {
    lifecycleStage: "prospect",
    name: "Morgan Hughes",
    email: "morgan@example.test",
    mobile: "07700900222",
    address: { line1: "8 Trent Lane", city: "Nottingham", postcode: "NG2 4DS", country: "GB" },
  });
  expect(contact.response.status).toBe(201);

  const serviceRequest = await request<{ caseId: string }>(stub, "/service/requests", "POST", {
    contactId: contact.data.id,
    title: "Service call",
    details: "Investigate and resolve the reported issue.",
    siteAddress: { line1: "8 Trent Lane", city: "Nottingham", postcode: "NG2 4DS", country: "GB" },
  });
  expect(serviceRequest.response.status).toBe(201);

  const invoice = await request<{ invoiceId: string }>(stub, "/service/invoices", "POST", {
    caseId: serviceRequest.data.caseId,
    supplyDate: "2026-09-30",
    dueDate: "2026-10-14",
    lines: [{
      lineType: "service",
      description: "Service call and labour",
      quantityMilli: 1000,
      unitPriceMinor: 10000,
      taxRateBps: 2000,
    }],
  });
  expect(invoice.response.status).toBe(201);
  return invoice.data.invoiceId;
}

async function connectXero(stub: Stub) {
  const connectionId = crypto.randomUUID();
  const response = await request(stub, "/__integrations/connections/upsert", "POST", {
    id: connectionId,
    provider: "xero",
    externalAccountId: "xero-tenant-1",
    displayName: "Demo Company",
    status: "active",
    capabilities: ["contacts:export", "sales:export"],
    credential: {
      envelope: {
        version: 1,
        algorithm: "A256GCM",
        keyVersion: "v1",
        iv: "aXY=",
        ciphertext: "Y2lwaGVydGV4dA==",
      },
      scopes: ["offline_access", "accounting.contacts", "accounting.invoices", "accounting.settings.read"],
      accessTokenExpiresAt: "2027-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2027-03-01T00:00:00.000Z",
    },
  }, true);
  expect(response.response.status).toBe(200);
  return connectionId;
}

describe("Xero accounting runtime", () => {
  it("keeps the canonical invoice issued when Xero setup is incomplete and surfaces the failed sync", async () => {
    const stub = tenant();
    await enableService(stub);
    const invoiceId = await createDraftInvoice(stub);
    const connectionId = await connectXero(stub);

    const issued = await request<{ ok: boolean }>(stub, `/service/invoices/${invoiceId}/issue`, "POST", {});
    expect(issued.response.ok).toBe(true);
    expect(issued.data.ok).toBe(true);

    const sync = await request<{ error: string }>(stub, `/integrations/${connectionId}/xero/accounting/invoices/${invoiceId}/sync`, "POST", {});
    expect(sync.response.status).toBe(409);
    expect(sync.data.error).toMatch(/sales account/i);

    const invoices = await request<{ invoices: Array<{ id: string; status: string }> }>(stub, "/service/invoices");
    expect(invoices.data.invoices.find(invoice => invoice.id === invoiceId)?.status).toBe("issued");

    const exceptions = await request<{ exceptions: Array<{ code: string; entityType: string | null; externalId: string | null; status: string }> }>(
      stub,
      `/integrations/${connectionId}/exceptions`,
    );
    expect(exceptions.data.exceptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "xero_accounting_sync_failed",
        entityType: "service_invoice",
        externalId: invoiceId,
        status: "open",
      }),
    ]));
  });
});
