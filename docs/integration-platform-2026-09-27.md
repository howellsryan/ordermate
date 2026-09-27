# Operating Layer integration platform — Shopify-first architecture

Prepared 27 September 2026 against `main` at `a3e25e588ac8803f5653135a2c341a198d83bcfd`.

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

Background sync requires an offline access token. For a public app, design for expiring offline access tokens and refresh now; Shopify states public apps must use expiring offline tokens for GraphQL Admin API requests by 1 January 2027.

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

Add a small D1 control-plane registry:

`integration_routes`

- `provider`
- `external_account_id` — Shopify permanent `*.myshopify.com` domain for Shopify
- `tenant_id`
- `connection_id`
- `status`
- timestamps
- unique `(provider, external_account_id)`

This is routing metadata, not tenant operational data, so D1 remains within the existing control-plane boundary.

Flow:

1. verify provider signature at the public Worker;
2. derive the permanent external account identity from provider-authenticated metadata;
3. resolve the route in D1;
4. forward only the verified tenant/connection identity internally;
5. record/deduplicate the event in that tenant's Durable Object;
6. enqueue durable processing by event ID where asynchronous work is needed.

## Tenant integration data

Keep tenant-specific integration state in the tenant Durable Object:

### `integration_connections`

Non-secret connection metadata, sync mode, enabled capabilities, health, last success/failure and timestamps.

### `integration_entity_links`

Maps one external entity to one canonical entity using `(provider, connection_id, entity_type, external_id)`. This is the stable bridge for orders, variants, locations, customers, fulfilments and returns.

### `integration_events`

Append-oriented event receipt with provider event ID, topic, status, attempts, timestamps and a deterministic dedupe key. Store only the minimum payload needed for replay/diagnosis and apply retention deliberately.

### `integration_exceptions`

Actionable failures such as unmapped variant, unmapped location, stale event, conflicting mapping or canonical domain rejection. These should eventually feed the persistent Operations Work Queue rather than become a separate dead-end screen.

## Credentials

Do not store app credentials in tenant data. App-level Shopify secrets belong in Wrangler secrets.

Per-store access/refresh tokens are credentials and must not be exposed to the browser or logs. Before the live connector, implement a dedicated encrypted credential envelope using a Worker-held encryption key, rotation metadata and least-privilege scopes. Store ciphertext plus metadata only.

Credential code must be isolated from normal integration metadata so connection/list endpoints can never accidentally serialize tokens.

## Event correctness

Every inbound event needs all of these properties before a production Shopify launch:

- signature verified before tenant lookup/processing;
- globally routable by provider-authenticated account identity;
- idempotent on provider event ID + connection;
- retry-safe after partial failure;
- tolerant of out-of-order delivery;
- auditable with a system integration actor;
- unable to bypass canonical domain validation;
- poison events visible as operator exceptions after bounded retries;
- replay does not duplicate orders, reservations, fulfilments, returns or stock movements.

The new `src/shared/integration-contract.ts` starts the stable identity/idempotency contract without introducing a provider-specific mutation path.

## Shopify MVP sequence

### Slice A — integration foundation

Delivered/started in this PR:

- provider-neutral types;
- collision-safe connection, event and external-entity identity helpers;
- permanent Shopify shop-domain normalization;
- explicit canonical mutation intent boundary;
- architecture and product roadmap.

No production connector is claimed yet.

### Slice B — connection + routing

- D1 `integration_routes` migration;
- tenant `integration_connections`, event/link/exception tables;
- owner/admin connection settings API;
- encrypted token envelope;
- Shopify install/OAuth/token refresh;
- webhook signature verification and route resolution;
- tenant-isolation and replay tests.

### Slice C — catalogue/location mapping

- read Shopify products/variants/locations via GraphQL;
- match SKU/barcode where deterministic;
- reviewed mapping/import for ambiguous or missing variants;
- explicit Shopify location → Operating Layer location mapping;
- initial sync checkpoint and connection health.

### Slice D — orders in

- subscribe to order create/update/cancel plus required privacy/app lifecycle topics;
- normalize Shopify order facts into a provider-neutral proposal;
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

The current Durable Object runtime already has a legacy inheritance chain. New integration work must follow the newer composition pattern used by `ServiceRuntime`, `FeatureRuntime` and `BusinessProfileRuntime`: a dedicated `IntegrationRuntime` handler composed into the canonical store rather than another `TenantStore extends ...` layer.

The guest demo should consume shared integration-domain planning/normalization functions. Do not build a second independent integration engine in `demo-store.ts`.

## Definition of done for the first live Shopify release

A design-partner ecommerce SME can connect a Shopify store, map locations/catalogue, receive new Shopify orders automatically, see inventory reservations affect Operating Layer availability, publish available inventory back to Shopify, fulfil partially or fully in Operating Layer and have that outcome reflected in Shopify. Replaying the same webhook cannot duplicate any canonical mutation, and mapping/sync failures appear as reviewable operational exceptions.
