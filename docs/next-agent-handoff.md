# OrderMate next-agent handoff

## Where to resume

- Repository: `howellsryan/ordermate`
- Branch: `rebuild/cloudflare-saas`
- Draft PR: #3 — `Rebuild OrderMate as a Cloudflare-native multi-tenant SaaS`
- Base: `main`
- Do not merge yet.

This branch is a greenfield replacement for the abandoned .NET prototype. It is already pushed to GitHub. The previous delivery session intentionally stopped feature expansion here so the next agent can begin with a full verification pass instead of inheriting more unverified code.

## First action for the next agent

Before adding another feature:

1. Resolve the latest branch/PR head and inspect this document plus `README.md`, `docs/architecture.md`, `docs/delivery-plan.md`, `docs/implementation-status.md` and `AGENTS.md`.
2. Install the pinned dependency graph with `npm install` and commit the generated `package-lock.json` if installation succeeds.
3. Run `npm run typecheck`, `npm test` and `npm run build`.
4. Fix any failures before continuing. Do not weaken domain/security tests merely to make the suite green.
5. Perform a browser/manual smoke pass of the critical operational flows, especially the newly added Wave Picking workspace.
6. Re-read Draft PR #3 and update its verification section with real results. Keep the PR draft until verification and review are genuinely complete.

No agent in the previous session claimed the branch was merge-ready because the dependency install/typecheck/test/build gate was deliberately deferred.

## Current architecture

OrderMate is a Cloudflare-native TypeScript modular monolith:

- React + Vite frontend served through Cloudflare Workers Static Assets.
- Hono Worker API.
- Better Auth with Google OAuth.
- EU-jurisdiction D1 control plane for users/sessions/organizations/memberships/invites.
- One EU-jurisdiction SQLite-backed Durable Object (`TenantStore`) per business for operational data.
- EU R2 for purchase/delivery source documents and proposal sidecars.
- Cloudflare Queues + dead-letter queue for async document automation.
- Optional Workers AI extraction is implemented but disabled by default for an explicit compliance decision.
- No Neon/AWS/Vercel/Supabase or other hosted database/runtime dependency.

The tenant schema is currently version 6:

1. verified v1 baseline
2. `inventory_policies`
3. PO `expected_delivery_date`
4. `delivery_discrepancies`
5. actor-private `saved_views`
6. order `required_by_date` + constrained `priority` + planning index

## Major product slices already implemented

### Catalogue / onboarding

- Products, categories, arbitrary option dimensions, variants, SKUs, barcodes, cost/price/tax and modifiers.
- Historical order commercial snapshots.
- Product editing plus non-destructive archive/restore.
- Atomic bulk archive/restore.
- Reviewed create-only catalogue CSV import with dry-run, fingerprint recheck, supplier mapping and opening stock movements.

### Inventory / warehouse

- Multi-location stock.
- On-hand, reserved, available and incoming quantities.
- Immutable inventory movements, adjustments and transfers.
- Barcode lookup and mobile camera scanning.
- Single-order Pick & Fulfil and PO Receive Stock workflows.
- Reviewed partial Cycle Count with stale-snapshot and reservation protection.
- Stock movement history.

### Purchasing / planning

- Suppliers and supplier-to-variant mappings with supplier SKU/cost/lead time.
- Purchase orders, partial receiving, cancellation, expected-delivery dates and overdue visibility.
- Deterministic replenishment and per-SKU/location policies.
- Purchase-document extraction/proposal flow.
- Human-reviewed supplier SKU learning.
- Delivery-note-assisted receiving.
- Persistent delivery discrepancies with explicit audited resolution.

### Orders / fulfilment

- Customers.
- Draft/confirm/cancel lifecycle.
- Reservation and oversell prevention.
- Partial/full fulfilment and returns.
- Explicit `required_by_date` and `low / normal / high / urgent` priority.
- Owner/Admin/Manager can edit planning metadata; Fulfilment can execute fulfilment but cannot redefine commitments.
- Overdue/urgent order attention and urgency-aware Warehouse queue ordering.

### Operational UX

- Global search and attention inbox.
- Activity/audit and CSV exports.
- Saved Inventory/Purchasing views.
- Deterministic Operations Reports with separate `analytics:read` permission.
- Responsive role-aware UI.

## Latest completed slice: Wave Picking

Wave Picking is now wired as its own navigation/workspace for Owner/Admin/Manager/Fulfilment.

Important design constraints:

- No schema change.
- No new inventory mutation endpoint.
- A wave contains 2-10 confirmed orders from one stock location.
- The UI aggregates outstanding quantities by variant so a picker can scan a SKU once across multiple orders.
- Aggregate quantities are deterministically allocated back to exact order lines in the existing urgency order.
- The review UI exposes the per-order allocation before commit.
- Every selected order must have at least one staged/allocated unit before commit.
- Unallocatable/excess counts block commit.
- Commit calls the existing canonical `/orders/:id/fulfil` endpoint once per affected order.
- If some orders succeed and another fails, successful orders are removed from the wave and must not be retried. Failed orders require a refreshed/re-scanned follow-up wave.
- Pure allocator tests cover aggregate target construction, repeated variants, partial picks, already-fulfilled lines and excess-count rejection.

Wave Picking still needs runtime verification and a browser smoke pass. Pay particular attention to partial-failure UX because multiple canonical fulfilment transactions are intentionally sequential rather than pretending the entire wave is one atomic inventory transaction.

## Security/RBAC points not to regress

- Tenant IDs from the browser are selectors only; membership is verified server-side before routing.
- Tenant operational rows are physically isolated by Durable Object.
- Unknown tenant routes fail closed.
- Internal actor headers are replaced by the Worker.
- `stocktake:create` is separate from generic inventory update permission.
- `order_planning:update` is separate from order lifecycle update permission.
- `analytics:read` is separate from broad Activity/Audit read permission.
- Fulfilment must not gain purchasing analytics or order-planning edits.
- Same-tenant users must not see/delete another user's saved views.
- AI/document extraction only proposes reviewed structured changes; it never submits POs, receives stock, adjusts inventory or fulfils orders autonomously.

## Recommended work after verification

Do not immediately add another broad subsystem. Once the full gate is green:

1. Fix any UI/accessibility issues discovered in the Wave Picking smoke pass.
2. Review Draft PR #3 as a whole for security, tenant isolation, stock/order invariants and migration safety.
3. Add high-value integration/E2E coverage for the critical browser workflows if the existing suite does not adequately exercise them: Google-session tenant switching, catalogue import review/commit, cycle count, single-order fulfilment, Wave Picking, PO receive and delivery-note review.
4. Run a final responsive/accessibility pass using the Agent-Template UI/UX skills already adopted by the project.
5. Only then decide whether PR #3 is small enough to merge as one rebuild PR or whether any remaining work should move into follow-up PRs.
6. Before real deployment, provision/configure Cloudflare resources and secrets exactly as documented in `README.md`; do not place secrets in the repository.

Potential later product work, after the rebuild is verified, includes stronger exception workflows, richer replenishment forecasting, customer/storefront/integration work, and further reviewed automation. These are not blockers for the current verification handoff.

## Definition of a safe next milestone

A good next milestone is not “one more feature.” It is:

- dependency lockfile committed;
- typecheck green;
- full tests green;
- production build green;
- Wave Picking/manual critical-flow smoke pass complete;
- PR #3 description updated with actual verification evidence;
- no known high-severity security, tenant-isolation, inventory or migration issue.

Until those are true, keep PR #3 draft and do not deploy it as production-ready.
