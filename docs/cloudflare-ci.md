# Cloudflare commit verification

Automatic verification for Operating Layer runs in **Cloudflare Workers Builds**, the Cloudflare CI build environment. TypeScript, npm and Vitest run there; a request-serving Worker is not an npm/shell runner.

## Active configuration

The existing GitHub connection for `howellsryan/ordermate` is reused. The checks-only trigger is attached to `ordermate-staging`:

- Trigger name: `Operating Layer verification`
- Trigger UUID: `bf016235-3415-44b7-b2c1-ba36c7e0a386`
- Worker tag: `4ca681ce9c784cc5969f0cd6182f2259`
- Branch includes: `*`
- Branch excludes: `rebuild/cloudflare-saas` (already handled by the existing staging deploy trigger)
- Path includes: `*`
- Path excludes: `docs/**`, `README.md`, `AGENTS.md`
- Root directory: `/`
- Build caching: disabled after the initialization-timeout investigation
- Build variables: `NODE_VERSION=24`, `SKIP_DEPENDENCY_INSTALL=1`

These are Cloudflare trigger settings, not Wrangler runtime settings. Keep the trigger settings and this document synchronized when changing CI.

Build command:

```sh
npm ci --no-audit --no-fund && node scripts/rebrand-operating-layer.mjs && npm run typecheck && npm run test:cloudflare && npm run build && npm run build:staging
```

The full suite includes `test/demo-guest-acceptance.test.ts`, so it is not run a second time. `test:cloudflare` keeps all tests and assertions but uses the existing 15-second per-test timeout for shared Cloudflare hosts.

Deploy command:

```sh
node -e "console.log('Verification passed; no deployment or remote migrations performed.')"
```

The checks-only trigger does not deploy code or apply remote migrations. Tests use `wrangler.test.jsonc` local bindings. Pushes to the existing `rebuild/cloudflare-saas` branch retain its separate staging build/deploy process.

## GitHub workflow and checks

`.github/workflows/rebuild-verification.yml` is manual-only (`workflow_dispatch`). Commits and pull requests no longer start that GitHub Actions job after adopting the workflow change. Explicit manual runs still consume GitHub Actions minutes.

Cloudflare's GitHub App publishes build check runs for automatic builds. Check details point to Cloudflare build logs. Documentation-only pushes skipped by the watch paths do not get a new Cloudflare check.

If a branch protection rule requires the old `verify` Actions job, replace that requirement with the observed Cloudflare check before relying on this as a merge gate. The GitHub connector used for this migration cannot read or edit branch protection (403), so those rules must be checked by an administrator. Required checks and documentation-only path skips need compatible repository rules.

GitHub PR workflows on older branches that explicitly retain the old workflow may still run; update those branches from `main`.

## Minutes and rollback

This avoids automatic GitHub Actions runner usage. Cloudflare Builds has its own account-wide allowance: 3,000 minutes/month on Free, or 6,000 on Paid followed by $0.005/minute, according to [Cloudflare's limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/). The account limits API returned no allowance details during this migration; no plan or remaining-minute balance is inferred.

Skipping documentation-only changes, a single dependency installation, and avoiding the duplicate guest-demo test reduce repeated work. Build caching is currently disabled; revisit it only after stable builds. Watch build usage in Cloudflare.

To roll back, restore the `pull_request` trigger targeting `main` in the GitHub workflow and disable/remove only the checks-only trigger above. Preserve the existing staging deployment trigger `91a7519b-712d-40d6-b966-3ff54a5afe45`.
