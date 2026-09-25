# OrderMate staging

OrderMate staging is intentionally isolated from future production resources.

## Target

- Worker: `ordermate-staging`
- URL after first deploy: `https://ordermate-staging.rlh.workers.dev`
- D1: `ordermate-staging-control` (`dfd9cfd8-c33e-469d-9ce2-1fd6e6996c24`), EU jurisdiction
- Durable Objects: environment-specific `TenantStore` namespace/storage created by the staging Worker migration
- R2: `ordermate-staging-documents`, EU jurisdiction
- Queue: `ordermate-staging-events`
- DLQ: `ordermate-staging-events-dead`
- Workers AI extraction: disabled by default

The staging Durable Objects are not bound back to the top-level Worker, so staging tenant data cannot share the future production Durable Object namespace.

## One-time external setup

The D1 database and queues are already provisioned. Before the first staging deploy, create the R2 bucket with the explicit EU jurisdiction guarantee:

```sh
npx wrangler r2 bucket create ordermate-staging-documents --jurisdiction eu
```

Do not substitute a default-jurisdiction bucket, even if Cloudflare physically places it in Western Europe.

Create or choose a Google OAuth Web application and add this exact authorised redirect URI:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

Set the three staging Worker secrets. Never commit their values:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put BETTER_AUTH_SECRET --env staging
```

Use a high-entropy random value for `BETTER_AUTH_SECRET`.

## First deploy

Apply the control-plane migrations to the staging D1:

```sh
npm run db:migrate:staging
```

Then build with the staging Cloudflare environment and deploy only that environment:

```sh
npm run deploy:staging
```

`build:staging` sets `CLOUDFLARE_ENV=staging` for the Cloudflare Vite plugin. `deploy:staging` then deploys with `wrangler --env staging`, so the generated client/Worker build and the deploy command use the same bindings.

## Smoke pass

Use staging for the manual browser/device gate before PR #3 leaves draft:

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
12. A later order failure after an earlier success: successful orders remain fulfilled, later orders are not attempted, and the remainder must be refreshed/re-scanned.
13. Confirm previously successful orders are not offered for duplicate fulfilment.
14. Verify the responsive layout on phone and desktop widths.

Staging data is disposable, but destructive tests must remain inside the staging tenant/environment.

## Production separation

Do not run the top-level `npm run deploy`, `npm run db:migrate:remote`, or `npm run cf:bootstrap` while performing staging verification. Those commands are reserved for the eventual production configuration and intentionally remain separate from the staging scripts.
