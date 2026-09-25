# OrderMate architecture

## Decision summary

OrderMate is a Cloudflare-native modular monolith. The browser talks to one Worker. Authentication and membership are global; operational business data is physically isolated per tenant.

### Control plane
`CONTROL_DB` is a D1 database restricted to the EU jurisdiction. Better Auth stores Google identities, sessions, organizations, members and workspace invitations here. The Worker derives the user from the session and verifies organization membership before any tenant request is routed.

### Tenant data plane
Each Better Auth organization ID maps deterministically to one `TenantStore` Durable Object via the EU-restricted subnamespace. Its embedded SQLite database stores catalogue, locations, inventory ledger, suppliers, supplier/variant mappings, purchase orders, customers, orders, fulfilments, returns and tenant audit history.

This deliberately avoids a shared operational database. A programming mistake cannot accidentally query another tenant's product/order rows because those rows do not exist in the current tenant database.

SQLite-backed Durable Objects also serialize writes for a tenant. That is valuable for stock reservation, purchase receiving and fulfilment because competing mutations have a single consistency boundary.

### Storage and automation
R2 holds source documents, structured extraction proposals and future product media. Keys are tenant-prefixed and never include original filenames or other user-visible PII. Object access is only proxied after membership checks.

Cloudflare Queues carry asynchronous automation events. Messages contain a tenant ID plus immutable event ID and are treated as at-least-once delivery. Document extraction is idempotent because an existing final proposal sidecar prevents a retry from repeating inference. Failed messages receive bounded retries before Wrangler routes them to `ordermate-events-dead`.

Workers AI is an optional document-extraction processor, not a canonical business-data store. It is disabled by default with `AI_DOCUMENT_EXTRACTION_ENABLED=false`. Multi-step automation that eventually needs stronger durable orchestration may use Cloudflare Workflows, but Workflows are not currently required for the v1 purchasing pipeline.

## Domain rules

### Catalogue
Products contain arbitrary option dimensions. Sellable variants own SKU, barcode, price, cost and tax classification. Modifiers/add-ons are separate from variant dimensions. Products are archived/restored rather than deleted when commercial use ends, so historical snapshots and tracked stock remain visible.

### Inventory
Inventory is per variant and location. `on_hand`, `reserved` and derived `available` are tracked. Incoming stock is derived from submitted purchase orders. Every physical change creates an immutable inventory movement.

A product/location cross-product is not automatically a stock position. The read model distinguishes never-stocked (`tracked=0`) from tracked zero stock. Low-stock alerts and replenishment only act on genuine tracked positions. Archived variants with physical stock remain visible for control/traceability but are excluded from replenishment.

### Purchasing
Suppliers own purchase orders. PO lines snapshot supplier references, unit cost and tax. Partial receiving is supported and receiving creates inventory movements. Purchase-order cancellation removes only outstanding incoming commitment; it never reverses already received physical stock.

`supplier_variants` maps supplier SKU, latest known cost and lead time onto stable OrderMate variant identities. Replenishment uses the existing inventory/movement/PO data and these mappings to produce explainable suggestions. Suggestions never create purchasing commitments automatically: the user reviews a pre-filled draft PO.

### AI document intake
The purchasing document path is deliberately proposal-based:

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
6. The Worker routes to the tenant's EU Durable Object and replaces all internal actor headers.
7. The tenant object records actor ID/role on every mutation.
8. R2 document/proposal keys are tenant-prefixed and document endpoints repeat membership/permission checks.
9. Custom mutations reject cross-site requests before business handlers run.
10. Queue logging is limited to event type/ID; source filenames, tenant IDs, user IDs and document contents are not logged.

Tests must cover guessed IDs, changed tenant headers, cross-tenant document keys, unauthorized roles, repeated/idempotent messages, deterministic document matching and archive/restore invariants.

## Schema evolution contract

The initial release has no legacy tenant data to migrate, so a new `TenantStore` can safely bootstrap the complete v1 schema with idempotent `CREATE ... IF NOT EXISTS` statements.

That bootstrap is **not** the migration strategy for later releases. Before the first post-v1 schema change is shipped to production, tenant storage must gain an explicit monotonically increasing schema version and ordered, transactional migrations. A future migration must:

1. read the tenant's current schema version;
2. apply every missing migration in order inside the Durable Object's serialized execution boundary;
3. update the version only after the migration succeeds;
4. be covered by tests for both a fresh tenant and an upgrade from the previous schema version; and
5. never require replacing a tenant Durable Object or copying live business data merely to deploy application code.

This remains a merge gate for schema v2. New features must reuse the v1 schema or first implement this mechanism.

## Compliance posture

D1, Durable Objects and R2 are created/restricted for EU jurisdiction where supported. PII must not be placed in queue names, object keys, logs or analytics dimensions. Secrets are Wrangler secrets rather than source-controlled vars. Data export/deletion and configurable retention remain first-class requirements before public launch.

Workers AI needs an explicit distinction: it remains Cloudflare-hosted, but Cloudflare's current Data Localization compatibility documentation lists Workers AI as unsupported by Regional Services. Customer Metadata Boundary support does not mean inference itself is pinned to the EU. For that reason AI document extraction is disabled by default and must be intentionally enabled only after its processing posture is accepted for the product's compliance requirements.
