# OrderMate next-agent handoff

## Where to resume

- Repository: `howellsryan/ordermate`
- Branch: `rebuild/cloudflare-saas`
- Draft PR: #3 — `Rebuild OrderMate as a Cloudflare-native multi-tenant SaaS`
- Base: `main`
- Keep the PR draft for now.
- Live staging: `https://ordermate-staging.rlh.workers.dev`

Resolve the latest branch/PR head before acting and treat the repository as authoritative. Read `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/delivery-plan.md`, `docs/implementation-status.md` and `docs/staging.md` before changes.

## Current verification state

Both verification layers are green:

```text
Repository/GitHub gate
npm install            PASS — lockfile unchanged
npm run typecheck      PASS
npm test               PASS — 29 files, 112/112 tests
npm run build          PASS
npm run build:staging  PASS

Cloudflare staging gate
npm run typecheck      PASS
npm run test:cloudflare PASS — 29 files, 112/112 tests
npm run build:staging  PASS
D1 migrations          PASS
staging deploy         PASS
```

`.github/workflows/rebuild-verification.yml` is intentionally manual-only so normal commits do not consume GitHub Actions minutes. Cloudflare Builds independently watches `rebuild/cloudflare-saas`, verifies runtime/config pushes and deploys the isolated staging Worker. `docs/**` is excluded.

Cloudflare's shared build hosts make several Durable Object integration tests take 5–9 seconds, so `test:cloudflare` has a 15-second per-test ceiling. Normal `npm test` retains Vitest's stricter default timeout. No assertion is removed or weakened.

## Staging environment

Staging is provisioned and deployed separately from future production:

- Worker: `ordermate-staging`
- URL: `https://ordermate-staging.rlh.workers.dev`
- EU D1: `ordermate-staging-control` (`dfd9cfd8-c33e-469d-9ce2-1fd6e6996c24`)
- staging-only `TenantStore` Durable Object namespace
- explicit EU R2: `ordermate-staging-documents`
- queue: `ordermate-staging-events`
- DLQ: `ordermate-staging-events-dead`
- AI extraction disabled
- preview URLs disabled

The staging D1 has `0001_auth.sql` and `0002_workspace_invites.sql` applied. Its Better Auth/workspace tables were queried directly after deployment.

Future staging deploys run only idempotent D1 migrations followed by `wrangler deploy --env staging`; R2 provisioning is a completed one-time operation.

## Remaining OAuth prerequisite

`BETTER_AUTH_SECRET` is a real generated staging secret. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` currently exist only as non-credential placeholders.

Before interactive testing, configure a Google OAuth Web client with this exact callback:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

Then replace the two staging placeholder secrets. Never commit the values and do not add a staging auth bypass.

## What verification fixed

The hardening pass properly resolved:

- npm/Cloudflare toolchain compatibility and the committed lockfile;
- Node 24 runtime requirement;
- TypeScript contract/narrowing failures across client and Durable Object layers;
- Vitest accidentally requiring a remote Workers AI binding instead of remaining local;
- async Durable Object handler failures escaping the request error boundary;
- missing real v1 -> v6 tenant migration preservation coverage;
- Wave Picking continuing after a mid-wave fulfilment failure;
- Wave Picking commit-in-flight/accessibility issues identified by the Agent-Template/Vercel review;
- creation of a production-separated staging deployment for real browser/device testing.

## Critical security/domain boundaries verified

- Tenant ID is a selector only; D1 membership is checked before tenant Durable Object routing.
- Worker overwrites internal actor headers.
- Unknown tenant routes fail closed.
- Operational data is physically isolated per tenant Durable Object.
- `stocktake:create`, `order_planning:update` and `analytics:read` remain separate permission boundaries.
- Fulfilment can fulfil but cannot edit planning metadata and has no purchasing analytics grant.
- Same-tenant users cannot list/delete another actor's saved views.
- Inventory/order mutations remain canonical and audited.
- Workers AI remains proposal/review based and cannot autonomously mutate stock, fulfil orders or commit POs.
- Tenant migration is in-place/versioned and newer-than-runtime storage fails closed.

## Wave Picking contract

- 2–10 confirmed orders.
- One stock location per wave; first selection locks location.
- Priority -> required-by -> order age allocation order.
- Aggregate scan counts by variant, deterministic allocation back to exact order lines.
- Existing partial fulfilments and partial wave quantities supported.
- Every selected order requires at least one staged unit.
- Excess/unallocatable quantities block commit.
- Per-order allocation visible before commit.
- Every mutation uses `/orders/:id/fulfil`.
- Wave is intentionally not globally atomic.
- Processing stops on the first failed order. Earlier successes remain committed and are removed; later orders are not attempted. Remaining work must refresh/re-scan. Never auto-retry a previously successful order.

## Remaining blocker before PR #3 is ready for review

The infrastructure and automated gates are complete. The remaining gate is **real interactive browser/device evidence**.

After replacing the placeholder Google OAuth credentials, test the live staging site at minimum:

1. Google sign-in and business creation/tenant switching.
2. Create location/product/barcode and stock needed for orders.
3. Same-location Wave Picking lock and max 10 orders.
4. Manual barcode entry.
5. Real USB/Bluetooth keyboard-wedge scanner input.
6. Mobile camera permission/start/decode/one-scan-close path.
7. Repeated SKU across orders.
8. Partial quantities and already-partially-fulfilled orders.
9. Per-order allocation preview.
10. Complete successful wave.
11. Earlier order succeeds then a later order fails.
12. Refresh confirms successful orders cannot be duplicate-fulfilled and remainder requires re-scan.
13. Single-order fulfilment, cycle count, PO receive and delivery-note review.
14. Responsive/focus/accessibility spot checks on phone and desktop.

If smoke testing finds a defect, fix it and rerun the affected suite plus the full manual verification workflow when runtime code changes materially. Cloudflare staging should then auto-deploy the branch fix.

## Review readiness

PR #3 remains draft. There is no known high-severity regression in the reviewed security/tenancy/inventory/migration boundaries, and automated verification plus staging deployment are green.

Do not add another broad subsystem yet. Complete OAuth + the real device/browser smoke pass, record evidence in PR #3, then decide whether to mark it ready for review.

Later work may include exception workflows, onboarding improvements, richer replenishment forecasting, integrations/storefront, shipping and further reviewed automation. Lots/batches/serial/manufacturing, autonomous AI mutations and destructive catalogue bulk-upserts still require a fresh architecture/plan gate.
