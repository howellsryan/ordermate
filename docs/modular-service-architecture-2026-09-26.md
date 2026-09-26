# Modular CRM + service architecture — 26 September 2026

## Decision

Operating Layer will support **independent business modules** rather than stretching the existing commerce `orders` model across every industry.

The service domain is a first-class bounded context with its own lifecycle and persistence. It can share CRM contacts, catalogue items, inventory movements, suppliers and reporting primitives without becoming a special kind of sales order.

The architecture is intentionally composable:

- **CRM** — prospects and customers, shared contact details and history.
- **Service** — requests, quotes, jobs/visits, invoices and payments.
- **Orders** — stock-owning customer sales and fulfilment.
- **Inventory** — stock, movements, transfers and counts.
- **Purchasing** — suppliers, supplier terms, POs and receiving.
- **Warehouse** — picking/receiving execution; depends on Orders + Inventory/Purchasing where appropriate.
- **Reports** — read models composed from enabled domains.

A workspace enables only the modules it needs. Disabling a module hides its UI and blocks its domain routes; it does **not** delete its data. Re-enabling it restores the same records.

## Why Service must not be an Order subtype

Real service software models the work lifecycle independently. Jobber currently describes Request → Quote → Job → Invoice → Payment as common building blocks, while allowing a request to skip quote and convert directly to a job. It also supports multiple/progress invoices. Those semantics do not fit a stock-reservation/fulfilment order state machine without creating invalid states and brittle nullable fields.

Service and Orders therefore share primitives, not lifecycle tables:

- a CRM contact can own either orders or service work;
- a quote or invoice can reference catalogue items but snapshots commercial values;
- a job can consume inventory through canonical inventory movements;
- a service invoice is not an order and order fulfilment is not job completion.

## Module model

`workspace_modules` is tenant-scoped configuration:

```text
module_key       enabled
crm              true
service          false
orders           true
inventory        true
purchasing       true
warehouse        true
reports          true
```

### Dependencies

Dependencies are explicit and validated server-side. No silent cascading switches.

- `service` requires `crm`.
- `warehouse` requires `inventory` and at least one execution source (`orders` or `purchasing`).
- `purchasing` can operate without `orders`.
- `inventory` can operate independently.
- `reports` is compositional and shows only enabled-domain sections.

Existing tenants migrate with today's modules enabled so the v7 experience does not disappear after upgrade.

## CRM model

CRM owns people/companies as **contacts**. `prospect` and `customer` are lifecycle stages of the same record, not separate tables, so conversion preserves identity and history.

Minimum first-class fields:

- `id`
- `lifecycle_stage`: `prospect | customer`
- `name`
- `email`
- `mobile`
- structured postal address: line 1, line 2, locality/city, region/county, postcode, country code
- `notes`
- optional `source`
- `converted_at`
- created/updated timestamps

The existing `customers` table remains as a commerce compatibility layer during migration. It gains a unique link to the CRM contact so existing order foreign keys remain valid while new service entities use the canonical CRM contact directly. New CRM customers can be projected into the compatibility table only when an existing order endpoint needs one; the long-term direction is for Orders to reference CRM contacts directly in a later controlled migration.

This avoids a risky one-shot rewrite of existing order foreign keys while preventing service from depending on the legacy commerce customer record.

## Service aggregate model

A `service_case` is the durable thread connecting an enquiry to commercial and operational outcomes. It is not a giant mutable state machine; child documents keep their own lifecycle.

```text
CRM contact
   │
   └── service_case
         ├── request(s)
         ├── quote(s) + quote lines
         ├── job(s)
         │     └── visit(s)
         │     └── posted material usage -> inventory movements
         └── invoice(s) + invoice lines
               └── payment(s)
```

### Service case

Purpose: one customer need / piece of work.

Fields include contact, title, summary, default service/site address, source, lifecycle (`open | won | closed | cancelled`) and timestamps.

A case does not claim that every child stage exists. This supports:

- request → quote → job → invoice;
- request → job → invoice;
- quote-only work that is declined;
- multi-visit jobs;
- deposit/progress/final invoices.

### Request

Intake/qualification, with statuses such as `new | qualified | converted | declined | cancelled`.

A request belongs to a CRM contact and service case. Intake can capture requested timing, problem/need, source and notes. An inbound request from a new person should atomically create a `prospect` contact rather than create a second lead table.

### Quote

Commercial proposal, statuses `draft | sent | accepted | rejected | expired | superseded | cancelled`.

Quotes have immutable/snapshotted line economics once sent. Lines use integer `quantity_milli` (1000 = 1 unit) so labour can represent 1.5 hours without floating-point quantities. Money remains integer minor units.

Accepted quotes may create a job but do not mutate an Order.

### Job + visits

A job represents the work obligation; visits represent scheduled attendance.

Job statuses: `draft | scheduled | in_progress | completed | cancelled`.

Visit statuses: `scheduled | travelling | on_site | completed | cancelled | no_show`.

This distinction allows a real electrician job to span multiple appointments without duplicating the commercial quote or invoice.

A job snapshots the service address so later edits to the CRM contact do not rewrite historic work.

### Materials

Service does not maintain a parallel stock balance.

When material usage is posted to a job:

1. validate the Inventory module is enabled;
2. validate variant/location and available stock;
3. create a `service_material_usage` audit record with cost/SKU description snapshot;
4. create the normal immutable `inventory_movements` row with `reference_type='service_job'` and the job ID;
5. update canonical on-hand stock in the same transaction.

If Inventory is disabled, service lines can still describe materials as commercial text/amounts, but no stock mutation is attempted.

### Invoice

Invoices are service-domain financial documents, not orders.

Statuses: `draft | issued | partially_paid | paid | void` (overdue is derived from `due_date` + outstanding balance, not stored as a conflicting lifecycle state).

The model supports more than one invoice per case/job for deposits and progress billing.

On issue, the invoice freezes:

- unique invoice number;
- business legal/contact identity snapshot;
- customer name/address snapshot;
- supply date;
- issue and due dates;
- currency and tax treatment;
- line descriptions, quantity, price, tax and totals.

This matches UK invoice requirements and prevents later CRM/settings edits changing an issued document.

Payments are append-only records allocated to an invoice. Paid status is derived/transitioned when allocations reach invoice total. Payment capture is separate from payment-provider integration.

## Cross-domain invariants

1. Every tenant mutation is audited.
2. Money uses integer minor units; fractional service quantities use integer thousandths.
3. Sent quotes and issued invoices snapshot commercial values.
4. Inventory changes only through the canonical movement path.
5. Module switches never delete domain data.
6. Server routes enforce module availability; hiding navigation is not a security boundary.
7. A lifecycle transition validates the current state; clients cannot PATCH arbitrary status strings.
8. Service Case is a correlation root, not a substitute for quote/job/invoice lifecycle records.
9. CRM contact edits never rewrite historic quote, job-address or invoice snapshots.
10. Optional modules must not create hard runtime dependencies when disabled.

## API surface

```text
GET   /modules
PATCH /modules/:moduleKey

GET   /crm/contacts?stage=prospect|customer
POST  /crm/contacts
PATCH /crm/contacts/:id
POST  /crm/contacts/:id/convert

GET   /service/cases
POST  /service/requests
POST  /service/requests/:id/qualify
POST  /service/requests/:id/convert-to-quote
POST  /service/requests/:id/convert-to-job

POST  /service/quotes
POST  /service/quotes/:id/send
POST  /service/quotes/:id/accept
POST  /service/quotes/:id/reject
POST  /service/quotes/:id/create-job

POST  /service/jobs
POST  /service/jobs/:id/visits
POST  /service/jobs/:id/start
POST  /service/jobs/:id/materials
POST  /service/jobs/:id/complete

POST  /service/invoices
POST  /service/invoices/:id/issue
POST  /service/invoices/:id/payments
POST  /service/invoices/:id/void
```

The first implementation slice does not need every convenience endpoint, but the persistence model must not block them.

## UX

### Navigation

Navigation is generated from the module registry. A service-only electrician workspace can therefore show:

- Overview
- CRM
- Service
- Inventory (optional)
- Purchasing (optional)
- Reports (optional)
- Team
- Settings

A pure ecommerce business can show Orders/Warehouse while Service remains absent.

### Settings → Modules

Owners/admins see module cards with:

- module name and plain-English purpose;
- enabled/disabled state;
- dependencies;
- warning that disabling hides workflows but preserves records;
- blocked toggle with exact dependency explanation when a change would make configuration invalid.

### CRM

One page with Prospect/Customer filters rather than separate databases. Conversion is an explicit action and retains the same contact ID/history.

### Service

The default service workspace is stage-oriented, but each record opens into the actual request/quote/job/invoice documents. The UI must not imply that completing a card magically completes downstream stages.

## Demo implications

Vertical demos now have two kinds of capability:

- **real product modules**: CRM, Service, Orders, Inventory, Purchasing, Warehouse, Reports;
- **vertical configuration/data**: which modules are enabled, seeded records and terminology/workflow examples.

Electrician and salon demos should exercise the actual Service + CRM module once delivered, rather than a narrative-only prototype. Cafe recipe depletion and dropship supplier-direct fulfilment can remain vertical prototypes until their reusable domains are implemented.

## Delivery slices

### Slice A — module foundation + mini CRM

- schema v8 module table + CRM contacts;
- backfill existing customers into CRM contacts and link compatibility records;
- module registry/dependency validation;
- `/modules` and `/crm/contacts` APIs;
- module-driven navigation/settings;
- CRM prospect/customer UI and conversion;
- tenant isolation, audit and migration tests.

### Slice B — service request/quote/job core

- service cases, requests, quotes/lines, jobs, visits;
- lifecycle transition APIs;
- request → quote/job conversion without Orders;
- service workspace UI and tests.

### Slice C — service invoicing + payments

- invoice/line/payment tables;
- issue snapshots + numbering;
- due/outstanding calculations;
- progress/multiple invoices per job/case;
- printable/exportable invoice representation;
- UK invoice-field validation.

### Slice D — service inventory integration

- posted job material usage;
- canonical inventory movements with service references;
- van/depot locations and replenishment demo journey;
- rollback/insufficient-stock tests.

This branch can build the slices incrementally without changing the semantics of existing Orders.