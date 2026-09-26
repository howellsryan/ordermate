# Operating Layer implementation status

This document records the verified state of `rebuild/cloudflare-saas` after the rebuild hardening and staging deployment pass. The repository and Draft PR #3 remain authoritative if this summary and code ever diverge.

## Verification status

The rebuild is green through both the repository gate and the Cloudflare staging deployment gate.

Repository verification has passed with Node 24 and the pinned lockfile:

```text
npm install       PASS — package-lock.json tracked and unchanged
npm run typecheck PASS
npm test          PASS — 29 test files, 112/112 tests
npm run build     PASS
npm run build:staging PASS
```

Cloudflare Builds independently ran the staging gate against the branch and passed:

```text
npm run typecheck     PASS
npm run test:cloudflare PASS — 29 test files, 112/112 tests
npm run build:staging PASS
npm run db:migrate:staging PASS
wrangler deploy --env staging PASS
```

`test:cloudflare` changes only the per-test timeout ceiling to 15 seconds because several Durable Object integration tests take 5–9 seconds on Cloudflare's shared build host. The normal `npm test` gate keeps Vitest's stricter default timeout. Assertions and domain/security behavior are identical.

The production/staging Vite build is green. It emits non-fatal upstream annotation and bundle/chunk-size warnings; those are performance/packaging follow-up opportunities, not build failures.

## Live staging environment

A real isolated staging site now exists:

`https://ordermate-staging.rlh.workers.dev`

It uses:

- EU-jurisdiction D1 `ordermate-staging-control`;
- a staging-only `TenantStore` Durable Object namespace;
- explicit EU-jurisdiction R2 `ordermate-staging-documents`;
- staging queue `ordermate-staging-events` plus DLQ;
- Workers AI binding present but document extraction disabled;
- preview URLs disabled in favour of the stable staging hostname.

The staging D1 has both control-plane migrations applied (`0001_auth.sql`, `0002_workspace_invites.sql`) and its schema was queried directly after deployment.

Cloudflare Builds watches `rebuild/cloudflare-saas` and automatically verifies/deploys staging pushes. `docs/**` changes are excluded. GitHub's rebuild verification workflow remains manual-only to avoid consuming Actions minutes on every commit.

### Remaining staging prerequisite

`BETTER_AUTH_SECRET` is configured with a generated staging secret. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are currently non-credential placeholders; no OAuth credential was invented or committed.

Before full interactive browser testing, configure a Google OAuth Web client with this callback and replace the two placeholder Worker secrets:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

No staging authentication bypass should be added.

## Verification hardening completed

The verification pass found and fixed issues rather than weakening tests or bypassing invariants:

- generated and committed a stable `package-lock.json`;
- aligned root Wrangler with the current Cloudflare Vite/Workers Types toolchain;
- made Node 24 the supported runtime for the dependency graph;
- repaired TypeScript contracts/narrowing across client and Durable Object layers;
- added a local-only Wrangler test configuration so Vitest does not require the disabled remote Workers AI binding or accidentally invoke inference;
- fixed async Durable Object route failures so rejected async handlers remain inside the normal request error boundary;
- added real SQLite Durable Object migration coverage for populated v1 -> v6 data preservation plus newer-than-runtime fail-closed behavior;
- hardened Wave Picking to stop after the first fulfilment failure, preserve earlier successes, mark later orders not attempted and require refresh/re-scan of the remainder;
- applied targeted Wave Picking accessibility/commit-in-flight hardening using the Agent-Template/Vercel UI guidance;
- added an isolated Cloudflare staging environment without provisioning or mutating production resources;
- confirmed staging D1/R2/DO/Queue bindings and secret bindings from the Cloudflare control plane after deployment.

## Platform and tenancy

- React + Vite frontend served by Cloudflare Workers Static Assets.
- Hono Worker API.
- Better Auth with Google OAuth.
- EU-jurisdiction D1 control plane for users, sessions, organizations, memberships and invites.
- One EU-jurisdiction SQLite-backed `TenantStore` Durable Object per business.
- EU R2 for purchase/delivery source documents and proposal sidecars.
- Cloudflare Queues + DLQ for document automation.
- Workers AI extraction is optional and disabled by default pending explicit compliance acceptance.
- No Neon, AWS, Vercel, Supabase or other hosted runtime/database dependency.

Security boundaries verified in the hardening pass:

- browser tenant IDs are selectors only; membership is verified server-side before Durable Object routing;
- internal actor headers are overwritten by the Worker;
- unknown tenant routes fail closed;
- tenant operational data remains physically isolated by Durable Object;
- `stocktake:create`, `order_planning:update` and `analytics:read` remain dedicated permissions;
- Fulfilment may fulfil orders but cannot edit required-by/priority and does not gain purchasing analytics;
- saved views are scoped to the owning actor within a tenant;
- AI/document extraction remains proposal/review based and never autonomously adjusts stock, fulfils orders or commits purchase orders.

## Tenant schema

Current tenant schema: **v6**.

1. v1 baseline
2. `inventory_policies`
3. purchase-order `expected_delivery_date`
4. `delivery_discrepancies`
5. actor-private `saved_views`
6. order `required_by_date`, constrained priority and planning index

`_sql_schema_migrations` records monotonic versions. Later DDL is replay-safe where bookkeeping could have been interrupted, and a storage version newer than the runtime fails closed. Durable Object identity remains `TenantStore`; migration is in place rather than copy-to-new-namespace.

## Delivered product areas

### Catalogue and onboarding

Products, categories, arbitrary options/variants, SKUs/barcodes, commercial fields, modifiers, editing, archive/restore, atomic bulk status changes and reviewed create-only CSV onboarding with dry-run/fingerprint/atomic commit and opening-stock movements.

### Inventory and warehouse

Multi-location on-hand/reserved/available/incoming stock, immutable movements, transfers/adjustments, history, barcode lookup, single-order Pick & Fulfil, PO Receive Stock, mobile camera/manual/hardware-scanner input paths and reviewed Cycle Count with stale-snapshot/reservation protection.

### Purchasing

Suppliers, supplier mappings, POs, expected delivery, partial receiving/cancellation, deterministic replenishment and policies, purchase-document proposals, reviewed supplier-SKU learning, delivery-note assistance and persistent audited discrepancies.

### Orders

Customers, immutable commercial snapshots, reservations/oversell prevention, partial/full fulfilment, cancellation, returns, explicit required-by dates, low/normal/high/urgent priority and audited planning edits.

### Operational UX

Tenant search, attention inbox, audit/activity, CSV export, actor-private saved views, deterministic operations reports, responsive role-aware UI and human-review surfaces for proposals/imports/planning.

## Wave Picking

Wave Picking is a separate workspace for Owner/Admin/Manager/Fulfilment.

- 2–10 confirmed orders per wave.
- All selected orders must use the same stock location.
- Orders are supplied in deterministic urgency order: priority -> required-by -> order age.
- Outstanding quantities aggregate by variant for scanning and are allocated back to exact order lines deterministically.
- Existing partial fulfilments reduce outstanding quantities before planning.
- Partial wave quantities are supported.
- Every selected order must receive at least one staged unit before commit.
- Excess/unallocatable counts block commit.
- Operator sees per-order allocation before committing.
- Every mutation uses the existing `/orders/:id/fulfil` endpoint; there is no wave-specific stock mutation endpoint.
- The wave is intentionally not globally atomic.
- Commit stops on the first failed order. Earlier successful orders remain fulfilled and are removed from the wave; later orders are not attempted. Remaining orders require refreshed state and a fresh scan. Successful orders are never automatically retried.

Pure planning/commit tests cover repeated variants, partial quantities, existing fulfilments, excess counts, successful sequential commit and stop-on-first-failure/no-retry behavior.

## Regression coverage

The 112-test suite covers the critical domain areas including:

- tenant isolation and fail-closed RBAC;
- reservations, oversell, cancellation and partial fulfilment;
- immutable inventory movements and PO receiving/cancellation;
- stocktake atomicity, stale snapshots and reservation protection;
- catalogue import review/fingerprint/atomic commit;
- bulk archive/restore rollback and audit parity;
- supplier mapping/learning invariants;
- replenishment semantics;
- v1 -> v6 migration preservation and newer-schema rejection;
- delivery discrepancy idempotency/resolution/audit;
- saved-view actor isolation;
- analytics permission separation and report reconciliation;
- order planning validation/audit/RBAC;
- deterministic urgency ordering;
- document/delivery-note deterministic matching;
- Wave Picking planning and non-atomic recovery semantics.

## Remaining verification before review-ready

Automated repository verification, staging infrastructure provisioning and staging deployment are complete.

The remaining required validation is:

1. replace staging's placeholder Google OAuth client ID/secret with real staging credentials;
2. perform the real browser/device smoke pass on the live staging URL, especially:
   - Google sign-in and tenant creation/switching;
   - same-location lock and 10-order cap;
   - manual barcode entry;
   - USB/Bluetooth keyboard-wedge scanner path;
   - camera permission + barcode decode path;
   - repeated SKU across orders;
   - partial wave quantities and existing partial fulfilments;
   - per-order preview;
   - complete successful wave;
   - earlier success followed by later failure;
   - successful orders not offered for duplicate fulfilment after refresh;
   - single-order fulfilment, cycle count, PO receive and delivery-note review;
   - responsive/accessibility spot checks on phone and desktop.

Keep Draft PR #3 draft until that evidence exists. Do not expand into another broad subsystem before this is closed out.
