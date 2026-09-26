import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`invoice-controls-${crypto.randomUUID()}`);
}

async function request<T>(stub: Stub, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    "x-ordermate-actor-id": "service-owner",
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

async function enableService(stub: Stub) {
  const result = await request(stub, "/modules/service", "PATCH", { enabled: true });
  expect(result.response.ok).toBe(true);
}

async function setInvoiceIdentity(stub: Stub, vatNumber?: string) {
  const result = await request(stub, "/business-profile", "PATCH", {
    address: { line1: "12 Market Street", city: "Nottingham", postcode: "NG1 2AB", country: "GB" },
    email: "accounts@example.test",
    phone: "0115 555 0199",
    vatNumber: vatNumber ?? null,
  });
  expect(result.response.ok).toBe(true);
}

async function draftInvoice(stub: Stub, taxRateBps = 2000) {
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
    supplyDate: "2026-09-26",
    dueDate: "2026-10-10",
    lines: [{
      lineType: "service",
      description: "Service call and labour",
      quantityMilli: 1000,
      unitPriceMinor: 10000,
      taxRateBps,
    }],
  });
  expect(invoice.response.status).toBe(201);
  return { contactId: contact.data.id, invoiceId: invoice.data.invoiceId };
}

describe("service invoice issuance controls", () => {
  it("requires a VAT number when an invoice contains VAT", async () => {
    const stub = tenant();
    await enableService(stub);
    await setInvoiceIdentity(stub);
    const { invoiceId } = await draftInvoice(stub, 2000);

    const issued = await request<{ error: string }>(stub, `/service/invoices/${invoiceId}/issue`, "POST", {});
    expect(issued.response.status).toBe(409);
    expect(issued.data.error).toContain("VAT number");
  });

  it("does not require a VAT number for a zero-tax invoice", async () => {
    const stub = tenant();
    await enableService(stub);
    await setInvoiceIdentity(stub);
    const { invoiceId } = await draftInvoice(stub, 0);

    const issued = await request<{ ok: boolean }>(stub, `/service/invoices/${invoiceId}/issue`, "POST", {});
    expect(issued.response.ok).toBe(true);
    expect(issued.data.ok).toBe(true);
  });

  it("cannot issue a draft service invoice while the Service module is disabled", async () => {
    const stub = tenant();
    await enableService(stub);
    await setInvoiceIdentity(stub, "GB123456789");
    const { invoiceId } = await draftInvoice(stub, 2000);

    const disabled = await request(stub, "/modules/service", "PATCH", { enabled: false });
    expect(disabled.response.ok).toBe(true);

    const issued = await request<{ error: string }>(stub, `/service/invoices/${invoiceId}/issue`, "POST", {});
    expect(issued.response.status).toBe(404);
    expect(issued.data.error).toContain("Service is disabled");
  });

  it("keeps the CRM and commerce customer compatibility layer aligned when invoice issue converts a prospect", async () => {
    const stub = tenant();
    await enableService(stub);
    await setInvoiceIdentity(stub, "GB123456789");
    const { contactId, invoiceId } = await draftInvoice(stub, 2000);

    const before = await request<{ lifecycle_stage: string }>(stub, `/crm/contacts/${contactId}`);
    expect(before.data.lifecycle_stage).toBe("prospect");

    const issued = await request(stub, `/service/invoices/${invoiceId}/issue`, "POST", {});
    expect(issued.response.ok).toBe(true);

    const after = await request<{ lifecycle_stage: string }>(stub, `/crm/contacts/${contactId}`);
    expect(after.data.lifecycle_stage).toBe("customer");

    const customers = await request<Array<{ id: string; crm_contact_id: string | null }>>(stub, "/customers");
    expect(customers.data.some(customer => customer.id === contactId && customer.crm_contact_id === contactId)).toBe(true);

    const audit = await request<Array<{ action: string; entity_id: string | null }>>(stub, "/audit");
    expect(audit.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "crm_contact.converted", entity_id: contactId }),
      expect.objectContaining({ action: "service_invoice.issued", entity_id: invoiceId }),
    ]));
  });
});
