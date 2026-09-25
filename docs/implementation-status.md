# OrderMate implementation status

This document records what is implemented on `rebuild/cloudflare-saas` before the deferred verification pass. It is not a substitute for `npm run typecheck`, `npm test` and `npm run build`.

## Platform and tenancy

- Cloudflare Worker + React/Vite modular monolith.
- Better Auth with Google sign-in.
- D1 control plane for users, sessions, organizations, members and workspace invites.
- One EU-jurisdiction SQLite-backed `TenantStore` Durable Object per business.
- EU R2 source-document storage and Cloudflare Queue event binding.
- Server-side membership verification and static RBAC on tenant routes.
- Role-aware UI for Owner, Admin, Manager, Inventory, Fulfilment and Viewer.
- Cross-origin custom API mutations rejected at the public Worker boundary.
- Unexpected custom API 5xx responses masked before leaving the Worker.

## Catalogue

- Products and categories.
- Arbitrary option dimensions and generated sellable variants.
- SKU, barcode, price, cost and tax per variant.
- Reusable modifiers/add-ons kept separate from variant identity.
- Audited editing of product name/category/description and live variant commercial/identifier fields.
- Product editing preserves option-combination identity; changing the dimension structure is deliberately a separate future workflow.
- Historical order pricing and names remain snapshot-based after catalogue edits.

## Inventory

- Multiple stock locations.
- On-hand, reserved, available and derived incoming quantities.
- Audited stock adjustments and transfers.
- Immutable inventory movement ledger.
- Searchable stock-history UI showing signed quantity, item/SKU, location, movement type, reason/reference, actor and timestamp.
- Barcode lookup workflow.
- Oversell prevention and reservation release on order cancellation.

## Purchasing

- Suppliers.
- Draft/submitted purchase orders.
- Cost/tax snapshots and tenant-local PO numbering.
- Partial receiving with inventory movements and incoming-stock visibility.
- Read-only PO line-detail view.
- Tenant-scoped purchasing source-document inbox in R2.
- PDF/image upload, permission-checked preview, safe non-PII object keys and `document.uploaded` queue events.
- Document extraction/AI proposal generation is not implemented yet.

## Orders

- Customers.
- Draft order creation with commercial snapshots and modifiers.
- Confirmation and stock reservation.
- Partial/full fulfilment.
- Cancellation and reservation release.
- Returns with optional restock.
- Read-only line-detail view including fulfilled/returned quantities.

## Operational UX

- Global tenant-scoped search with Cmd/Ctrl+K.
- Operational attention inbox for low/zero stock, fulfilment work and incoming purchase orders.
- First-class Activity & Data workspace.
- Searchable/filterable audit history.
- Permission-checked CSV exports for catalogue, inventory, orders, POs, customers, suppliers and audit data.
- Accessible focus-trapped dialogs with Escape handling and focus restoration.
- Responsive role-aware navigation and mutation controls.

## Regression coverage added

Cloudflare runtime/unit tests cover or specify:

- physical tenant data isolation;
- reservation and oversell behavior;
- cancellation release;
- partial fulfilment;
- PO partial receiving;
- purchase receipt movements;
- barcode lookup;
- tenant-local numbering;
- RBAC route classification and fail-closed unknown routes;
- immutable adjustment/transfer movement history;
- catalogue edits preserving historical order snapshots.

## Verification remains intentionally deferred

Per the current delivery session, verification will be performed after more implementation work. Do not call this branch merge-ready until the pinned dependency graph has been installed and the repository has passed:

```sh
npm install
npm run typecheck
npm test
npm run build
```

The generated `package-lock.json` should then be committed before deployment.
