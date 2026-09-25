# OrderMate next-agent handoff

## Where to resume

- Repository: `howellsryan/ordermate`
- Branch: `rebuild/cloudflare-saas`
- Draft PR: #3 — `Rebuild OrderMate as a Cloudflare-native multi-tenant SaaS`
- Base: `main`
- Keep the PR draft for now.

Resolve the latest branch/PR head before acting and treat the repository as authoritative. Read `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/delivery-plan.md` and `docs/implementation-status.md` before changes.

## Current verification state

The rebuild verification/hardening pass is complete for application commit `ce7ee30be57f9d989b3a63c5668b38b29746037f`:

```text
Node              24.21.0
npm               11.19.0
npm install       PASS — package-lock.json tracked and unchanged
npm run typecheck PASS
npm test          PASS — 29 test files, 112/112 tests
npm run build     PASS
```

Commits after that application SHA only return the verification workflow to manual-only and update documentation. `.github/workflows/rebuild-verification.yml` is intentionally `workflow_dispatch` only so normal commits do not consume Actions minutes.

Do not rerun broad verification merely out of habit; run it after material runtime changes or before final review/deployment. Do not weaken security/domain tests to make them pass.

## What verification fixed

The hardening pass found and properly resolved:

- npm/Cloudflare toolchain compatibility and the committed lockfile;
- Node 24 runtime requirement;
- TypeScript contract/narrowing failures across client and Durable Object layers;
- Vitest accidentally requiring a remote Workers AI binding instead of staying local;
- async Durable Object handler failures escaping the request error boundary;
- missing real v1 -> v6 tenant migration preservation coverage;
- Wave Picking continuing after a mid-wave fulfilment failure;
- Wave Picking commit-in-flight/accessibility issues identified by the Agent-Template/Vercel UI review.

## Current architecture

OrderMate is a Cloudflare-native TypeScript modular monolith:

- React + Vite frontend on Cloudflare Workers Static Assets;
- Hono Worker API;
- Better Auth + Google OAuth;
- EU-jurisdiction D1 control plane;
- one EU-jurisdiction SQLite `TenantStore` Durable Object per business;
- EU R2 for source documents/proposal sidecars;
- Cloudflare Queues + DLQ;
- optional Workers AI extraction, disabled by default;
- no Neon/AWS/Vercel/Supabase runtime/database dependency.

Tenant schema is v6: baseline -> inventory policies -> PO expected delivery -> delivery discrepancies -> actor-private saved views -> order required-by/priority/planning index.

## Critical security/domain boundaries verified

- Tenant ID is a selector only; membership is checked in D1 before tenant Durable Object routing.
- The Worker overwrites internal actor headers.
- Unknown tenant routes fail closed.
- Operational data is physically isolated per tenant Durable Object.
- `stocktake:create`, `order_planning:update` and `analytics:read` remain separate permission boundaries.
- Fulfilment can fulfil but cannot edit order planning metadata and has no purchasing analytics grant.
- Same-tenant users cannot list/delete another actor's saved views.
- Inventory/order mutations remain canonical and audited.
- Workers AI remains proposal/review based and never autonomously changes stock, fulfils orders or commits a PO.
- Tenant migration is in-place/versioned and newer-than-runtime storage fails closed.

## Latest hardened slice: Wave Picking

Wave Picking is a separate Owner/Admin/Manager/Fulfilment workspace.

- 2–10 confirmed orders.
- One stock location per wave; first selection locks location.
- Orders enter allocation in priority -> required-by -> order-age order.
- Outstanding quantities aggregate by variant for scanning.
- Allocation back to exact order lines is deterministic and visible before commit.
- Existing partial fulfilments and partial wave quantities are supported.
- Every selected order must have at least one staged unit.
- Excess/unallocatable quantities block commit.
- Every order commits through `/orders/:id/fulfil`; no separate wave stock endpoint exists.
- Wave commit is intentionally non-atomic.
- Processing stops on the first failed order. Earlier successes remain committed and are removed; later orders are not attempted. Remaining work must be refreshed/re-scanned. Never retry a previously successful order automatically.
- Automated tests cover successful commit and stop-on-first-failure/no-retry behavior in addition to allocator cases.

## Remaining blocker before PR #3 is ready for review

A real browser/device smoke pass is still outstanding. The verification environment cannot physically operate a camera or USB/Bluetooth scanner, so this was not falsely marked complete.

Exercise at minimum:

1. same-location locking and max 10 orders;
2. manual barcode entry;
3. real USB/Bluetooth keyboard-wedge scanner input;
4. camera permission/start/decode/close path;
5. repeated SKU across several orders;
6. partial quantities and already-partially-fulfilled orders;
7. per-order allocation preview;
8. complete successful wave;
9. earlier order succeeds then a later order fails;
10. refresh confirms successful orders are not offered for duplicate fulfilment and the remaining wave must be re-scanned.

If the smoke pass finds an issue, fix it and rerun the affected tests plus the full manual verification workflow if runtime code changes materially. Update PR #3 with the result.

## Review readiness

PR #3 has been updated with the actual verification evidence and remains draft. The critical security/tenancy/inventory/migration review found no known high-severity regression in the reviewed boundaries. The automated gate is green.

Do not add another broad subsystem yet. The next milestone is to complete the physical browser/device smoke, address any findings, then decide whether to mark PR #3 ready for review.

Later follow-up work can include exception workflows, onboarding improvements, richer replenishment forecasting, integrations/storefront, shipping and further reviewed automation. Lots/batches/serial/manufacturing, autonomous AI mutations and destructive catalogue bulk-upserts still require a fresh architecture/plan gate.
