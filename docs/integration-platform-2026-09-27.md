# Operating Layer integration platform — Shopify-first architecture

Prepared 27 September 2026 against the product delivered through PRs #4–#8 and continued on PR #9.

## Decision

Build one provider-neutral integration spine, then ship Shopify as the first production connector. Do not add provider-specific SQL or direct provider-to-domain mutations.

The integration layer exists to bring external facts into Operating Layer and publish approved/canonical outcomes back out. Existing order, fulfilment, return and inventory invariants remain authoritative.

This removes the largest current SME buying veto without turning Operating Layer into a collection of one-off integrations.

## Why Shopify first

Current category leaders teach buyers to expect their commerce channel to connect to the inventory/operations system:

- Cin7 advertises real-time Shopify order/inventory sync alongside Xero and QuickBooks and a broad integration catalogue.
- Linnworks describes channel connections as two-way: orders in, inventory/listings out, tracking back.
- Katana's Shopify integration brings orders into Katana, supports location mapping and can publish available inventory back to Shopify.
- Zoho Inventory advertises Shopify auto-sync for stock, sales orders and shipments.

Operating Layer already has a strong canonical order/inventory/purchasing loop. The commercial gap is that an ecommerce SME must currently recreate demand manually before that loop can help it.

## Shopify API baseline

Use the GraphQL Admin API for new development. Shopify marks the REST Admin API legacy and requires new public apps to use GraphQL.

Use webhooks for production change delivery rather than polling. Shopify's Events successor remains developer preview for a subset of topics, so it should not be the production dependency yet.

Background sync requires an offline access token. Public GraphQL apps must be designed for expiring offline access tokens and refresh; Shopify states this becomes mandatory for public apps by 1 January 2027.

Primary references:

- https://shopify.dev/docs/apps/build/apis
- https://shopify.dev/docs/api/admin-graphql/latest
- https://shopify.dev/docs/apps/build/webhooks/subscribe
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens

## Source-of-truth boundaries

### Shopify owns

- storefront checkout and payment-facing ecommerce experience;
- its permanent shop identity;
- the external order/customer/product/location identifiers it emits;
- Shopify-side fulfilment/tracking representation after Operating Layer publishes it.

### Operating Layer owns

- canonical operational order state after successful import;
- stock reservations, on-hand movements and availability calculations;
- fulfilment and return mutations through the existing reviewed domain paths;
- purchasing, replenishment, supplier decisions and operational exceptions;
- audit history and operator attribution.

### Never do

- never write inventory SQL directly from a Shopify adapter;
- never bypass order confirmation/reservation rules because the source is trusted;
- never accept a webhook before verifying its authenticity;
- never use a browser-supplied tenant ID to route a webhook;
- never silently drop an unmapped product/location or malformed order;
- never let an outbound inventory update feed back in as a second canonical stock mutation;
- never log access/refresh tokens or raw credential-bearing responses.

## Control-plane routing

Inbound webhooks arrive without an authenticated Operating Layer user, so tenant routing cannot use the existing browser tenant selector.

Slice B adds D1 control-plane tables:

### `integration_routes`

- provider;
- permanent external account identity (`*.myshopify.com` for Shopify);
- tenant ID;
- connection ID;
- route status;
- timestamps;
- unique `(provider, external_account_id)`.

### `integration_oauth_states`

A short-lived, one-time OAuth state registry keyed by a hash of the browser-bound state value. It records the initiating tenant/user/shop, expiry and consumption timestamp. The plaintext state remains in an HttpOnly, Secure, SameSite=Lax callback-scoped cookie and is not used as a tenant selector after callback validation.

This is routing/authentication metadata, not tenant operational data, so D1 remains within the existing control-plane boundary.

Inbound flow:

1. verify Shopify HMAC against the raw webhook body before trusting any Shopify header;
2. derive the permanent shop identity from signed provider metadata;
3. resolve the route in D1;
4. forward only the verified tenant/connection identity through an internal Worker-to-Durable-Object route;
5. record/deduplicate the event in that tenant's Durable Object using Shopify's delivery ID;
6. later slices process the recorded event into reviewed/canonical domain intent.

Slice B deliberately stops at receipt. It does **not** create orders, reserve stock, fulfil orders or mutate returns.

## Tenant integration data

Tenant-specific integration state stays in the tenant Durable Object under composed integration runtimes with their own monotonic `_integration_schema_migrations` table. This avoids adding another `TenantStore extends ...` layer while retaining fail-closed storage versioning.

### `integration_connections`

Non-secret connection metadata, enabled capabilities, health/last event state and timestamps.

### `integration_credentials`

Encrypted per-store credential envelopes and non-secret rotation metadata. This table is only reachable through Worker-internal integration routes; the normal `/integrations` response never serializes token material or ciphertext.

### `integration_entity_links`

Maps one external entity to one canonical entity using `(provider, connection_id, entity_type, external_id)`. Slice C also enforces one local target per external entity type/connection so two Shopify variants or locations cannot be approved against the same Operating Layer entity.

### `integration_external_entities`

Slice C stores the latest provider snapshot needed for reviewed mapping without copying Shopify into canonical catalogue tables. Each discovered variant/location records its external ID, display context, minimal provider payload, external timestamp and current `mapped` / `suggested` / `ambiguous` / `unmatched` state.

### `integration_sync_checkpoints`

Slice C records independent catalogue/location discovery checkpoints, item counts, start/completion/failure state and error detail. The connection's last successful sync is advanced only after both resources complete.

### `integration_events`

Append-oriented event receipt with provider delivery ID, provider action/event ID where supplied, topic, API version, timestamps, attempts/status and a deterministic dedupe key. The same Shopify `X-Shopify-Webhook-Id` cannot insert a second tenant event.

### `integration_exceptions`

Actionable failures such as unmapped variant, unmapped location, stale event, conflicting mapping or canonical domain rejection. Later slices should feed these into the persistent Operations Work Queue rather than build a separate dead-end alert screen.

## Credentials

Application-level Shopify client credentials stay in Wrangler secrets.

Per-store access/refresh tokens are encrypted before entering Durable Object storage using AES-256-GCM with:

- a cryptographically random 32-byte Worker-held key supplied as a secret;
- a 12-byte random IV per envelope;
- authenticated key-version context;
- explicit key-version metadata for future rotation.

The plaintext access/refresh tokens exist only transiently in Worker memory during OAuth exchange/refresh. Public integration read routes return only non-secret connection metadata.

OAuth code exchange explicitly requests expiring offline tokens. Refresh uses Shopify's refresh-token grant and replaces both rotated tokens in one encrypted credential update. Slice C reuses the same credential boundary for GraphQL discovery and refreshes an expiring access token before discovery when required.

## OAuth correctness

Slice B enforces:

- Owner/Admin initiation only;
- permanent `*.myshopify.com` shop identity;
- random browser-bound state with a 10-minute expiry;
- one-time state consumption;
- callback HMAC verification over Shopify's canonical sorted query parameters;
- shop equality against the shop stored with the OAuth state;
- re-check of initiating user's Owner/Admin membership before credential persistence;
- one shop route cannot be claimed by two workspaces;
- required-scope validation before a connection becomes active.

## Event correctness

Slice B establishes these invariants:

- webhook signature verified before tenant lookup/processing;
- globally routable by signed Shopify shop identity;
- idempotent on Shopify delivery ID within the connection;
- tenant event state physically isolated by Durable Object;
- event connection/provider/shop mismatch rejected;
- internal credential/event routes hidden from normal tenant API calls;
- raw event receipt cannot bypass canonical domain validation because no canonical mutation is performed yet;
- unsupported queue event types retry instead of being silently acknowledged.

Still required in later processing slices:

- retry-safe canonical event processing after partial failure;
- out-of-order order/update semantics;
- bounded processing attempts and operator-facing poison-event exceptions;
- replay proof for actual order/reservation/fulfilment/return mutations.

## Catalogue/location mapping correctness

Slice C deliberately separates **discovery evidence** from **approved identity links**.

Variant matching uses only exact normalized SKU/barcode evidence:

- exact unique SKU and/or barcode → suggestion;
- SKU/barcode pointing to different local variants → ambiguous;
- no exact evidence → unmatched;
- titles/names are display context only and never automatic variant identity;
- two Shopify variants competing for the same exact local variant → both ambiguous;
- an approved local target already owned by another external entity → ambiguous/rejected.

Location matching may suggest an exact normalized Shopify location name against an active Operating Layer location name/code, but it is still never auto-approved. Location mappings are explicit before later order/inventory processing can depend on them.

All suggestions require Owner/Admin approval. Managers may inspect integration health and mapping state but cannot sync or mutate mappings. Inventory/Fulfilment/Viewer roles have no integration-settings grant.

A Shopify discovery refresh replaces the current external snapshot for that resource but deliberately retains approved links whose external entity is no longer returned. Those links are surfaced as stale historical mappings rather than silently deleted. Mapping/unmapping recomputes the affected suggestion set so stale collision state cannot linger.

Slice C does **not** create, rename, retire or update Operating Layer products/variants/locations, and it performs no stock movement or inventory mutation.

## Shopify MVP sequence

### Slice A — integration foundation — delivered

- provider-neutral types;
- collision-safe connection, event and external-entity identity helpers;
- permanent Shopify shop-domain normalization;
- explicit canonical mutation-intent boundary;
- architecture and product roadmap.

### Slice B — connection + routing — source delivered on PR #9

- D1 route/OAuth-state migration;
- composed tenant integration schema and runtime;
- encrypted per-store credential envelope;
- Owner/Admin Shopify install flow;
- callback state + HMAC verification;
- expiring offline-token exchange and refresh rotation;
- verified webhook ingress and D1 tenant routing;
- idempotent tenant event receipt;
- public connection metadata without credential exposure;
- tenant isolation, replay, cryptography and signature tests;
- staging deployment/security acceptance documented.

**Environment gate:** source completion is not a claim that a live Shopify store is connected. Staging still needs the D1 migration applied, real Shopify app credentials, a generated 32-byte encryption secret, callback/webhook app configuration and a live OAuth/webhook smoke pass. See `docs/staging.md`.

### Slice C — catalogue/location mapping — source delivered on PR #9

- paginated Shopify GraphQL Admin API discovery for product variants and locations;
- configured API-version pinning and fail-closed GraphQL error handling;
- token refresh through the existing encrypted credential path before discovery when required;
- provider-neutral external snapshot and sync-checkpoint storage;
- deterministic exact SKU/barcode variant suggestions;
- explicit collision handling for conflicting evidence and competing external entities;
- explicit reviewed Shopify location → Operating Layer location mapping;
- one-to-one approved mapping invariant;
- retained stale approved links for historical identity;
- connection/checkpoint health and last-complete-sync state;
- Owner/Admin Settings workflow to connect, sync, approve exact suggestions, manually map and unmap;
- Manager read-only health/mapping visibility;
- guest demo performs no external Shopify request;
- regression coverage for pagination, API errors, schema upgrades, suggestions, ambiguity, one-to-one mapping, unmapping and stale-link behavior.

**Environment gate:** Slice C source completion is not a claim that a live Shopify catalogue has been synchronized in staging. Live acceptance requires a real connected Shopify development/test store, required product/location read access and the mapping acceptance pass in `docs/staging.md`.

### Slice D — orders in

- subscribe to order create/update/cancel plus required privacy/app lifecycle topics;
- normalize Shopify order facts into a provider-neutral proposal;
- resolve only approved variant/location mappings;
- create/update through canonical order services;
- idempotent retries and out-of-order protection;
- unmapped lines become integration exceptions, never silent partial orders.

### Slice E — inventory + fulfilment out

- publish Operating Layer **available** stock for mapped variants/locations;
- coalesce high-frequency stock changes and respect Shopify rate limits;
- publish fulfilment/tracking only after canonical fulfilment succeeds;
- handle partial fulfilments explicitly;
- loop prevention and reconciliation checks.

### Slice F — returns + reconciliation

- consume relevant Shopify return/refund facts without assuming refund equals restock;
- map only operationally valid restocks through the existing return path;
- periodic reconciliation for missed events;
- health dashboard: last event, last successful sync, lag, outstanding exceptions.

## Accounting follows the same spine

After Shopify proves the integration platform, add Xero as the first UK accounting path and QuickBooks Online next. Accounting remains the financial source of truth; Operating Layer should publish/reconcile operational accounting facts rather than grow a general ledger.

Do not couple accounting sync to the Shopify adapter. Both providers use the same connection/event/entity-link/exception foundation with provider-specific adapters.

## Architecture rule for implementation

The current Durable Object runtime already has a legacy inheritance chain. New integration work follows the newer composition pattern used by `ServiceRuntime`, `FeatureRuntime` and `BusinessProfileRuntime`: integration runtimes are composed into the canonical store rather than creating another `TenantStore extends ...` layer.

The guest demo should consume shared integration-domain planning/normalization functions where integration behavior becomes demonstrable. Do not build a second independent integration engine in `demo-store.ts`.

## Definition of done for the first live Shopify release

A design-partner ecommerce SME can connect a Shopify store, map locations/catalogue, receive new Shopify orders automatically, see inventory reservations affect Operating Layer availability, publish available inventory back to Shopify, fulfil partially or fully in Operating Layer and have that outcome reflected in Shopify. Replaying the same webhook cannot duplicate any canonical mutation, and mapping/sync failures appear as reviewable operational exceptions.
