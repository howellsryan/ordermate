# Delivery plan

## Goal
Ship an excellent general-purpose order and inventory SaaS whose core operations are trustworthy before automation is added.

## Phase 0 — platform foundation
- Cloudflare Worker + React/Vite application.
- Google OAuth / Better Auth.
- Organization membership and static RBAC.
- EU D1 control plane and EU tenant Durable Objects.
- R2 documents and Queue binding.
- Tenant audit framework and CI verification.

## Phase 1 — catalogue and stock
- Products, arbitrary option dimensions and variants.
- SKU/barcode, tax, costs and prices.
- Locations, stock ledger, adjustment and transfers.
- Mobile-first barcode lookup/receive/fulfil flows.

## Phase 2 — purchasing
- Suppliers and supplier references.
- Draft/submitted purchase orders.
- Partial receiving and receiving history.
- Incoming-stock visibility.

## Phase 3 — order lifecycle
- Customers and draft orders.
- Confirmation/reservation.
- Partial/full fulfilment.
- Cancellation, return and optional restock.
- Tax snapshots and immutable commercial history.

## Phase 4 — operational polish
- Dense but calm dashboard.
- Search, saved filters, bulk actions and CSV import/export.
- Audit timeline and exception inbox.
- Accessibility/keyboard/responsive review using Agent-Template design resources.

## Phase 5 — automation advantage
AI is advisory before it is mutative. Every extraction produces structured proposed changes and a human-review step before committing inventory/commercial records.

First candidates:
1. PO PDF/photo -> OCR/document extraction -> supplier/SKU matching -> review -> create PO.
2. Delivery note -> match outstanding PO -> flag shortages/overages -> review -> receive.
3. Learned supplier SKU aliases.
4. Replenishment suggestions using stock, reservations, incoming quantities, consumption and lead time.
5. Exception inbox for blocked orders, overdue POs and unusual adjustments.

## Out of scope for the initial MVP
Customer storefront, payment processing, carrier integrations, lots/batches/serials/manufacturing and marketplace/e-commerce integrations.
