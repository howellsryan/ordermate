# Operating Layer next-agent handoff

## Where to resume

- Repository: `howellsryan/ordermate`
- Branch: `rebuild/cloudflare-saas`
- Draft PR: #3 — `Rebuild as Operating Layer — Cloudflare-native operations SaaS`
- Base: `main`
- Keep the PR draft for now.
- Compatibility staging URL: `https://ordermate-staging.rlh.workers.dev`

Resolve the latest branch/PR head before acting and treat the repository as authoritative. Read `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/delivery-plan.md`, `docs/implementation-status.md`, `docs/brand.md`, `docs/seo.md` and `docs/staging.md` before changes.

## Brand state

The customer-facing product is **Operating Layer**. The public acquisition surface, authenticated application shell, document-extraction product language, product-proof assets, favicon, machine-readable discovery content and core repository guidance have been rebranded.

Brand proposition: **Inventory, orders & purchasing. One operating layer.**

Brand promise: **The system between order and outcome.**

Existing `ordermate-*` Cloudflare resource names, the compatibility staging hostname, repo/package slugs and `x-ordermate-*` internal request headers are migration-sensitive technical identifiers. Do not rename them as a cosmetic cleanup. See `docs/brand.md`.

The browser tenant key migrates from legacy `ordermate:tenant` to `operating-layer:tenant` without losing the selected workspace.

## SEO state

The homepage has an SEO-first document shell, descriptive title/meta/social metadata, truthful Organization/WebApplication structured data, category-oriented crawlable content, FAQ content, descriptive product-image alt text and updated `llms.txt` / AI discovery identity.

Staging is intentionally protected from search indexing at the Worker boundary. Do not invent a production domain. Domain/trademark/company-name clearance and the canonical production origin are explicit launch gates; see `docs/seo.md`.

## Verification state

Before the Operating Layer brand/SEO delta, the rebuild had passed:

```text
npm install             PASS — lockfile unchanged
npm run typecheck       PASS
npm test                PASS — 29 files, 112/112 tests
npm run build            PASS
npm run build:staging    PASS
```

Cloudflare staging had also previously passed typecheck, `test:cloudflare`, staging build, D1 migrations and deployment.

Those results **predate the latest branding/SEO runtime changes**. Do not claim the current head is freshly verified until the current branch is run through the standard gate again.

`.github/workflows/rebuild-verification.yml` remains manual-only so normal commits do not consume GitHub Actions minutes. Cloudflare Builds may independently watch the branch, but resolve and inspect the actual latest build/deploy state before relying on it.

## Compatibility staging environment

Existing staging remains separated from future production:

- Worker: `ordermate-staging`
- URL: `https://ordermate-staging.rlh.workers.dev`
- EU D1: `ordermate-staging-control` (`dfd9cfd8-c33e-469d-9ce2-1fd6e6996c24`)
- staging-only `TenantStore` Durable Object namespace
- EU R2: `ordermate-staging-documents`
- queue: `ordermate-staging-events`
- DLQ: `ordermate-staging-events-dead`
- AI extraction disabled
- preview URLs disabled

The `ordermate-*` names above are infrastructure compatibility identifiers, not public brand copy.

## OAuth prerequisite

`BETTER_AUTH_SECRET` was configured with a generated staging secret. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` were placeholders at the last verified handoff.

Before interactive testing, confirm the live secret state and configure a Google OAuth Web client with the current compatibility callback if still required:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

Never commit the credentials and do not add a staging auth bypass.

## Critical security/domain boundaries

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

## Remaining gate before PR #3 is review-ready

1. Run current-head `npm run typecheck`, `npm test`, `npm run build` and the staging build/deploy gate.
2. Inspect the current public landing page for desktop/mobile layout, keyboard/focus accessibility, reduced motion, broken assets and metadata/structured-data correctness.
3. Verify staging returns `X-Robots-Tag: noindex, nofollow, noarchive` and disallows crawlers.
4. Replace placeholder Google OAuth credentials if still outstanding.
5. Perform the real browser/device smoke pass: sign-in, tenant creation/switching, manual/hardware/camera scanning, Wave Picking success/failure recovery, single-order fulfilment, cycle count, PO receive and delivery-note review.
6. Re-run Lighthouse or equivalent on the **current Operating Layer page**; do not reuse the pre-rebrand scores as current evidence.
7. Record the evidence on PR #3, resolve findings, then decide whether to mark it ready for review.

Do not add another broad subsystem until this gate is closed. Do not rename provisioned compatibility infrastructure without a separate migration plan.
