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

Slices C and D extend only tenant Durable Object integration storage through its independently versioned integration schema. They do not add another D1 control-plane migration. Slice D advances that integration schema to v3 with persistent external-order application state.

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

## Shopify staging prerequisites

Slices B–D intentionally fail closed until a real Shopify app and integration encryption secret are configured. Do not invent or commit these values.

Use a dedicated staging Shopify app/development store rather than pointing production credentials at the staging Worker. Configure this callback URL:

```text
https://ordermate-staging.rlh.workers.dev/api/integrations/shopify/callback
```

Shop-scoped operational webhook delivery targets the stable staging Worker endpoint:

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

Current non-secret Shopify settings live in `wrangler.jsonc`, including the pinned Admin API version and requested scopes. Slice C relies on product and location read access; Slice D relies on order plus merchant-managed fulfilment-order read access. Before connecting a non-development store, confirm the Shopify app has every required approval for the intended store type. Do not broaden scopes merely to make OAuth succeed.

After successful OAuth/re-authentication, Operating Layer reconciles the shop-scoped operational subscriptions it owns: order create, order update, order cancel and app uninstall. Order subscriptions request only the identity fields needed to fetch current authoritative order state through GraphQL. Re-authentication must update a stale callback URI rather than creating duplicate subscriptions.

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

### Slice C catalogue/location acceptance

Before calling live Shopify discovery and mapping verified:

1. Confirm the configured Shopify Admin API version and the connected token have the required product/location read scopes before starting discovery.
2. In the staging workspace, create active Operating Layer variants with representative unique SKUs/barcodes and at least two active stock locations with distinct names/codes.
3. From Settings → Shopify, run **Sync Shopify catalogue** and verify catalogue and location checkpoints both complete with item counts and a new last-success timestamp.
4. Confirm exact SKU/barcode matches appear only as **suggestions**. Discovery itself must leave `integration_entity_links` unchanged until an Owner/Admin approves a mapping.
5. Confirm a Shopify variant whose SKU and barcode point at different local variants is marked ambiguous and cannot be bulk-approved as an exact suggestion.
6. Confirm two external Shopify variants (or locations) competing for the same exact local target are both marked ambiguous rather than suggesting one local record twice.
7. Confirm unmatched entities remain reviewable and can be manually mapped from the Settings UI; product titles are display context only and never an automatic matching signal.
8. Approve exact/manual variant and location mappings, refresh/re-open Settings, and confirm the one-to-one mappings persist.
9. Attempt to map two external entities to the same local target and confirm the second mapping is rejected.
10. Unmap an approved entity and confirm its current deterministic suggestion/ambiguous/unmatched state is recomputed rather than retaining stale status.
11. Remove or deactivate an external Shopify entity, re-run discovery, and confirm its approved link is retained as a stale historical mapping instead of being silently deleted.
12. Force a Shopify GraphQL/scoping failure and confirm the failed checkpoint/connection error is visible without changing canonical products, variants, locations, stock movements or inventory balances and without disabling an otherwise-valid webhook route.
13. Confirm a Manager can inspect connection/mapping health but cannot sync or mutate mappings; Inventory/Fulfilment/Viewer roles must not receive integration-settings access.
14. Confirm the browser-only guest demo performs no Shopify OAuth, sync or external request.

Slice C is a discovery/mapping layer only. It may persist external snapshots, suggestions, approved links and sync health, but it must not create/retire products or variants, change local locations, or mutate stock.

### Slice D order-ingestion acceptance

Before calling Shopify order ingestion verified against a real store:

1. Re-authenticate the staging Shopify connection and confirm exactly one active shop-scoped subscription exists for each owned operational topic: order create, order update, order cancel and app uninstall. All must target the staging webhook URL. Re-authentication must be idempotent.
2. Confirm order subscriptions are configured with the identity-only include-field set and that persisted `integration_events.payload_json` for an order webhook contains only order identity—not customer email, addresses or line-item data. HMAC verification must still be performed against the complete raw delivery before minimisation.
3. Create a Shopify order containing only approved mapped variants and ensure Shopify assigns all outstanding fulfilment quantity to one approved mapped Shopify location. Seed enough available Operating Layer stock first.
4. Confirm one canonical Operating Layer order is created, immediately confirmed, and reserves the mapped stock. Verify the local order keeps a stable ID and its header currency/subtotal/tax/total match Shopify current order facts rather than local catalogue pricing.
5. Replay the same Shopify webhook delivery ID and confirm no second event/order/reservation is created.
6. Change the Shopify quantity before Operating Layer fulfilment. Confirm the same local order ID is reconciled and only the reservation delta changes; old lines/reservations must not remain active.
7. Process an older Shopify order version after a newer one and confirm it is marked ignored without rolling canonical order state backwards.
8. Remove an approved variant mapping and trigger a Shopify order update. Confirm no partial order mutation occurs and an `unmapped_variant` exception is visible in Settings → Shopify.
9. Restore the mapping, trigger a later Shopify update, and confirm the order can proceed and the relevant exception resolves after successful processing.
10. Reduce available stock below the requested mapped quantity and trigger an update. Confirm the canonical order mutation is rolled back and an insufficient-stock exception is surfaced without corrupting existing reservations.
11. Split one Shopify order across multiple fulfilment locations. Confirm automatic import is blocked rather than assigning the whole order to an arbitrary warehouse.
12. Start fulfilment externally in Shopify before Operating Layer owns the matching fulfilment progression. Confirm the event is blocked rather than rewriting reservations around external fulfilment progress.
13. Cancel an unfulfilled Shopify order and confirm the same local order becomes cancelled and all active reservations are released.
14. Fulfil some/all of an imported order inside Operating Layer, then send a later Shopify edit/cancellation. Confirm the canonical rewrite is rejected and surfaced as an exception rather than rewriting fulfilled history.
15. Force a transient Shopify/GraphQL/Worker failure and confirm the queue delivery retries; mapping, stock and other deterministic business blocks must persist as exceptions and be acknowledged rather than repeatedly hammering Shopify.
16. Uninstall the Shopify app and confirm the verified `app/uninstalled` event moves both the tenant connection and control-plane route to disconnected. Subsequent order deliveries must not enter canonical processing.
17. Confirm a Manager can see order exceptions but cannot change mappings; Owner/Admin can use the same Settings screen to repair mapping issues.
18. Confirm the guest demo still sends no Shopify webhook, GraphQL or queue traffic.

Slice D does not publish stock or fulfilment state back to Shopify and it does not attempt to auto-handle multi-location orders or externally progressed fulfilments. Those are deliberately blocked until a later slice owns the bidirectional lifecycle safely.

### Shopify privacy/public-distribution gate

The operational subscriptions above are not a substitute for Shopify's mandatory privacy/compliance webhooks for public App Store distribution. Before any public distribution or app-review claim, configure and live-test the required customer-data request/redaction and shop-redaction topics using Shopify's required app configuration mechanism, and implement the corresponding deletion/export semantics against Operating Layer's retained data.

Do not point those mandatory compliance topics at the normal operational webhook route and call the requirement complete. In particular, shop redaction can arrive after uninstall, when the normal operational route is intentionally disconnected. Public distribution remains gated until that separate privacy lifecycle is implemented and verified.

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

The top-level production D1 ID remains intentionally unprovisioned/placeholder; staging deployment does not make the product production-ready. Shopify production credentials, encryption keys, app review/data-access approvals, privacy lifecycle and migration evidence must be established separately from staging.
