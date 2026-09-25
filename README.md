# OrderMate

OrderMate is a Cloudflare-native multi-tenant SaaS for products, purchasing, orders and inventory.

## Architecture

- React + Vite frontend served by Cloudflare Workers Static Assets.
- Hono API on Cloudflare Workers.
- Better Auth with Google OAuth.
- D1 control plane for users, sessions, organizations, memberships and workspace invitations.
- One EU-jurisdiction SQLite-backed Durable Object per tenant for operational data.
- EU-jurisdiction R2 for source documents, proposal sidecars and future product media.
- Cloudflare Queues for asynchronous document/automation events, with a dead-letter queue for bounded failure handling.
- Optional Cloudflare Workers AI document extraction. It is built in but disabled by default for an explicit compliance decision.
- Wrangler is the source of truth for deployable Cloudflare resources.

See `docs/architecture.md` and `docs/delivery-plan.md`.

## Delivered product foundations

OrderMate currently includes:

- Google sign-in, multiple businesses per user, invitations and role-based access;
- products, arbitrary option dimensions, variants, SKUs, barcodes and modifiers;
- create-only CSV catalogue onboarding with dry-run validation, arbitrary `option:<name>` columns, supplier mapping and opening stock committed atomically;
- multi-location stock with on-hand, reserved, available and incoming quantities;
- immutable inventory movements, transfers, adjustments and barcode lookup;
- a dedicated Warehouse workspace for barcode-driven picking and PO receiving using hardware scanners, manual input or lazy-loaded mobile camera scanning;
- suppliers, supplier-SKU mappings, purchase orders, partial receiving and cancellation;
- deterministic replenishment suggestions using available/incoming stock, recent fulfilment demand and supplier lead time;
- per-SKU/location replenishment rules for reorder point, target stock at supplier arrival and preferred supplier;
- customers, order snapshots, reservation, partial/full fulfilment, cancellation and returns;
- global search, operational attention inbox, audit/activity, CSV exports and record detail views;
- tenant-scoped R2 purchasing documents and human-reviewed AI extraction for purchase documents and delivery notes;
- non-destructive catalogue archive/restore and maintainable supplier/customer records; and
- ordered tenant-schema migration tracking, currently schema v2.

## Local setup

1. Install the pinned dependencies:

   ```sh
   npm install
   ```

2. Authenticate the repository-pinned Wrangler CLI:

   ```sh
   npx wrangler login
   ```

3. Bootstrap the compliance-sensitive Cloudflare resources:

   ```sh
   npm run cf:bootstrap
   ```

   The script creates:

   - `ordermate-control` as an EU-jurisdiction D1 database and writes its `CONTROL_DB` binding into `wrangler.jsonc`;
   - `ordermate-documents` as an EU-jurisdiction R2 bucket;
   - `ordermate-events` as the application queue; and
   - `ordermate-events-dead` as its extraction dead-letter queue.

   The tenant SQLite Durable Object namespace is created from the Wrangler migration on deploy. The Workers AI binding is declared directly in `wrangler.jsonc` and does not require another provider credential.

4. Create a Google OAuth **Web application** client. For local development, add the Better Auth redirect URI for the origin printed by Vite, ending in:

   ```text
   /api/auth/callback/google
   ```

   For example, if the local application is `http://localhost:5173`, use `http://localhost:5173/api/auth/callback/google`.

5. Create `.dev.vars` from `.env.example` and set:

   ```text
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   BETTER_AUTH_SECRET=...
   ```

   Use a cryptographically random, high-entropy value for `BETTER_AUTH_SECRET`. Never commit `.dev.vars`.

6. Apply the D1 control-plane migrations locally:

   ```sh
   npm run db:migrate:local
   ```

7. Run OrderMate locally:

   ```sh
   npm run dev
   ```

## Catalogue CSV onboarding

Products -> **Import CSV** provides a reviewed onboarding path for new catalogues.

The template supports product/variant commercial fields, arbitrary option columns such as `option:Size`, supplier mapping and optional opening stock at an existing location code.

The flow is intentionally safe:

`browser parse -> tenant dry-run -> explicit review -> fingerprint re-check -> one SQLite transaction`

The browser parser is not trusted as validation. Commit revalidates against current tenant state, rejects stale previews and rolls back the entire import if any write fails. Opening stock creates normal immutable inventory movements rather than bypassing the stock ledger.

## AI purchase-document extraction

The workflow is deliberately proposal-based:

`EU R2 source -> Queue -> Cloudflare document conversion -> Workers AI JSON extraction -> deterministic OrderMate matching -> R2 proposal -> human review -> draft PO`

AI never submits a PO, receives stock, adjusts inventory or fulfils an order.

Exact matching is limited to known supplier identity, supplier SKU, barcode and OrderMate SKU. Ambiguous lines stay unmatched for human correction. Raw converted Markdown is not persisted; R2 stores the original source and the structured proposal.

Delivery-note assistance follows the same trust boundary but is anchored to one existing PO and only stages reviewed quantities into the Warehouse receiving flow; the canonical PO receipt still performs the actual inventory mutation.

### Residency gate

`AI_DOCUMENT_EXTRACTION_ENABLED` is `false` by default in `wrangler.jsonc`.

This is intentional. D1, Durable Object storage and R2 are explicitly configured for EU jurisdiction where supported. Workers AI is still a Cloudflare service, but Cloudflare's current Data Localization compatibility documentation does not list Workers AI as supporting Regional Services. Enable document extraction only after that processing posture is acceptable for the product's compliance requirements:

```jsonc
"vars": {
  "AI_DOCUMENT_EXTRACTION_ENABLED": "true"
}
```

When the flag is false, purchasing documents can still be stored and reviewed from EU R2, but no document event is sent for AI extraction.

PDFs use Cloudflare Markdown conversion with PDF metadata disabled before structured extraction. Image conversion is treated as best-effort and proposals from images are always flagged for explicit review.

## Verification

Before proposing a material change for merge:

```sh
npm run typecheck
npm test
npm run build
```

The test suite runs the Worker and SQLite-backed Durable Objects using Cloudflare's Vitest integration. Tenant isolation, authorization, inventory consistency, schema upgrades, barcode/warehouse invariants, deterministic document matching and import atomicity are required regression areas.

## Production configuration

Add the production application origin to the same Google OAuth client, using:

```text
https://<your-domain>/api/auth/callback/google
```

Store production credentials as Worker secrets rather than Wrangler vars or repository files:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
```

Apply the control-plane migrations before deploying application code:

```sh
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` builds the React client and deploys the Worker, static assets, Durable Object migration and bindings through Wrangler.

## Cloudflare-only infrastructure rule

OrderMate's application runtime and durable product/customer data stay on Cloudflare unless the architecture is explicitly changed. Do not introduce AWS, Azure, GCP, Vercel, Neon, Supabase or another hosted runtime/database as an implicit dependency. Google is used only as the OAuth identity provider.
