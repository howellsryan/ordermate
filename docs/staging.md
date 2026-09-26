# OrderMate staging

OrderMate staging is the disposable browser/device test environment for Draft PR #3. It is intentionally isolated from future production resources.

## Live environment

- Worker: `ordermate-staging`
- URL: `https://ordermate-staging.rlh.workers.dev`
- D1: `ordermate-staging-control` (`dfd9cfd8-c33e-469d-9ce2-1fd6e6996c24`), EU jurisdiction
- Durable Objects: staging-specific `TenantStore` namespace/storage
- R2: `ordermate-staging-documents`, explicit EU jurisdiction
- Queue: `ordermate-staging-events`
- DLQ: `ordermate-staging-events-dead`
- Workers AI extraction: disabled (`AI_DOCUMENT_EXTRACTION_ENABLED=false`)
- Worker preview URLs: disabled; use the stable staging URL above

The staging Durable Object binding has its own namespace and cannot share tenant operational data with the future production Worker.

## Deployment state

The first staging deployment completed successfully on 26 September 2026. The control-plane D1 contains both migrations:

- `0001_auth.sql`
- `0002_workspace_invites.sql`

The EU R2 bucket, staging queue/DLQ, Worker bindings and static assets are provisioned. Cloudflare Builds is connected to `rebuild/cloudflare-saas` and automatically verifies/deploys staging branch pushes. Documentation-only changes under `docs/**` are excluded.

The Cloudflare build gate runs:

```sh
npm run typecheck
npm run test:cloudflare
npm run build:staging
npm run db:migrate:staging
npx wrangler deploy --env staging
```

`test:cloudflare` retains every normal assertion but allows a 15-second per-test ceiling because Durable Object integration tests can take 5–9 seconds on Cloudflare's shared build host. The normal `npm test` / GitHub verification gate retains Vitest's stricter default timeout.

GitHub's rebuild verification workflow remains manual-only to avoid consuming Actions minutes on every staging push.

## Google OAuth — still required for full interactive testing

`BETTER_AUTH_SECRET` is configured as a real generated staging secret. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` currently exist only as non-credential placeholders so no OAuth credential was invented or committed.

Create or choose a Google OAuth **Web application** and add this exact authorised redirect URI:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

Then replace the two placeholder staging secrets:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

Do not replace `BETTER_AUTH_SECRET` unless intentionally rotating staging sessions, and never commit any of these values.

No staging authentication bypass should be added. The manual smoke pass must exercise the same Google/Better Auth path intended for production.

## Manual browser/device smoke pass

Once real Google OAuth credentials are attached, use the live staging URL for the final PR gate:

1. Google sign-in and first-business creation.
2. Create a stock location, product/variant and barcode.
3. Add stock and create at least two same-location confirmed orders.
4. Wave Picking: same-location lock and maximum 10 selection.
5. Manual barcode entry.
6. USB/Bluetooth keyboard-wedge scanner input.
7. Mobile camera permission, rear-camera start, successful decode and one-scan close behavior.
8. Repeated SKU across multiple orders.
9. Partial wave quantities and existing partial fulfilments.
10. Per-order allocation preview.
11. Full successful wave.
12. Force a later-order failure after an earlier success: successful orders must remain fulfilled, later orders must be not attempted, and the remainder must require refresh/re-scan.
13. Confirm previously successful orders are not offered for duplicate fulfilment.
14. Verify responsive layout and focus/keyboard behavior on phone and desktop widths.
15. Smoke the surrounding critical flows: single-order fulfilment, cycle count, PO receive, delivery-note review and tenant switching.

Staging data is disposable, but destructive testing must remain inside the staging tenant/environment.

## Production separation

Do not run top-level `npm run deploy`, `npm run db:migrate:remote`, or `npm run cf:bootstrap` while testing staging. Those commands remain reserved for the eventual production configuration.

The top-level production D1 ID remains intentionally unprovisioned/placeholder; staging deployment does not make the rebuild production-ready.
