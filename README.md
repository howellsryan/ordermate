# Operating Layer

Operating Layer is a Cloudflare-native multi-tenant SaaS for inventory, purchasing, orders and warehouse operations.

> Continuing this rebuild in a new session? Start with `docs/next-agent-handoff.md`.

> **Compatibility note:** customer-facing identity is Operating Layer. Existing `ordermate-*` Cloudflare resource names, the staging hostname and `x-ordermate-*` internal headers remain legacy infrastructure identifiers until an explicit migration/cutover is approved. See `docs/brand.md`.

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

See `docs/architecture.md`, `docs/delivery-plan.md`, `docs/brand.md` and `docs/seo.md`.

## Delivered product foundations

Operating Layer currently includes:

- Google sign-in, multiple businesses per user, invitations and role-based access;
- products, arbitrary option dimensions, variants, SKUs, barcodes and modifiers;
- create-only CSV catalogue onboarding with dry-run validation, arbitrary `option:<name>` columns, supplier mapping and opening stock committed atomically;
- non-destructive single and atomic bulk product archive/restore;
- multi-location stock with on-hand, reserved, available and incoming quantities;
- immutable inventory movements, transfers, adjustments and barcode lookup;
- reviewed partial cycle counts with stale-stock protection, reservation safeguards and one atomic stocktake commit;
- a dedicated Warehouse workspace for barcode-driven picking and PO receiving using hardware scanners, manual input or lazy-loaded mobile camera scanning;
- Wave Picking for 2-10 same-location confirmed orders, with aggregate scanning, deterministic per-order allocation review and fulfilment through the existing canonical order endpoints;
- suppliers, supplier-SKU mappings, purchase orders, expected delivery dates, overdue visibility, partial receiving and cancellation;
- persistent delivery discrepancies with evidence and audited open/resolved handling;
- deterministic replenishment suggestions using available/incoming stock, recent fulfilment demand and supplier lead time;
- per-SKU/location replenishment rules for reorder point, target stock at supplier arrival and preferred supplier;
- reviewed supplier-SKU learning from purchase-document proposals without fuzzy or ambiguous mapping;
- customers, order snapshots, reservation, partial/full fulfilment, cancellation and returns;
- explicit order required-by dates and low/normal/high/urgent planning priority with urgency-aware fulfilment queues;
- global search, operational attention inbox, audit/activity, CSV exports and record detail views;
- private cross-device saved views for Inventory and Purchasing;
- deterministic Operations Reports for stock valuation/health, confirmed/completed order value, physical throughput and purchasing commitments;
- tenant-scoped R2 purchasing documents and human-reviewed AI extraction for purchase documents and delivery notes;
- maintainable supplier/customer records; and
- ordered tenant-schema migration tracking, currently schema v6.

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

   The script creates the existing compatibility-named infrastructure:

   - `ordermate-control` as an EU-jurisdiction D1 database and writes its `CONTROL_DB` binding into `wrangler.jsonc`;
   - `ordermate-documents` as an EU-jurisdiction R2 bucket;
   - `ordermate-events` as the application queue; and
   - `ordermate-events-dead` as its extraction dead-letter queue.

   These names are infrastructure identifiers, not public brand copy. Do not rename provisioned resources as part of a visual/product rebrand.

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

7. Run Operating Layer locally:

   ```sh
   npm run dev
   ```

## Catalogue CSV onboarding

Products -> **Import CSV** provides a reviewed onboarding path for new catalogues.

The template supports product/variant commercial fields, arbitrary option columns such as `option:Size`, supplier mapping and optional opening stock at an existing location code.

The flow is intentionally safe:

`browser parse -> tenant dry-run -> explicit review -> fingerprint re-check -> one SQLite transaction`

The browser parser is not trusted as validation. Commit revalidates against current tenant state, rejects stale previews and rolls back the entire import if any write fails. Opening stock creates normal immutable inventory movements rather than bypassing the stock ledger.

## Inventory cycle counts

Cycle Count is a reviewed partial stocktake rather than a destructive full-location overwrite.

- blank means the SKU was not counted and will not be touched;
- zero is a real reviewed physical count;
- hardware scanners, manual barcode entry and the mobile camera scanner are supported;
- Operating Layer snapshots on-hand/reserved quantities as each SKU enters the count;
- any stale stock/reservation change rejects the whole batch before mutation; and
- successful variances share one stocktake reference and are committed atomically with an audit event.

## Wave Picking

Wave Picking is an efficiency layer over the canonical order fulfilment engine, not a second stock-mutation path.

- select 2-10 confirmed orders from one stock location;
- scan aggregate SKU quantities once using hardware/manual/camera entry;
- review deterministic allocation back to exact order lines in urgency order;
- every selected order must have at least one allocated unit before commit;
- excess/unallocatable staged quantities block commit; and
- each affected order is fulfilled through the existing `/orders/:id/fulfil` endpoint.

If one order fails after other orders have succeeded, successful orders are not retried. The operator refreshes and re-scans only the failed remainder. This intentionally prefers correct per-order reservation semantics over pretending a multi-order wave is one atomic inventory transaction.

## Saved views and bulk catalogue actions

Inventory and Purchasing filters can be saved per signed-in user inside the tenant datastore, so operational views follow the user across devices without becoming shared workspace state. Users in the same business cannot list or delete one another's views.

Products supports atomic bulk archive/restore for up to 200 selected records. Operating Layer verifies the entire selection before mutation; a missing product rejects the whole action. Product/variant retirement semantics and per-product audit events match the single-record workflow.

## Operations Reports

Reports are deterministic read models over canonical tenant records. The workspace supports 7/30/60/90-day windows and includes:

- inventory at cost, availability/reservations/incoming and stock-health counts;
- confirmed/completed gross order value rather than payment/revenue claims;
- fulfilled, returned and received physical units;
- outstanding pro-rated PO commitment and overdue PO count;
- stock valuation by location; and
- top fulfilled SKUs plus daily order/movement trends.

Commercial Operations Reports use a separate `analytics:read` permission. Fulfilment users retain Activity/Audit access without receiving purchasing analytics.

## Purchase-order expected delivery

Open purchase orders may carry an explicit expected delivery date. If none is supplied, submission derives one only when every PO line has a known lead-time mapping for that supplier, using the slowest mapped line. If coverage is incomplete, the date remains unset rather than being guessed.

Overdue expected dates are surfaced operationally in purchasing and the attention inbox while the PO keeps its canonical lifecycle status (`ordered` or `partially_received`). Expected dates are also included in PO exports.

## Delivery discrepancy control

A reviewed delivery-note receipt creates a persistent discrepancy only when concrete evidence differs: wrong PO reference, unexpected/over-delivered lines, or a physical receipt quantity that differs from the reviewed document proposal. Normal matching partial shipments do not create noise.

Discrepancies remain linked to the immutable R2 proposal/source evidence. Resolution requires an explicit outcome and note, is audited, and never rewrites inventory or the completed receipt.

## AI purchase-document extraction

The workflow is deliberately proposal-based:

`EU R2 source -> Queue -> Cloudflare document conversion -> Workers AI JSON extraction -> deterministic Operating Layer matching -> R2 proposal -> human review -> draft PO`

AI never submits a PO, receives stock, adjusts inventory or fulfils an order.

Exact matching is limited to known supplier identity, supplier SKU, barcode and Operating Layer SKU. Ambiguous lines stay unmatched for human correction. Raw converted Markdown is not persisted; R2 stores the original source and the structured proposal.

Reviewed proposal lines can explicitly remember a supplier SKU for the human-confirmed supplier/variant. Replacement mappings require opt-in and conflicting mappings are rejected; this improves later exact matching without letting the model silently learn identities.

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

The test suite runs the Worker and SQLite-backed Durable Objects using Cloudflare's Vitest integration. Tenant isolation, authorization, inventory consistency, schema upgrades, stocktake/warehouse/wave-pick invariants, PO due-date/discrepancy rules, saved-view privacy, report reconciliation, deterministic document matching and import/bulk atomicity are required regression areas.

The current rebuild PR intentionally remains draft until the dependency graph is installed, a lockfile is committed, those commands pass, and critical browser flows (including Wave Picking) receive a manual smoke pass. See `docs/next-agent-handoff.md` for the continuation sequence.

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

Operating Layer's application runtime and durable product/customer data stay on Cloudflare unless the architecture is explicitly changed. Do not introduce AWS, Azure, GCP, Vercel, Neon, Supabase or another hosted runtime/database as an implicit dependency. Google is used only as the OAuth identity provider.
