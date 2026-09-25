# OrderMate architecture

## Decision summary

OrderMate is a Cloudflare-native modular monolith. The browser talks to one Worker. Authentication and membership are global; operational business data is physically isolated per tenant.

### Control plane
`CONTROL_DB` is a D1 database restricted to the EU jurisdiction. Better Auth stores Google identities, sessions, organizations, members and workspace invitations here. The Worker derives the user from the session and verifies organization membership before any tenant request is routed.

### Tenant data plane
Each Better Auth organization ID maps deterministically to one `TenantStore` Durable Object via the EU-restricted subnamespace. Its embedded SQLite database stores catalogue, locations, inventory ledger, replenishment policy, suppliers, supplier/variant mappings, purchase orders, customers, orders, fulfilments, returns and tenant audit history.

This deliberately avoids a shared operational database. A programming mistake cannot accidentally query another tenant's product/order rows because those rows do not exist in the current tenant database.

SQLite-backed Durable Objects also serialize writes for a tenant. That is valuable for stock reservation, purchase receiving, fulfilment, reviewed stocktakes and atomic onboarding imports because competing mutations share one consistency boundary.

### Storage and automation
R2 holds source documents, structured extraction proposals and future product media. Keys are tenant-prefixed and never include original filenames or other user-visible PII. Object access is only proxied after membership checks.

Cloudflare Queues carry asynchronous automation events. Messages contain a tenant ID plus immutable event ID and are treated as at-least-once delivery. Document extraction is idempotent because an existing final proposal sidecar prevents a retry from repeating inference. Failed messages receive bounded retries before Wrangler routes them to `ordermate-events-dead`.

Workers AI is an optional document-extraction processor, not a canonical business-data store. It is disabled by default with `AI_DOCUMENT_EXTRACTION_ENABLED=false`. Multi-step automation that eventually needs stronger durable orchestration may use Cloudflare Workflows, but Workflows are not currently required for the purchasing pipeline.

## Domain rules

### Catalogue
Products contain arbitrary option dimensions. Sellable variants own SKU, barcode, price, cost and tax classification. Modifiers/add-ons are separate from variant dimensions. Products are archived/restored rather than deleted when commercial use ends, so historical snapshots and tracked stock remain visible.

Inactive/archived variants remain available to historical and stock-control read models but are excluded from new orders, new POs, low-stock attention and replenishment planning.

### Catalogue CSV onboarding
Catalogue import is deliberately **create-only** rather than an ambiguous bulk-upsert mechanism.

The supported flow is:

`CSV parse -> tenant dry-run -> explicit human review -> fingerprint check -> one SQLite transaction`

A CSV can create new products/variants/categories/suppliers, arbitrary option values, supplier mappings and opening stock at an already-existing location code. Location typos fail validation rather than silently creating warehouses.

The browser parser is convenience only. The TenantStore validates the complete structured payload again against live tenant state. Dry-run returns line-numbered errors/warnings and an exact create plan. Commit must echo the reviewed fingerprint; OrderMate rebuilds the plan against current tenant state and rejects stale previews before mutation.

The commit path then writes all catalogue records, supplier mappings, opening inventory levels, immutable opening-stock movements and one audit summary inside a single `transactionSync`. Any invariant/write failure rolls back the whole import. A successful create-only import cannot be safely duplicated by retrying the same CSV because its SKU/barcode/product conflicts are caught on the next dry-run.

### Inventory
Inventory is per variant and location. `on_hand`, `reserved` and derived `available` are tracked. Incoming stock is derived from submitted purchase orders. Every physical change creates an immutable inventory movement.

A product/location cross-product is not automatically a stock position. The read model distinguishes never-stocked (`tracked=0`) from tracked zero stock. Low-stock alerts and replenishment only act on genuine tracked positions. Archived variants with physical stock remain visible for control/traceability but are excluded from active planning.

### Cycle counts
Cycle count is a reviewed **partial stocktake**, not a destructive full-location overwrite.

The operator selects one active location and explicitly counts only the SKUs physically checked. Blank means “not counted; do not touch”. Zero is an explicit reviewed physical count and may establish a never-stocked SKU/location pair as tracked zero stock.

For each counted line the client retains the on-hand/reserved snapshot that was visible when that SKU entered the count. Commit submits both the reviewed snapshot and physical count. The TenantStore rechecks every line against live stock before any mutation; if on-hand or reserved stock changed, the whole batch is rejected as stale.

A count may never reduce on-hand below currently reserved stock. Successful counts update all reviewed levels in one `transactionSync`, create immutable `stocktake` movements only for non-zero variances under one stocktake reference, and write one tenant audit summary. A zero-variance count may deliberately establish tracking without inventing a quantity movement.

Cycle-count permissions are intentionally narrower than generic inventory updates: Owner, Admin, Manager and Inventory may commit reviewed counts. Fulfilment cannot reconcile physical stock merely because it can perform fulfilment-related inventory updates.

### Warehouse operations
Warehouse scanning is a client-side staging workflow over the canonical order/PO lifecycle endpoints; it is not a second inventory engine.

Pick & Fulfil is available to fulfilment-capable roles. Receive Stock is available to purchasing/inventory-capable roles. USB/Bluetooth keyboard-wedge scanners and manual barcode entry feed deterministic exact-barcode counting. Wrong items, ambiguous duplicate barcodes and scans beyond the document's outstanding quantity are rejected before submission. Products without a barcode can be corrected manually with bounded +/- controls.

Mobile camera scanning uses lazy-loaded ZXing rather than the browser-native `BarcodeDetector` API. Camera mode captures one confirmed barcode per camera session to avoid repeated frames accidentally staging multiple units, and all media tracks are released on success, close and unmount. Camera frames never leave the browser.

Scanned quantities do not change business data. The operator must explicitly commit them through the existing `/orders/:id/fulfil` or `/purchase-orders/:id/receive` transaction. Those endpoints remain responsible for reservation rules, over-receipt protection, immutable inventory movements and audit attribution.

### Purchasing
Suppliers own purchase orders. PO lines snapshot supplier references, unit cost and tax. Partial receiving is supported and receiving creates inventory movements. Purchase-order cancellation removes only outstanding incoming commitment; it never reverses already received physical stock.

`supplier_variants` maps supplier SKU, latest known cost and lead time onto stable OrderMate variant identities.

Supplier-code learning is human-reviewed. When a purchase-document proposal contains a supplier SKU, the reviewer may explicitly choose to remember that code only after confirming the supplier and OrderMate variant. Existing different codes are not silently replaced. A supplier code already owned by another variant is rejected both in the review UX and by the canonical supplier-mapping endpoint, preserving deterministic future matching.

### Replenishment planning
Replenishment is deterministic and human-approved. It uses available/reserved stock, incoming submitted POs, fulfilled demand over the last 30 days and supplier lead time.

Schema v2 adds sparse `inventory_policies` per variant/location. Absence of a row means use workspace defaults. A custom policy may override reorder point, target stock at expected supplier arrival and preferred mapped supplier.

Preferred supplier lead time drives the same recommendation that is handed into draft-PO review. Custom target stock is interpreted as the desired stock position **at supplier arrival**, so forecast lead-time demand is included in the recommended order quantity.

Recommendations never create a purchasing commitment automatically. They only pre-fill a draft PO for explicit commercial review.

### AI purchasing-document intake
The supplier purchase-document path is deliberately proposal-based:

`EU R2 source -> Queue -> Cloudflare document conversion -> Workers AI JSON extraction -> deterministic matching -> R2 proposal -> human review -> normal draft PO`

Rules:

1. source document text is treated as untrusted data; model prompts explicitly prohibit following instructions embedded in the document;
2. the model extracts a strict JSON shape only and must leave unsupported values blank/zero rather than infer them;
3. model output is validated again with Zod;
4. matching is deterministic and explainable: exact normalized supplier identity, supplier SKU, barcode or OrderMate SKU only;
5. ambiguous data remains unmatched for the reviewer; fuzzy model-selected stock identities are not accepted;
6. raw converted Markdown is not persisted;
7. the source document and structured proposal remain in tenant-prefixed R2;
8. AI never submits a PO, receives stock, adjusts inventory or fulfils an order; and
9. the reviewed proposal creates a standard draft PO through the same canonical purchasing endpoint as a manually entered PO.

Currency mismatch is a hard block for AI-assisted draft creation because OrderMate does not silently convert supplier costs. Image conversion is considered best-effort and is always flagged for explicit review.

### AI delivery-note assistance
Delivery notes use the same trust boundary but are anchored to one existing open purchase order:

`EU R2 delivery note -> Queue -> extraction of delivered identifiers/quantities -> exact selected-PO matching -> R2 proposal -> human review -> staged Warehouse counts -> canonical PO receipt`

The extraction prompt ignores prices/tax and only asks for document references, product identifiers and physically delivered quantities. Exact supplier SKU, barcode and OrderMate SKU evidence may propose a match. Conflicting identifiers, unknown lines, wrong PO references, image extraction and over-delivery force review. Suggested quantities are capped at the selected PO's outstanding quantity.

A reviewed delivery proposal still does not alter inventory. It only pre-fills the Warehouse receiving counts. The operator can scan/edit them further and must explicitly press Receive. The live PO receiving transaction re-validates the outstanding quantities before any stock movement. The R2 proposal is marked accepted only after that canonical receipt succeeds.

### Orders
Order lines snapshot product/variant/SKU, price, tax and selected modifiers. Confirmation creates reservations. Partial fulfilment consumes only the quantity leaving the location and retains the outstanding reservation. Cancellation releases outstanding reservations. Returns are independent events and may optionally restock.

### Money and tax
All amounts are integer minor units. Each line stores net, tax and gross values plus the applied tax rate basis points. Tenant settings define default currency and whether catalogue prices are tax-inclusive.

## Security model

1. Google authenticates the identity; Better Auth owns the application session.
2. The Worker reads the session from secure cookies.
3. The requested organization ID is treated only as a selector.
4. The Worker verifies `member(user_id, organization_id)` in D1.
5. Static role permissions are checked server-side and unclassified tenant routes fail closed.
6. Catalogue import preview/commit are explicitly classified as `catalogue:create`, not generic inventory updates.
7. Cycle-count commit is explicitly classified as `stocktake:create`; fulfilment roles do not inherit it from generic inventory update permission.
8. The Worker routes to the tenant's EU Durable Object and replaces all internal actor headers.
9. The tenant object records actor ID/role on every mutation.
10. R2 document/proposal keys are tenant-prefixed and document endpoints repeat membership/permission checks.
11. Custom mutations reject cross-site requests before business handlers run.
12. Queue logging is limited to event type/ID; source filenames, tenant IDs, user IDs and document contents are not logged.

Tests must cover guessed IDs, changed tenant headers, cross-tenant document keys, unauthorized roles, repeated/idempotent messages, deterministic document matching, warehouse scan invariants, cycle-count stale/atomicity guarantees, archive/restore invariants, migration upgrades and catalogue-import stale/atomicity guarantees.

## Schema evolution

Tenant storage is currently schema version **2**.

The final exported `TenantStore` runs an ordered versioning layer under the Durable Object initialization barrier. `_sql_schema_migrations` stores monotonically increasing applied migration IDs. Existing pre-tracker v1 tenant objects and fresh v1 objects are safely marked migration `1` only after all 25 baseline v1 tables are verified. A tenant whose stored migration version is newer than the running application fails closed instead of being interpreted by older code.

Migration `2` creates `inventory_policies` and its preferred-supplier index in-place. Fresh tenants and simulated v1 -> v2 upgrades are covered by regression tests, including preservation of existing catalogue data.

Cloudflare Durable Objects do not support `PRAGMA user_version`, so OrderMate follows Cloudflare's documented explicit migration-table pattern rather than relying on that SQLite pragma.

Every future schema migration must:

1. live in the ordered tenant migration runner and have one monotonically increasing ID;
2. read the current applied migration version before changing schema;
3. perform its schema/data mutation in the Durable Object's serialized execution boundary and record the migration only after success;
4. be covered by tests for a fresh tenant and an upgrade from the previous schema version; and
5. never require replacing a tenant Durable Object or copying live business data merely to deploy application code.

## Compliance posture

D1, Durable Objects and R2 are created/restricted for EU jurisdiction where supported. PII must not be placed in queue names, object keys, logs or analytics dimensions. Secrets are Wrangler secrets rather than source-controlled vars. Data export/deletion and configurable retention remain first-class requirements before public launch.

Workers AI needs an explicit distinction: it remains Cloudflare-hosted, but Cloudflare's current Data Localization compatibility documentation lists Workers AI as unsupported by Regional Services. Customer Metadata Boundary support does not mean inference itself is pinned to the EU. For that reason AI document extraction is disabled by default and must be intentionally enabled only after its processing posture is accepted for the product's compliance requirements.
