import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { TenantStore } from "../src/worker/tenant-store-order-planning";

type Stub = DurableObjectStub<TenantStore>;

function tenant(): Stub {
  return env.TENANT_STORES.getByName(`service-${crypto.randomUUID()}`);
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
  const enabled = await request(stub, "/modules/service", "PATCH", { enabled: true });
  expect(enabled.response.ok).toBe(true);
}

async function configureInvoiceIdentity(stub: Stub) {
  const profile = await request(stub, "/business-profile", "PATCH", {
    address: { line1: "12 Market Street", city: "Nottingham", postcode: "NG1 2AB", country: "GB" },
    email: "accounts@wiredright.example.test",
    phone: "0115 555 0199",
    vatNumber: "GB123456789",
    companyNumber: "12345678",
  });
  expect(profile.response.ok).toBe(true);
}

async function createLocation(stub: Stub) {
  const result = await request<{ id: string }>(stub, "/locations", "POST", {
    name: "WiredRight Workshop",
    code: "WRK",
    address: { line1: "12 Market Street", city: "Nottingham", postcode: "NG1 2AB", country: "GB" },
  });
  expect(result.response.status).toBe(201);
  return result.data.id;
}

async function createVariant(stub: Stub) {
  const created = await request<{ id: string }>(stub, "/products", "POST", {
    name: "Twin & Earth Cable",
    category: "Electrical",
    variants: [{
      name: "2.5mm 10m",
      sku: `CABLE-${crypto.randomUUID().slice(0, 8)}`,
      barcode: `50${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`,
      priceMinor: 1800,
      costMinor: 900,
      taxRateBps: 2000,
      options: {},
    }],
  });
  expect(created.response.status).toBe(201);
  const products = await request<Array<{ variants: Array<{ id: string }> }>>(stub, "/products");
  return products.data[0].variants[0].id;
}

describe("workspace modules", () => {
  it("keeps service disabled by default and validates dependencies without deleting data", async () => {
    const stub = tenant();
    const modules = await request<{ modules: Array<{ key: string; enabled: boolean }> }>(stub, "/modules");
    expect(modules.response.ok).toBe(true);
    expect(modules.data.modules.find(module => module.key === "service")?.enabled).toBe(false);

    const blocked = await request(stub, "/service/cases");
    expect(blocked.response.status).toBe(404);

    await enableService(stub);

    const disableCrm = await request(stub, "/modules/crm", "PATCH", { enabled: false });
    expect(disableCrm.response.status).toBe(409);

    const disableInventory = await request(stub, "/modules/inventory", "PATCH", { enabled: false });
    expect(disableInventory.response.status).toBe(409);

    const disableOrders = await request(stub, "/modules/orders", "PATCH", { enabled: false });
    expect(disableOrders.response.ok).toBe(true);
    const disablePurchasing = await request(stub, "/modules/purchasing", "PATCH", { enabled: false });
    expect(disablePurchasing.response.status).toBe(409); // Warehouse still has Purchasing as its remaining execution source.
    const disableWarehouse = await request(stub, "/modules/warehouse", "PATCH", { enabled: false });
    expect(disableWarehouse.response.ok).toBe(true);
    const disablePurchasingAfterWarehouse = await request(stub, "/modules/purchasing", "PATCH", { enabled: false });
    expect(disablePurchasingAfterWarehouse.response.ok).toBe(true);
    const disableInventoryAfterDependants = await request(stub, "/modules/inventory", "PATCH", { enabled: false });
    expect(disableInventoryAfterDependants.response.ok).toBe(true);
  });
});

describe("service lifecycle", () => {
  it("moves a prospect from request through quote, job, invoice and payment without creating an order", async () => {
    const stub = tenant();
    await enableService(stub);
    await configureInvoiceIdentity(stub);

    const contact = await request<{ id: string }>(stub, "/crm/contacts", "POST", {
      lifecycleStage: "prospect",
      name: "Jamie Taylor",
      email: "jamie@example.test",
      mobile: "07123456789",
      address: { line1: "7 Orchard Close", city: "Nottingham", postcode: "NG2 3CD", country: "GB" },
      source: "Website",
    });
    expect(contact.response.status).toBe(201);

    const serviceRequest = await request<{ id: string; caseId: string }>(stub, "/service/requests", "POST", {
      contactId: contact.data.id,
      title: "Kitchen socket keeps tripping",
      details: "Customer reports the kitchen ring trips when the kettle is used.",
      source: "Website",
      siteAddress: { line1: "7 Orchard Close", city: "Nottingham", postcode: "NG2 3CD", country: "GB" },
      requestedFor: "Next weekday morning",
    });
    expect(serviceRequest.response.status).toBe(201);

    const qualified = await request(stub, `/service/requests/${serviceRequest.data.id}/qualify`, "POST", {});
    expect(qualified.response.ok).toBe(true);

    const quote = await request<{ quoteId: string }>(stub, `/service/requests/${serviceRequest.data.id}/convert-to-quote`, "POST", {
      notes: "Includes fault finding and first hour labour.",
      lines: [{
        lineType: "service",
        description: "Electrical fault finding and labour",
        quantityMilli: 1500,
        unitPriceMinor: 8000,
        taxRateBps: 2000,
      }],
    });
    expect(quote.response.status).toBe(201);

    expect((await request(stub, `/service/quotes/${quote.data.quoteId}/send`, "POST", {})).response.ok).toBe(true);
    expect((await request(stub, `/service/quotes/${quote.data.quoteId}/accept`, "POST", {})).response.ok).toBe(true);

    const convertedContact = await request<{ lifecycle_stage: string }>(stub, `/crm/contacts/${contact.data.id}`);
    expect(convertedContact.data.lifecycle_stage).toBe("customer");

    const job = await request<{ jobId: string }>(stub, `/service/quotes/${quote.data.quoteId}/create-job`, "POST", {});
    expect(job.response.status).toBe(201);

    const visit = await request<{ id: string }>(stub, `/service/jobs/${job.data.jobId}/visits`, "POST", {
      scheduledStart: "2026-10-01T09:00:00.000Z",
      scheduledEnd: "2026-10-01T11:00:00.000Z",
      assignedActorId: "engineer-alex",
    });
    expect(visit.response.status).toBe(201);
    expect((await request(stub, `/service/jobs/${job.data.jobId}/start`, "POST", {})).response.ok).toBe(true);

    const locationId = await createLocation(stub);
    const variantId = await createVariant(stub);
    expect((await request(stub, "/inventory/adjust", "POST", { variantId, locationId, quantityDelta: 5, reason: "Van stock" })).response.ok).toBe(true);

    const material = await request<{ movementId: string }>(stub, `/service/jobs/${job.data.jobId}/materials`, "POST", {
      visitId: visit.data.id,
      variantId,
      locationId,
      quantity: 2,
    });
    expect(material.response.status).toBe(201);

    const inventory = await request<Array<{ variant_id: string; location_id: string; on_hand: number }>>(stub, "/inventory");
    expect(inventory.data.find(row => row.variant_id === variantId && row.location_id === locationId)?.on_hand).toBe(3);

    expect((await request(stub, `/service/jobs/${job.data.jobId}/complete`, "POST", {})).response.ok).toBe(true);

    const invoice = await request<{ invoiceId: string }>(stub, "/service/invoices", "POST", {
      caseId: serviceRequest.data.caseId,
      jobId: job.data.jobId,
      dueDate: "2026-10-15",
      lines: [
        { lineType: "service", description: "Electrical fault finding and labour", quantityMilli: 1500, unitPriceMinor: 8000, taxRateBps: 2000 },
        { lineType: "material", description: "Twin & Earth Cable", quantityMilli: 2000, unitPriceMinor: 1800, taxRateBps: 2000 },
      ],
    });
    expect(invoice.response.status).toBe(201);

    const issued = await request<{ issueDate: string; supplyDate: string }>(stub, `/service/invoices/${invoice.data.invoiceId}/issue`, "POST", {});
    expect(issued.response.ok).toBe(true);
    expect(issued.data.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(issued.data.supplyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const invoices = await request<{ invoices: Array<{ id: string; total_minor: number; status: string }> }>(stub, "/service/invoices");
    const currentInvoice = invoices.data.invoices.find(row => row.id === invoice.data.invoiceId)!;
    expect(currentInvoice.status).toBe("issued");

    const partial = await request<{ status: string; outstandingMinor: number }>(stub, `/service/invoices/${invoice.data.invoiceId}/payments`, "POST", {
      amountMinor: 5000,
      method: "bank_transfer",
    });
    expect(partial.data.status).toBe("partially_paid");
    expect(partial.data.outstandingMinor).toBeGreaterThan(0);

    const finalPayment = await request<{ status: string; outstandingMinor: number }>(stub, `/service/invoices/${invoice.data.invoiceId}/payments`, "POST", {
      amountMinor: partial.data.outstandingMinor,
      method: "bank_transfer",
      reference: "TEST-FINAL",
    });
    expect(finalPayment.data).toMatchObject({ status: "paid", outstandingMinor: 0 });

    const orders = await request<Array<unknown>>(stub, "/orders");
    expect(orders.data).toEqual([]);

    const audit = await request<Array<{ action: string }>>(stub, "/audit");
    expect(audit.data.map(event => event.action)).toEqual(expect.arrayContaining([
      "business_profile.updated",
      "service_request.created",
      "service_quote.accepted",
      "service_job.material_posted",
      "service_job.completed",
      "service_invoice.issued",
      "service_invoice.payment_recorded",
    ]));
  });

  it("can issue a service invoice with commerce, warehouse, purchasing and inventory modules switched off", async () => {
    const stub = tenant();
    await enableService(stub);
    await configureInvoiceIdentity(stub);

    expect((await request(stub, "/modules/warehouse", "PATCH", { enabled: false })).response.ok).toBe(true);
    expect((await request(stub, "/modules/orders", "PATCH", { enabled: false })).response.ok).toBe(true);
    expect((await request(stub, "/modules/purchasing", "PATCH", { enabled: false })).response.ok).toBe(true);
    expect((await request(stub, "/modules/inventory", "PATCH", { enabled: false })).response.ok).toBe(true);

    const modules = await request<{ modules: Array<{ key: string; enabled: boolean }> }>(stub, "/modules");
    const config = Object.fromEntries(modules.data.modules.map(module => [module.key, module.enabled]));
    expect(config).toMatchObject({ crm: true, service: true, orders: false, inventory: false, purchasing: false, warehouse: false });

    const contact = await request<{ id: string }>(stub, "/crm/contacts", "POST", {
      lifecycleStage: "prospect",
      name: "Aisha Khan",
      email: "aisha@example.test",
      mobile: "07700900123",
      address: { line1: "55 Mapperley Road", city: "Nottingham", postcode: "NG3 5AQ", country: "GB" },
    });
    expect(contact.response.status).toBe(201);

    const serviceRequest = await request<{ id: string; caseId: string }>(stub, "/service/requests", "POST", {
      contactId: contact.data.id,
      title: "Replace failed light fitting",
      details: "Replace customer-supplied light fitting and test the circuit.",
      siteAddress: { line1: "55 Mapperley Road", city: "Nottingham", postcode: "NG3 5AQ", country: "GB" },
    });
    expect(serviceRequest.response.status).toBe(201);

    const job = await request<{ jobId: string }>(stub, `/service/requests/${serviceRequest.data.id}/convert-to-job`, "POST", {});
    expect(job.response.status).toBe(201);
    expect((await request(stub, `/service/jobs/${job.data.jobId}/start`, "POST", {})).response.ok).toBe(true);
    expect((await request(stub, `/service/jobs/${job.data.jobId}/complete`, "POST", {})).response.ok).toBe(true);

    const invoice = await request<{ invoiceId: string }>(stub, "/service/invoices", "POST", {
      caseId: serviceRequest.data.caseId,
      jobId: job.data.jobId,
      dueDate: "2026-10-20",
      lines: [{ lineType: "service", description: "Light fitting replacement and circuit test", quantityMilli: 1000, unitPriceMinor: 9500, taxRateBps: 2000 }],
    });
    expect(invoice.response.status).toBe(201);

    const issued = await request<{ issueDate: string; supplyDate: string }>(stub, `/service/invoices/${invoice.data.invoiceId}/issue`, "POST", {});
    expect(issued.response.ok).toBe(true);

    const inventoryRoute = await request(stub, "/inventory");
    expect(inventoryRoute.response.status).toBe(404);

    const ordersRoute = await request(stub, "/orders");
    expect(ordersRoute.response.status).toBe(404);

    const cases = await request<{ cases: Array<{ id: string }> }>(stub, "/service/cases");
    expect(cases.response.ok).toBe(true);
    expect(cases.data.cases.some(item => item.id === serviceRequest.data.caseId)).toBe(true);
  });
});
