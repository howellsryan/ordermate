# Delivery plan

## Goal
Ship an excellent general-purpose order and inventory SaaS whose core operations are trustworthy, with automation layered on top as reviewable proposals rather than a second source of business truth.

## Current implementation status
The rebuild branch now contains the complete operational backbone plus schema-v3 purchasing/planning controls and the first automation/onboarding advantages:

- Cloudflare-native multi-tenant platform, Google auth, memberships/RBAC and audit attribution.
- Products, arbitrary variants/options, modifiers, SKU/barcode, suppliers/customers and safe catalogue retirement.
- Multi-location inventory, immutable movements, adjustments/transfers, cycle counts and tracked-vs-never-stocked semantics.
- Purchase orders, expected delivery dates, overdue visibility, partial receiving, cancellation and supplier/variant mappings.
- Orders, reservation, partial/full fulfilment, cancellation and returns/restock.
- Search, exception inbox, record details, activity/audit and CSV export.
- Explainable replenishment recommendations plus per-SKU/location custom rules.
- Supplier purchase-document extraction -> deterministic matching -> human-reviewed draft PO.
- Human-reviewed supplier SKU learning from document proposals with canonical ambiguity protection.
- Dedicated Warehouse workspace for barcode-driven Pick & Fulfil and Receive Stock.
- Cross-browser mobile camera barcode capture using lazy-loaded ZXing.
- Delivery-note extraction anchored to an existing PO -> exception review -> staged Warehouse receipt quantities -> canonical audited receiving transaction.
- Atomic create-only catalogue CSV onboarding with dry-run, stale-preview fingerprinting, supplier mappings and opening-stock ledger movements.
- Reviewed partial cycle counts with stale-stock protection, reservation safeguards and atomic variance movements.
- Explicit ordered Durable Object tenant-schema migrations, currently schema v3.

The branch remains draft until dependency installation, typecheck, tests and production build are run as the final verification gate.

## Phase 0 — platform foundation
**Delivered on the rebuild branch.**

- Cloudflare Worker + React/Vite application.
- Google OAuth / Better Auth.
- Organization membership and static RBAC.
- EU D1 control plane and EU tenant Durable Objects.
- EU R2 documents plus Queue/DLQ automation path.
- Tenant audit framework.
- Ordered tenant schema-version migration runner with tested v1 -> v2 -> v3 upgrades.

## Phase 1 — catalogue and stock
**Delivered, including onboarding, stocktake and warehouse barcode workflows.**

- Products, arbitrary option dimensions and variants.
- SKU/barcode, tax, costs and prices.
- Locations, stock ledger, adjustment and transfers.
- Non-destructive catalogue archive/restore.
- Keyboard-wedge barcode lookup.
- Dedicated Pick & Fulfil and PO Receiving scan workflows with wrong-item/over-scan protection.
- Mobile camera scanning through a production decoder rather than native-only `BarcodeDetector`.
- Reviewed CSV catalogue onboarding: products/variants/categories/suppliers/options/opening stock in one atomic tenant transaction.
- First-class Cycle Count workspace: partial counts only touch explicitly reviewed SKUs; zero is distinct from uncounted; hardware/manual/camera entry is supported.
- Cycle-count commit checks the reviewed on-hand/reserved snapshot immediately before one atomic transaction, blocks counts below reserved stock, writes variance movements under one stocktake reference and records an audit summary.
- A counted never-stocked SKU can intentionally establish a tracked zero position without inventing a quantity movement.

## Phase 2 — purchasing
**Delivered for the current operational model.**

- Suppliers and supplier references.
- Supplier-to-variant SKU/cost/lead-time mappings.
- Draft/submitted purchase orders.
- Partial receiving and receiving history.
- Incoming-stock visibility.
- Purchase-order cancellation without rewriting already received stock.
- Deterministic replenishment recommendations.
- Sparse per-variant/location reorder point, arrival target and preferred supplier policy.
- Reviewed supplier-code learning: extracted supplier SKUs can be remembered only after a user confirms supplier + variant; replacements require explicit opt-in and conflicting mappings are rejected server-side.
- Expected delivery dates on purchase orders with manual override.
- At submission, OrderMate derives an expected date only when every PO line has a lead-time mapping for that supplier, using the slowest mapped line; incomplete coverage deliberately leaves the date unset rather than inventing precision.
- Overdue open POs are surfaced in the PO list, detail view, operational attention inbox, search context and exports without introducing a second lifecycle state.

## Phase 3 — order lifecycle
**Delivered for v1.**

- Customers and draft orders.
- Confirmation/reservation.
- Partial/full fulfilment.
- Cancellation, return and optional restock.
- Tax snapshots and immutable commercial history.
- Warehouse picking layered over the canonical fulfilment endpoint.

## Phase 4 — operational polish
**Substantially delivered; final runtime/browser verification remains.**

- Dense but calm dashboard.
- Global tenant search and operational exception inbox.
- Record detail views and audit/activity timeline.
- CSV export.
- Responsive/keyboard-accessible dialogs and mobile warehouse workflows.
- Role-aware surfaces.
- Create-only CSV onboarding with browser parse, tenant dry-run, line-numbered issues and explicit reviewed commit.
- Responsive cycle-count workflow with counted-item prioritisation, live variance review and locked commit state.
- Purchase-order expected-arrival/overdue signals that remain separate from canonical PO status.

Remaining before production readiness:

1. run dependency installation, typecheck, full tests and production build;
2. complete final accessibility/browser/responsive review against Agent-Template gates;
3. correct any issues revealed by real runtime/browser verification;
4. establish production backup/recovery, retention/export/deletion procedures; and
5. commit the generated lockfile and deployment runbook evidence.

## Phase 5 — automation advantage
The first high-value automation paths are implemented with the same rule: AI may propose structured evidence; deterministic application code and a human decide what is committed.

### Delivered
1. **Supplier PO intake** — PDF/image -> Cloudflare conversion/extraction -> exact supplier/SKU/barcode/internal-SKU matching -> human review -> draft PO.
2. **Reviewed supplier SKU learning** — a human-confirmed supplier+variant may remember the extracted supplier code for future exact matching; conflicting or replacement mappings remain explicit.
3. **Delivery-note assistance** — source document tied to one open PO -> delivered quantity extraction -> exact selected-PO matching -> shortages/overages/unmatched evidence -> human review -> staged Warehouse counts -> normal PO receipt.
4. **Replenishment** — available/reserved/incoming stock + 30-day fulfilment demand + supplier lead time + optional custom policy -> explainable suggestion -> reviewable draft PO.
5. **Exception inbox** — stockouts/low stock, fulfilment work, incoming/partial POs and overdue expected deliveries.

### Next candidates
1. Formal delivery-note discrepancy history/closure if businesses need persistent shortage/overage workflows beyond proposal evidence.
2. Saved operational views and bulk actions.
3. Existing-catalogue bulk update/import as a separately explicit destructive workflow rather than weakening create-only onboarding.
4. Forecasting/anomaly detection only after deterministic demand/reorder behaviour has enough trustworthy production history.
5. Storefront and integration architecture once the internal operating core has passed production hardening.

## Out of scope for the initial MVP
Customer storefront, payment processing, carrier integrations, lots/batches/serials/manufacturing, marketplace/e-commerce integrations and autonomous AI business mutations.
