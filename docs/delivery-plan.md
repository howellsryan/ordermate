# OrderMate delivery plan

## Product direction

OrderMate is being rebuilt as a Cloudflare-native operational SaaS for businesses that need catalogue, order, purchasing and inventory control. The product deliberately starts broad rather than assuming one retail vertical, but its core is designed for multi-location physical-stock operations.

Canonical business mutations remain deterministic, transactional and auditable. AI is an evidence-extraction/proposal layer only.

## Platform constraints

- Cloudflare hosts the application runtime and durable application data.
- Wrangler owns deployable infrastructure/configuration.
- Google is the OAuth identity provider only.
- No AWS/Neon/Vercel/Supabase/other hosted runtime/database dependency is part of the architecture.
- Tenant operational data is physically isolated in one EU-jurisdiction SQLite Durable Object per business.
- D1 is the identity/session/organization control plane.
- R2 stores source documents/proposals.
- Queues provide asynchronous event handling; bounded failures go to a DLQ.
- Workers AI remains optional and disabled by default pending explicit compliance acceptance.

## Delivered vertical slices

### Foundation
- React/Vite + Hono Worker deployment shape.
- Better Auth Google OAuth.
- D1 organizations/members/invites.
- per-business Durable Object storage.
- role-based server authorization and role-aware UI.
- cross-site mutation protection, masked API 5xx responses and tenant-scoped actor attribution.
- ordered Durable Object schema migrations with verified v1 baseline and replay-safe evolution through **v6**.

### Catalogue
- products/categories/modifiers.
- arbitrary option dimensions + generated variants.
- SKU/barcode/price/cost/tax.
- audited product editing.
- archive/restore without historical deletion.
- atomic bulk archive/restore.
- reviewed create-only CSV onboarding with server dry-run/fingerprint/atomic commit.

### Inventory
- multi-location stock.
- on-hand/reserved/available/incoming.
- immutable movement ledger.
- adjustments/transfers/barcode lookup.
- tracked-zero vs never-stocked semantics.
- partial stocktake/cycle count with stale-snapshot and reservation protection.

### Purchasing
- suppliers and supplier/variant mapping.
- draft/submitted POs, partial receive/cancel.
- expected-delivery dates with conservative supplier-lead-time derivation.
- overdue operational visibility.
- deterministic replenishment + per-SKU/location policies.
- supplier SKU learning only from explicit human review.
- delivery discrepancy open/resolved lifecycle.

### Orders
- customers.
- snapshot-based draft orders.
- confirmation/reservation and oversell protection.
- partial/full fulfilment.
- cancellation/release.
- returns with optional restock.
- schema-v6 explicit `required_by_date` + `low/normal/high/urgent` priority.
- dedicated order-planning RBAC: warehouse fulfilment can execute work without redefining customer/operational commitments.
- deterministic urgency-aware Warehouse picking.

### Warehouse
- dedicated Pick & Fulfil and Receive Stock workspace.
- hardware/manual barcode input.
- lazy-loaded ZXing mobile camera scanning.
- exact document-aware scan validation and bounded counts.
- delivery-note-assisted receiving remains a reviewed staging step before canonical receipt.
- cycle counting available as a separate reviewed reconciliation workflow.

### Operations UX
- global search.
- role-aware attention inbox.
- record detail views.
- searchable audit history and permission-checked CSV export.
- actor-private cross-device saved views for Inventory/Purchasing.
- deterministic 7/30/60/90-day Operations Reports with separate commercial `analytics:read` authorization.
- order priority/required-by shown in Orders, detail, Warehouse, search, attention and exports.

### Document automation
- purchase source upload to EU R2.
- Queue + Workers AI extraction when compliance flag is enabled.
- strict structured proposal validation.
- deterministic exact supplier/SKU/barcode/internal-SKU matching.
- human-reviewed draft PO creation.
- delivery-note proposal anchored to one existing PO.
- no autonomous PO/stock/order mutation.

## Current schema evolution

1. **v1** verified baseline operational schema.
2. **v2** `inventory_policies`.
3. **v3** `purchase_orders.expected_delivery_date` + index.
4. **v4** `delivery_discrepancies`.
5. **v5** actor-private `saved_views`.
6. **v6** `orders.required_by_date`, constrained `orders.priority`, open-order planning index.

Future schema changes must remain ordered, replay-safe and covered by fresh + previous-version upgrade tests.

## Next delivery priorities

### 1. Batch/wave picking
Goal: reduce repeated walking and scanning when several confirmed orders can be picked together.

Safety boundary:
- grouping/aggregate pick counts are operational staging only;
- each order remains the canonical unit of reservation and fulfilment;
- a wave must never create a new inventory mutation path;
- fulfilment submissions still go through existing `/orders/:id/fulfil` transactions;
- partial failure must remain visible per order rather than pretending the whole wave is atomic when it is not.

### 2. Onboarding/commercial hardening
- stronger first-workspace empty states and guided setup.
- clearer location/catalogue/supplier setup sequencing.
- optional template/sample data path without contaminating real tenant records.

### 3. Production readiness gate
- install pinned dependency graph and commit lockfile.
- typecheck.
- Cloudflare/Vitest runtime tests.
- production build.
- responsive/accessibility review.
- security review for authorization, CSP/headers, secrets/logging and cross-tenant IDs.
- migration replay verification.
- Cloudflare bootstrap/deployment only after runtime verification is green.

## Deferred product areas

Not part of the current operational MVP unless explicitly reprioritized:

- customer storefront;
- payment processing;
- carrier/shipping and marketplace integrations;
- batches/lots/serials/expiry/manufacturing;
- destructive existing-catalogue bulk-update imports;
- autonomous AI business mutations;
- production opt-in to Workers AI inference.

## Verification status

Implementation continues before the final verification pass. Do not describe the branch as merge-ready until these have actually passed:

```sh
npm install
npm run typecheck
npm test
npm run build
```

The generated `package-lock.json` must be committed before production deployment.
