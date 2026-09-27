# Operating Layer staging

Operating Layer staging is the disposable browser/device test environment. It is intentionally isolated from future production resources. The `ordermate-*` names below are compatibility infrastructure identifiers, not customer-facing brand names.

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

The first staging deployment completed successfully on 26 September 2026. Before Shopify Slice B, the control-plane D1 contained:

- `0001_auth.sql`
- `0002_workspace_invites.sql`

Slice B adds `0003_integrations.sql`. Source merge/deployment alone is not evidence that the live staging D1 has this migration; verify `npm run db:migrate:staging` has applied it before exercising Shopify connection routes.

The EU R2 bucket, staging queue/DLQ, Worker bindings and static assets are provisioned. The Cloudflare build gate runs:

```sh
npm run typecheck
npm run test:cloudflare
npm run build:staging
npm run db:migrate:staging
npx wrangler deploy --env staging
```

`test:cloudflare` retains every normal assertion but allows a 15-second per-test ceiling because Durable Object integration tests can take longer on Cloudflare's shared build host. The normal `npm test` / GitHub verification gate retains Vitest's stricter default timeout.

The GitHub rebuild verification workflow runs on pull requests to `main` and can also be dispatched manually. It uses locked dependencies, the brand sweep, typecheck, full tests, explicit guest-demo acceptance, and production/staging builds.

## Google OAuth — required for authenticated workspace smoke testing

`BETTER_AUTH_SECRET` is configured as a generated staging secret. Configure a Google OAuth **Web application** with this exact authorised redirect URI:

```text
https://ordermate-staging.rlh.workers.dev/api/auth/callback/google
```

Then configure the two staging secrets if they are not already valid credentials:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

Do not replace `BETTER_AUTH_SECRET` unless intentionally rotating staging sessions, and never commit any of these values. No staging authentication bypass should be added.

## Shopify Slice B staging prerequisites

Slice B intentionally fails closed until a real Shopify app and integration encryption secret are configured. Do not invent or commit these values.

Create/configure a Shopify app for staging with this callback URL:

```text
https://ordermate-staging.rlh.workers.dev/api/integrations/shopify/callback
```

Webhook delivery targets the stable staging Worker endpoint:

```text
https://ordermate-staging.rlh.workers.dev/api/integrations/shopify/webhooks
```

Configure these Worker secrets:

```sh
npx wrangler secret put SHOPIFY_CLIENT_ID --env staging
npx wrangler secret put SHOPIFY_CLIENT_SECRET --env staging
npx wrangler secret put INTEGRATION_TOKEN_ENCRYPTION_KEY --env staging
```

`INTEGRATION_TOKEN_ENCRYPTION_KEY` must be a cryptographically random 32-byte key encoded as base64. Generate and store it outside the repository; do not paste it into source, documentation, PR comments or application logs. `INTEGRATION_TOKEN_KEY_VERSION=v1` is non-secret configuration used for rotation metadata.

Current non-secret Shopify settings live in `wrangler.jsonc`, including the API version and requested scopes. Before connecting a non-development store, confirm the Shopify app has the approvals required for the requested protected order/customer data. Do not broaden scopes merely to make OAuth succeed.

### Slice B security acceptance

Before calling the live staging connector foundation verified:

1. Apply `0003_integrations.sql` and verify `integration_routes` and `integration_oauth_states` exist in staging D1.
2. Complete Google sign-in and choose a staging workspace as Owner/Admin.
3. Start Shopify connection using the permanent `*.myshopify.com` domain.
4. Confirm the OAuth state is browser-bound, expires, and cannot be reused.
5. Complete Shopify OAuth and verify the workspace exposes connection metadata but never token ciphertext/plaintext.
6. Confirm a second workspace cannot claim a shop already routed to the first workspace.
7. Deliver a correctly signed test webhook and confirm one tenant event is recorded.
8. Replay the same `X-Shopify-Webhook-Id` and confirm it resolves to the same receipt without adding a duplicate event.
9. Tamper with the body while keeping the old HMAC and confirm it is rejected before tenant routing.
10. Send a webhook for an unknown/inactive shop and confirm no tenant is selected from browser-controlled input.
11. Rotate the offline token through the refresh path and confirm the stored credential envelope changes without exposing either token.
12. Confirm no order, stock, fulfilment or return state changes from Slice B webhook receipt alone; canonical processing belongs to later slices.

## Manual browser/device smoke pass

Use the live staging URL for the surrounding product gate:

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

The top-level production D1 ID remains intentionally unprovisioned/placeholder; staging deployment does not make the product production-ready. Shopify production credentials, encryption keys, app review/data-access approvals and migration evidence must be established separately from staging.
