# OrderMate architecture

## Decision summary

OrderMate is a Cloudflare-native modular monolith. The browser talks to one Worker. Authentication and membership are global; operational business data is physically isolated per tenant.

### Control plane
`CONTROL_DB` is a D1 database restricted to the EU jurisdiction. Better Auth stores Google identities, sessions, organizations, members and workspace invitations here. The Worker derives the user from the session and verifies organization membership before any tenant request is routed.

### Tenant data plane
Each Better Auth organization ID maps deterministically to one `TenantStore` Durable Object via the EU-restricted subnamespace. Its embedded SQLite database stores catalogue, locations, inventory ledger, replenishment policy, suppliers, supplier/variant mappings, purchase orders, customers, orders, fulfilments, returns, delivery discrepancies, per-user saved views and tenant audit history.

This deliberately avoids a shared operational database. A programming mistake cannot accidentally query another tenant's product/order rows because those rows do not exist in the current tenant database.

SQLite-backed Durable Objects also serialize writes for a tenant. That is valuable for stock reservation, purchase receiving, fulfilment, reviewed stocktakes, bulk catalogue actions and atomic onboarding imports because competing mutations share one consistency boundary.

### Storage and automation
R2 holds source documents, structured extraction proposals and future product media. Keys are tenant-prefixed and never include original filenames or other user-visible PII. Object access is only proxied after membership checks.

Cloudflare Queues carry asynchronous automation events. Messages contain a tenant ID plus immutable event ID and are treated as at-least-once delivery. Document extraction is idempotent because an existing final proposal sidecar prevents a retry from repeating inference. Failed messages receive bounded retries before Wrangler routes them to `ordermate-events-dead`.

Workers AI is an optional document-extraction processor, not a canonical business-data store. It is disabled by default with `AI_DOCUMENT_EXTRACTION_ENABLED=false`. Multi-step automation that eventually needs stronger durable orchestration may use Cloudflare Workflows, but Workflows are not currently required for the purchasing pipeline.

## Domain rules

### Catalogue
Products contain arbitrary option dimensions. Sellable variants own SKU, barcode, price, cost and tax classification. Modifiers/add-ons are separate from variant dimensions. Products are archived/restored rather than deleted when commercial use ends, so historical snapshots and tracked stock remain visible.

Inactive/archived variants remain available to historical and stock-control read models but are excluded from new orders, new POs, low-stock attention and replenishment planning.

Bulk archive/restore uses the same semantics as the single-record workflow. Up to 200 unique product IDs are verified before mutation, then every product status and variant active flag is changed in one tenant transaction with per-product audit parity. A missing or duplicate selection rejects the batch rather than allowing a partial result.

### Catalogue CSV onboarding
Catalogue import is deliberately **create-only** rather than an ambiguous bulk-upsert mechanism.

The supported flow is:

`CSV parse -> tenant dry-run -> explicit human review -> fingerprint check -> one SQLite transaction`

A CSV can create new products/variants/categories/suppliers, arbitrary option values, supplier mappings and opening stock at an already-existing location code. Location typos fail validation rather than silently creating warehouses.

The browser parser is convenience only. The TenantStore validates the complete structured payload again against live tenant state. Dry-run returns line-numbered errors/warnings and an exact create plan. Commit must echo the reviewed fingerprint; OrderMate rebuilds the plan against current tenant state and rejects stale previews before mutation.

The commit path then writes all catalogue records, supplier mappings, opening inventory levels, immutable opening-stock movements and one audit summary inside a single `transactionSync`. Any invariant/write failure rolls back the whole import.

### Inventory
Inventory is per variant and location. `on_hand`, `reserved` and derived `available` are tracked. Incoming stock is derived from submitted purchase orders. Every physical change creates an immutable inventory movement.

A product/location cross-product is not automatically a stock position. The read model distinguishes never-stocked (`tracked=0`) from tracked zero stock. Low-stock alerts and replenishment only act on genuine tracked positions. Archived variants with physical stock remain visible for control/traceability but are excluded from active planning.

### Cycle counts
Cycle count is a reviewed **partial stocktake**, not a destructive full-location overwrite.

The operator selects one active location and explicitly counts only the SKUs physically checked. Blank means “not counted; do not touch”. Zero is an explicit reviewed physical count and may establish a never-stocked SKU/location pair as tracked zero stock.

For each counted line the client retains the on-hand/reserved snapshot visible when that SKU entered the count. Commit submits both the reviewed snapshot and physical count. The TenantStore rechecks every line against live stock before any mutation; if on-hand or reserved stock changed, the whole batch is rejected as stale.

A count may never reduce on-hand below currently reserved stock. Successful counts update all reviewed levels in one `transactionSync`, create immutable `stocktake` movements only for non-zero variances under one stocktake reference, and write one tenant audit summary. A zero-variance count may deliberately establish tracking without inventing a quantity movement.

Cycle-count permissions are intentionally narrower than generic inventory updates: Owner, Admin, Manager and Inventory may commit reviewed counts. Fulfilment cannot reconcile physical stock merely because it can perform fulfilment-related inventory updates.

### Warehouse operations
Warehouse scanning is a client-side staging workflow over the canonical order/PO lifecycle endpoints; it is not a second inventory engine.

Pick & Fulfil is available to fulfilment-capable roles. Receive Stock is available to purchasing/inventory-capable roles. USB/Bluetooth keyboard-wedge scanners and manual barcode entry feed deterministic exact-barcode counting. Wrong items, ambiguous duplicate barcodes and scans beyond the document's outstanding quantity are rejected before submission. Products without a barcode can be corrected manually with bounded +/- controls.

Mobile camera scanning uses lazy-loaded ZXing rather than the browser-native `BarcodeDetector` API. Camera mode captures one confirmed barcode per camera session to avoid repeated frames accidentally staging multiple units, and all media tracks are released on success, close and unmount. Camera frames never leave the browser.

Scanned quantities do not change business data. The operator must explicitly commit them through the existing `/orders/:id/fulfil` or `/purchase-orders/:id/receive` transaction. Those endpoints remain responsible for reservation rules, over-receipt protection, immutable inventory movements and audit attribution.

The sales pick queue consumes explicit order-planning metadata but does not mutate it. Queue order is deterministic: `urgent -> high -> normal -> low`, then earliest `required_by_date`, then oldest order. Overdue required-by dates are visual/attention signals, not new order states.

### Purchasing
Suppliers own purchase orders. PO lines snapshot supplier references, unit cost and tax. Partial receiving is supported and receiving creates inventory movements. Purchase-order cancellation removes only outstanding incoming commitment; it never reverses already received physical stock.

`supplier_variants` maps supplier SKU, latest known cost and lead time onto stable OrderMate variant identities.

Supplier-code learning is human-reviewed. When a purchase-document proposal contains a supplier SKU, the reviewer may explicitly choose to remember that code only after confirming the supplier and OrderMate variant. Existing different codes are not silently replaced. A supplier code already owned by another variant is rejected both in the review UX and by the canonical supplier-mapping endpoint.

### Purchase-order expected delivery
Schema v3 adds nullable `purchase_orders.expected_delivery_date` plus an index for operational due-date queries.

An operator may set or clear the expected date while a PO is draft, ordered or partially received. Manual changes are audited. Received/cancelled purchase orders are closed to expected-date edits.

If no manual date is present when a draft PO is submitted, OrderMate derives one only when **every PO line** has a supplier-specific lead-time mapping. It uses the maximum mapped lead time so a multi-line PO is not declared overdue before its slowest known item is expected. If any line lacks lead-time coverage, expected delivery remains unset rather than presenting false precision.

Expected delivery is an operational projection, not a lifecycle state. An open PO whose expected date is before the current UTC calendar date is surfaced as overdue in purchasing and attention views while its canonical status remains `ordered` or `partially_received`.

### Replenishment planning
Replenishment is deterministic and human-approved. It uses available/reserved stock, incoming submitted POs, fulfilled demand over the last 30 days and supplier lead time.

Schema v2 adds sparse `inventory_policies` per variant/location. Absence of a row means use workspace defaults. A custom policy may override reorder point, target stock at expected supplier arrival and preferred mapped supplier.

Preferred supplier lead time drives the same recommendation that is handed into draft-PO review. Custom target stock is interpreted as the desired stock position **at supplier arrival**, so forecast lead-time demand is included in the recommended order quantity.

Recommendations never create a purchasing commitment automatically. They only pre-fill a draft PO for explicit commercial review.

### AI purchasing-document intake
The supplier purchase-document path is deliberately proposal-based:

`EU R2 source -> Queue -> Cloudflare document conversion -> Workers AI JSON extraction -> deterministic matching -> R2 proposal -> human review -> normal draft PO`

Rules:

1. source document text is treated as untrusted data;
2. model output is constrained to a strict JSON shape and validated again with Zod;
3. matching is deterministic and explainable: exact normalized supplier identity, supplier SKU, barcode or OrderMate SKU only;
4. ambiguous data remains unmatched for the reviewer;
5. raw converted Markdown is not persisted;
6. source document and structured proposal remain in tenant-prefixed R2;
7. AI never submits a PO, receives stock, adjusts inventory or fulfils an order; and
8. reviewed proposals create standard draft POs through the same canonical endpoint as manual entry.

Currency mismatch is a hard block for AI-assisted draft creation. Image conversion is considered best-effort and is always flagged for explicit review.

### AI delivery-note assistance and discrepancy control
Delivery notes use the same trust boundary but are anchored to one existing open purchase order:

`EU R2 delivery note -> Queue -> identifier/quantity extraction -> exact selected-PO matching -> R2 proposal -> human review -> staged Warehouse counts -> canonical PO receipt`

The extraction prompt ignores prices/tax and only asks for document references, product identifiers and physically delivered quantities. Conflicting identifiers, unknown lines, wrong PO references, image extraction and over-delivery force review. Suggested quantities are capped to the selected PO's outstanding quantity.

A reviewed proposal only pre-fills Warehouse receiving counts. The canonical PO receiving transaction validates live outstanding quantities before stock moves.

Schema v4 persists only meaningful operational discrepancies: wrong PO reference, unexpected/over-delivered lines, or physical quantity different from the reviewed document proposal. Normal matching partial deliveries do not create noise. R2 remains immutable source evidence; the tenant discrepancy record owns open/resolved workflow and an audited resolution code/note. Resolving a discrepancy never rewrites stock or the PO.

### Orders and fulfilment planning
Order lines snapshot product/variant/SKU, price, tax and selected modifiers. Confirmation creates reservations. Partial fulfilment consumes only the quantity leaving the location and retains the outstanding reservation. Cancellation releases outstanding reservations. Returns are independent events and may optionally restock.

Schema v6 adds nullable `orders.required_by_date` plus `orders.priority` (`low`, `normal`, `high`, `urgent`, default `normal`). These are explicit operational/customer commitments; OrderMate does not infer a required-by date.

Owner/Admin/Manager may update planning metadata while an order is open. Fulfilment keeps lifecycle execution rights but cannot change order commitments. Invalid calendar dates and edits to completed/cancelled orders are rejected. Changes are audited with previous/new values.

Overdue required-by confirmed orders are critical attention items; urgent non-overdue orders are explicit warnings. Search and order CSV export carry both fields.

### Saved operational views
Schema v5 stores saved Inventory/Purchasing filters in the tenant database, keyed by `owner_actor_id`. They are personal workspace preferences, not tenant business mutations, and therefore are not written to the audit ledger.

Every list/create/delete operation derives the owner from authenticated actor context. Users in the same business cannot list or delete another user's saved views, even with a guessed UUID. Config JSON is page-specific and server-validated instead of accepting arbitrary state.

### Deterministic operations reporting
Operations Reports are read-only aggregates over canonical tenant SQLite data. There is no analytics shadow database and no AI-generated metric layer.

The report supports 7/30/60/90-day windows and includes inventory at cost, available/reserved/incoming units, low-stock/stockout counts, gross confirmed/completed order value, physical fulfilment/returns/receipts, pro-rated outstanding PO commitment after partial receipts, overdue POs, stock valuation by location, top fulfilled SKUs and daily activity trends.

Because the report crosses inventory/orders/purchasing, it uses a dedicated `analytics:read` permission. Fulfilment retains ordinary dashboard/audit reads but does not gain purchasing analytics.

### Money and tax
All amounts are integer minor units. Each line stores net, tax and gross values plus the applied tax rate basis points. Tenant settings define default currency and whether catalogue prices are tax-inclusive.

## Security model

1. Google authenticates identity; Better Auth owns the application session.
2. The Worker reads the session from secure cookies.
3. Requested organization ID is only a selector.
4. The Worker verifies `member(user_id, organization_id)` in D1.
5. Static role permissions are checked server-side and unclassified tenant routes fail closed.
6. Catalogue import preview/commit are explicitly `catalogue:create`.
7. Cycle-count commit is explicitly `stocktake:create`; Fulfilment does not inherit it from inventory update permission.
8. Purchase-order expected-delivery edits are purchasing updates.
9. Order required-by/priority edits use dedicated `order_planning:update`; Fulfilment cannot redefine commitments.
10. Cross-domain commercial reports use `analytics:read`; Fulfilment does not receive it.
11. Saved views use a dedicated personal-preferences boundary and owner actor filtering inside the tenant object.
12. The Worker routes to the tenant's EU Durable Object and replaces all internal actor headers.
13. The tenant object records actor ID/role on business mutations.
14. R2 document/proposal keys are tenant-prefixed and document endpoints repeat membership/permission checks.
15. Custom mutations reject cross-site requests before business handlers run.
16. Queue logging is limited to event type/ID; source filenames, tenant IDs, user IDs and document contents are not logged.

Tests must cover guessed IDs, changed tenant headers, cross-tenant document keys, unauthorized roles, repeated/idempotent messages, deterministic document matching, Warehouse scan/urgency invariants, cycle-count stale/atomicity guarantees, PO due-date controls, order-planning controls, archive/restore invariants, migration upgrades, saved-view privacy and catalogue-import stale/atomicity guarantees.

## Schema evolution

Tenant storage is currently schema version **6**.

The final exported `TenantStore` runs an ordered versioning layer under the Durable Object initialization barrier. `_sql_schema_migrations` stores monotonically increasing applied migration IDs. Existing pre-tracker v1 tenant objects and fresh v1 objects are safely marked migration `1` only after all 25 baseline v1 tables are verified. A tenant whose stored migration version is newer than the running application fails closed instead of being interpreted by older code.

1. **v1** — verified baseline operational schema.
2. **v2** — `inventory_policies` and preferred-supplier index.
3. **v3** — nullable `purchase_orders.expected_delivery_date` plus due-date index. Column creation is replay-safe if DDL succeeded before bookkeeping.
4. **v4** — `delivery_discrepancies` plus PO/status indexes; table/index creation is idempotent.
5. **v5** — actor-private `saved_views` with owner/page index and case-insensitive per-user/page naming.
6. **v6** — nullable `orders.required_by_date`, constrained `orders.priority` defaulting to `normal`, and open-order priority/due index. Column checks make replay safe when DDL exists but the migration marker does not.

Cloudflare Durable Objects do not support `PRAGMA user_version`, so OrderMate uses an explicit migration table.

Every future schema migration must:

1. live in the ordered tenant migration runner and have one monotonically increasing ID;
2. read the current applied migration version before changing schema;
3. perform schema/data mutation inside the Durable Object serialized boundary and record the migration only after success;
4. be covered by fresh-tenant and previous-version upgrade/replay tests; and
5. never require replacing a tenant Durable Object or copying live business data merely to deploy application code.

## Compliance posture

D1, Durable Objects and R2 are created/restricted for EU jurisdiction where supported. PII must not be placed in queue names, object keys, logs or analytics dimensions. Secrets are Wrangler secrets rather than source-controlled vars. Data export/deletion and configurable retention remain first-class requirements before public launch.

Workers AI needs an explicit distinction: it remains Cloudflare-hosted, but Cloudflare's current Data Localization compatibility documentation lists Workers AI as unsupported by Regional Services. Customer Metadata Boundary support does not mean inference itself is pinned to the EU. For that reason AI document extraction is disabled by default and must be intentionally enabled only after its processing posture is accepted for the product's compliance requirements.
