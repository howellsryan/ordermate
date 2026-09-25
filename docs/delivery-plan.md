# Delivery plan

## Goal
Ship an excellent general-purpose order and inventory SaaS whose core operations are trustworthy, with automation layered on top as reviewable proposals rather than a second source of business truth.

## Current implementation status
The rebuild branch now contains the complete v1 operational backbone plus the first automation advantages:

- Cloudflare-native multi-tenant platform, Google auth, memberships/RBAC and audit attribution.
- Products, arbitrary variants/options, modifiers, SKU/barcode, suppliers/customers and safe catalogue retirement.
- Multi-location inventory, immutable movements, adjustments/transfers and tracked-vs-never-stocked semantics.
- Purchase orders, partial receiving, cancellation and supplier/variant mappings.
- Orders, reservation, partial/full fulfilment, cancellation and returns/restock.
- Search, exception inbox, record details, activity/audit and CSV export.
- Explainable replenishment recommendations that only pre-fill reviewable draft POs.
- Supplier purchase-document extraction -> deterministic matching -> human-reviewed draft PO.
- Dedicated Warehouse workspace for barcode-driven Pick & Fulfil and Receive Stock.
- Delivery-note extraction anchored to an existing PO -> exception review -> staged Warehouse receipt quantities -> canonical audited receiving transaction.
- Explicit versioned Durable Object tenant-schema migration tracking before any v2 domain schema change.

The branch remains draft until dependency installation, typecheck, tests and production build are run as the final verification gate.

## Phase 0 — platform foundation
**Delivered on the rebuild branch.**

- Cloudflare Worker + React/Vite application.
- Google OAuth / Better Auth.
- Organization membership and static RBAC.
- EU D1 control plane and EU tenant Durable Objects.
- EU R2 documents plus Queue/DLQ automation path.
- Tenant audit framework.
- Ordered tenant schema-version migration runner.

## Phase 1 — catalogue and stock
**Delivered, including warehouse barcode workflows.**

- Products, arbitrary option dimensions and variants.
- SKU/barcode, tax, costs and prices.
- Locations, stock ledger, adjustment and transfers.
- Non-destructive catalogue archive/restore.
- Keyboard-wedge barcode lookup.
- Dedicated Pick & Fulfil and PO Receiving scan workflows with wrong-item/over-scan protection.

Native browser `BarcodeDetector` is intentionally not the production camera implementation because its browser support is not reliable enough for iOS/Safari. Camera scanning should use a deliberately selected cross-browser decoder when that dependency is introduced.

## Phase 2 — purchasing
**Delivered for the v1 operational model.**

- Suppliers and supplier references.
- Supplier-to-variant SKU/cost/lead-time mappings.
- Draft/submitted purchase orders.
- Partial receiving and receiving history.
- Incoming-stock visibility.
- Purchase-order cancellation without rewriting already received stock.

## Phase 3 — order lifecycle
**Delivered for v1.**

- Customers and draft orders.
- Confirmation/reservation.
- Partial/full fulfilment.
- Cancellation, return and optional restock.
- Tax snapshots and immutable commercial history.
- Warehouse picking layered over the canonical fulfilment endpoint.

## Phase 4 — operational polish
**Substantially delivered; final verification/polish remains.**

- Dense but calm dashboard.
- Global tenant search and operational exception inbox.
- Record detail views and audit/activity timeline.
- CSV export.
- Responsive/keyboard-accessible dialogs and mobile warehouse workflows.
- Role-aware surfaces.

Remaining before production readiness:

1. run dependency installation, typecheck, full tests and production build;
2. complete final accessibility/browser/responsive review against Agent-Template gates;
3. correct any issues revealed by real runtime/browser verification;
4. establish production backup/recovery, retention/export/deletion procedures; and
5. commit the generated lockfile and deployment runbook evidence.

## Phase 5 — automation advantage
The first three high-value automation paths are now implemented with the same rule: AI may propose structured evidence; deterministic application code and a human decide what is committed.

### Delivered
1. **Supplier PO intake** — PDF/image -> Cloudflare conversion/extraction -> exact supplier/SKU/barcode/internal-SKU matching -> human review -> draft PO.
2. **Delivery-note assistance** — source document tied to one open PO -> delivered quantity extraction -> exact selected-PO matching -> shortages/overages/unmatched evidence -> human review -> staged Warehouse counts -> normal PO receipt.
3. **Replenishment** — available/reserved/incoming stock + 30-day fulfilment demand + supplier lead time -> explainable suggestion -> reviewable draft PO.
4. **Exception inbox** — stockouts/low stock, fulfilment work and incoming/partial PO attention.

### Next candidates
1. Cross-browser mobile camera barcode scanning using a production-grade decoder rather than unsupported native-only detection.
2. Supplier SKU alias learning from confirmed human mappings (never silent model-selected identities).
3. Replenishment policy controls per variant/location once a v2 schema migration is justified.
4. Delivery-note discrepancy workflow/history if businesses need formal shortage/overage resolution beyond proposal evidence.
5. Saved operational views/bulk workflows and import tooling.
6. Forecasting/anomaly detection only after deterministic demand/reorder behaviour has enough trustworthy production history.

## Out of scope for the initial MVP
Customer storefront, payment processing, carrier integrations, lots/batches/serials/manufacturing, marketplace/e-commerce integrations and autonomous AI business mutations.
