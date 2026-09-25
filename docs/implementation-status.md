# OrderMate implementation status

This document records what is implemented on `rebuild/cloudflare-saas` before the deferred verification pass. It is not a substitute for `npm run typecheck`, `npm test` and `npm run build`.

## Platform and tenancy

- Cloudflare Worker + React/Vite modular monolith.
- Better Auth with Google sign-in.
- D1 control plane for users, sessions, organizations, members and workspace invites.
- One EU-jurisdiction SQLite-backed `TenantStore` Durable Object per business.
- EU R2 source-document storage and Cloudflare Queue/DLQ event bindings.
- Server-side membership verification and static RBAC on tenant routes.
- Role-aware UI for Owner, Admin, Manager, Inventory, Fulfilment and Viewer.
- Cross-origin custom API mutations rejected at the public Worker boundary.
- Unexpected custom API 5xx responses masked before leaving the Worker.
- Ordered tenant schema migrations with v1 baseline verification through schema v6.
- Schema v2 adds `inventory_policies`; v3 adds PO expected-delivery; v4 adds delivery discrepancies; v5 adds actor-private saved operational views; v6 adds order `required_by_date` and `priority` planning metadata.

## Catalogue and onboarding

- Products and categories.
- Arbitrary option dimensions and generated sellable variants.
- SKU, barcode, price, cost and tax per variant.
- Reusable modifiers/add-ons kept separate from variant identity.
- Audited editing of product name/category/description and live variant commercial/identifier fields.
- Non-destructive archive/restore with archived items removed from new order/PO/replenishment selection while tracked stock/history remains visible.
- Atomic bulk archive/restore for up to 200 unique products; every selected product is verified before mutation and per-product audit parity is retained.
- Historical order pricing and names remain snapshot-based after catalogue edits.
- Create-only CSV onboarding for products, variants, arbitrary option columns, categories, suppliers, supplier mappings and opening stock.
- CSV flow uses browser parsing for UX, server-side dry-run against live tenant state, reviewed fingerprinting and one atomic SQLite commit.
- Opening stock from imports creates immutable inventory movements tied to an import reference and one tenant audit event.

## Inventory and warehouse

- Multiple stock locations.
- On-hand, reserved, available and derived incoming quantities.
- Audited stock adjustments and transfers.
- Immutable inventory movement ledger.
- Searchable stock-history UI showing signed quantity, item/SKU, location, movement type, reason/reference, actor and timestamp.
- Barcode lookup workflow.
- Dedicated Warehouse Pick & Fulfil and Receive Stock workflows.
- USB/Bluetooth keyboard-wedge scanning, manual barcode entry and lazy-loaded ZXing mobile camera capture.
- Wrong-item, ambiguous-barcode and over-scan protection before canonical fulfil/receive submission.
- Warehouse pick queue is deterministic and urgency-aware: priority first (`urgent`, `high`, `normal`, `low`), then earliest required-by date, then oldest order.
- Required-by overdue and urgent orders are visibly explained in the queue; queue ordering never mutates order or stock state.
- First-class Cycle Count workspace for reviewed partial stocktakes.
- Counted SKUs retain the reviewed on-hand/reserved snapshot; stale stock changes reject the whole batch before mutation.
- Counts below active reservations are blocked; uncounted rows are untouched; explicit zero can establish a tracked zero position.
- Successful cycle counts write all variances under one stocktake reference plus one audit summary in a single tenant transaction.
- Cycle-count mutation has a dedicated RBAC boundary: Owner/Admin/Manager/Inventory only.
- Oversell prevention and reservation release on order cancellation.

## Purchasing and planning

- Suppliers.
- Supplier-to-variant SKU/cost/lead-time mappings.
- Draft/submitted purchase orders.
- Cost/tax snapshots and tenant-local PO numbering.
- Partial receiving with inventory movements and incoming-stock visibility.
- Purchase-order cancellation without reversing already received stock.
- PO detail view and receiving history.
- Schema-v3 `expected_delivery_date` on purchase orders plus due-date index.
- Manual expected-delivery editing is audited and remains available while a PO is open.
- Submission derives an expected date only when every ordered line has a supplier lead-time mapping for that supplier, using the slowest mapped line; incomplete coverage leaves the date unset.
- Open overdue POs are highlighted in purchasing and promoted to critical operational attention while their canonical status remains `ordered` / `partially_received`.
- Expected dates are included in purchase-order search context and CSV exports.
- Deterministic replenishment using available/reserved/incoming stock, 30-day fulfilment demand and supplier lead time.
- Schema-v2 sparse replenishment policies per variant/location for reorder point, arrival target and preferred mapped supplier.
- Supplier purchase-document inbox and AI-assisted proposal path with exact deterministic matching and human-reviewed draft-PO creation.
- Reviewed proposal lines may explicitly remember supplier SKU mappings for future exact matching; replacements require opt-in and ambiguity is rejected both in the UI and canonical mapping endpoint.
- Delivery-note assistance tied to an existing PO, with discrepancy review and staged Warehouse quantities before canonical receipt.
- Schema-v4 persistent delivery discrepancies for concrete reviewed differences such as wrong PO references, unexpected/over-delivered lines and operator/document quantity mismatches.
- Discrepancies have an open/resolved lifecycle, immutable proposal evidence reference, explicit resolution code/note and audited resolution; resolving never rewrites stock or the PO.

## Orders

- Customers.
- Draft order creation with commercial snapshots and modifiers.
- Confirmation and stock reservation.
- Partial/full fulfilment.
- Cancellation and reservation release.
- Returns with optional restock.
- Read-only line-detail view including fulfilled/returned quantities.
- Schema-v6 order planning metadata: `required_by_date` plus explicit `low` / `normal` / `high` / `urgent` priority.
- Owner/Admin/Manager may edit planning metadata while an order is open; Fulfilment can execute order lifecycle operations but cannot change customer/operational commitments.
- Required-by and priority edits are audited and reject invalid calendar dates or closed orders.
- Order detail and order-list UI expose the planning state and overdue signal.
- Global search, attention and CSV export carry priority/required-by data.
- Overdue required-by confirmed orders become critical attention items; urgent non-overdue orders are explicitly highlighted without creating another lifecycle state.

## Operational UX

- Global tenant-scoped search with Cmd/Ctrl+K.
- Operational attention inbox for low/zero stock, urgency-aware fulfilment work, incoming/overdue purchase orders and unresolved delivery discrepancies.
- First-class Activity & Data workspace.
- Searchable/filterable audit history.
- Permission-checked CSV exports for catalogue, inventory, orders, POs, customers, suppliers, delivery discrepancies and audit data.
- First-class Operations Reports for 7/30/60/90-day windows: stock-at-cost, availability/reservations/incoming, gross confirmed/completed order value, physical fulfilment/returns/receipts, outstanding PO commitment, overdue purchasing, location valuation and top fulfilled SKUs.
- Commercial Operations Reports use a separate `analytics:read` permission so Fulfilment keeps audit access without gaining purchasing analytics.
- Schema-v5 saved operational views are private to the signed-in actor inside the business and persist across devices.
- Inventory saved views support query/location/stock-state filters; Purchasing supports query/supplier/status/due-state filters.
- Accessible focus-trapped dialogs with Escape handling and focus restoration.
- Responsive role-aware navigation and mutation controls.
- Human-review UI for document proposals, delivery-note proposals, replenishment policy and CSV onboarding.
- Mobile-capable cycle counting with barcode/camera input, live variance review and commit-state locking.
- Expected-delivery editing and overdue highlighting in purchasing/detail UI.
- Required-by/priority editing and urgency-aware Warehouse pick ordering for sales orders.

## Regression coverage added

Cloudflare runtime/unit tests cover or specify:

- physical tenant data isolation;
- reservation and oversell behavior;
- cancellation release;
- partial fulfilment;
- PO partial receiving and cancellation;
- purchase receipt movements;
- purchase-order expected-delivery derivation, manual override, incomplete lead-time coverage, closed-PO edit rejection and audit metadata;
- barcode lookup and scan-count invariants;
- tenant-local numbering;
- RBAC route classification and fail-closed unknown routes;
- immutable adjustment/transfer movement history;
- catalogue edits and archive/restore preserving history;
- atomic bulk product archive/restore, missing-ID rollback, duplicate selection rejection and audit parity;
- document and delivery-note deterministic matching;
- persistent delivery-discrepancy idempotency, history, resolution and audit behavior;
- human-reviewed supplier SKU learning decisions and server-side supplier-code uniqueness;
- schema migration v1 -> v2 -> v3 -> v4 -> v5 -> v6, including replay-safe later migrations;
- saved-view validation, same-tenant user isolation and guessed-ID delete protection;
- policy-driven replenishment and arrival-target semantics;
- catalogue import dry-run validation, fingerprint changes, atomic commit, opening stock movements and stale-preview rejection;
- cycle-count atomic variance commits, stale-snapshot rejection, reservation protection, tracked-zero establishment and audit history;
- operations-report reconciliation across opening stock, partial PO receiving, outstanding commitment and partial fulfilment;
- commercial analytics permission separation from broad audit reporting;
- order planning default priority, valid/invalid date handling, audit metadata, closed-order protection and dedicated planning authorization;
- deterministic Warehouse urgency sorting and UTC required-by overdue semantics.

## Verification remains intentionally deferred

Per the current delivery session, verification will be performed after more implementation work. Do not call this branch merge-ready until the pinned dependency graph has been installed and the repository has passed:

```sh
npm install
npm run typecheck
npm test
npm run build
```

The generated `package-lock.json` should then be committed before deployment.
