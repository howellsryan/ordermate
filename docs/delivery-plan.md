# OrderMate delivery plan

## Product direction

OrderMate is being rebuilt as a Cloudflare-native operational SaaS for businesses that need catalogue, order, purchasing and inventory control. The product deliberately starts broad rather than assuming one retail vertical, but its core is designed for multi-location physical-stock operations.

Canonical business mutations remain deterministic, transactional and auditable. AI is an evidence-extraction/proposal layer only.

## Platform constraints

- Cloudflare hosts the application runtime and durable application data.
- Wrangler owns deployable infrastructure/configuration.
- Google is the OAuth identity provider only.
- No AWS/Neon/Vercel/Supabase/other hosted runtime/database dependency is part of the architecture.
- Tenant operational data is physically isolated in one EU-jurisdiction SQLite Durable Object per business.
- D1 is the identity/session/organization control plane.
- R2 stores source documents/proposals.
- Queues provide asynchronous event handling; bounded failures go to a DLQ.
- Workers AI remains optional and disabled by default pending explicit compliance acceptance.

## Delivered vertical slices

### Foundation
- React/Vite + Hono Worker deployment shape.
- Better Auth Google OAuth.
- D1 organizations/members/invites.
- per-business Durable Object storage.
- role-based server authorization and role-aware UI.
- cross-site mutation protection, masked API 5xx responses and tenant-scoped actor attribution.
- ordered Durable Object schema migrations with verified v1 baseline and replay-safe evolution through **v6**.

### Catalogue
- products/categories/modifiers.
- arbitrary option dimensions + generated variants.
- SKU/barcode/price/cost/tax.
- audited product editing.
- archive/restore without historical deletion.
- atomic bulk archive/restore.
- reviewed create-only CSV onboarding with server dry-run/fingerprint/atomic commit.

### Inventory
- multi-location stock.
- on-hand/reserved/available/incoming.
- immutable movement ledger.
- adjustments/transfers/barcode lookup.
- tracked-zero vs never-stocked semantics.
- partial stocktake/cycle count with stale-snapshot and reservation protection.

### Purchasing
- suppliers and supplier/variant mapping.
- draft/submitted POs, partial receive/cancel.
- expected-delivery dates with conservative supplier-lead-time derivation.
- overdue operational visibility.
- deterministic replenishment + per-SKU/location policies.
- supplier SKU learning only from explicit human review.
- delivery discrepancy open/resolved lifecycle.

### Orders
- customers.
- snapshot-based draft orders.
- confirmation/reservation and oversell protection.
- partial/full fulfilment.
- cancellation/release.
- returns with optional restock.
- schema-v6 explicit `required_by_date` + `low/normal/high/urgent` priority.
- dedicated order-planning RBAC: warehouse fulfilment can execute work without redefining customer/operational commitments.
- deterministic urgency-aware Warehouse picking.

### Warehouse
- dedicated Pick & Fulfil and Receive Stock workspace.
- hardware/manual barcode input.
- lazy-loaded ZXing mobile camera scanning.
- exact document-aware scan validation and bounded counts.
- delivery-note-assisted receiving remains a reviewed staging step before canonical receipt.
- cycle counting available as a separate reviewed reconciliation workflow.
- Wave Picking for 2-10 confirmed orders from one location.
- wave scanning aggregates SKU quantities client-side, then deterministically expands them back into exact order lines for review.
- every selected wave order must have staged work before commit; excess/unallocatable counts block commit.
- wave commit reuses `/orders/:id/fulfil` per order and exposes partial failures rather than pretending a multi-order wave is atomic.

### Operations UX
- global search.
- role-aware attention inbox.
- record detail views.
- searchable audit history and permission-checked CSV export.
- actor-private cross-device saved views for Inventory/Purchasing.
- deterministic 7/30/60/90-day Operations Reports with separate commercial `analytics:read` authorization.
- order priority/required-by shown in Orders, detail, Warehouse, search, attention and exports.

### Document automation
- purchase source upload to EU R2.
- Queue + Workers AI extraction when compliance flag is enabled.
- strict structured proposal validation.
- deterministic exact supplier/SKU/barcode/internal-SKU matching.
- human-reviewed draft PO creation.
- delivery-note proposal anchored to one existing PO.
- no autonomous PO/stock/order mutation.

## Current schema evolution

1. **v1** verified baseline operational schema.
2. **v2** `inventory_policies`.
3. **v3** `purchase_orders.expected_delivery_date` + index.
4. **v4** `delivery_discrepancies`.
5. **v5** actor-private `saved_views`.
6. **v6** `orders.required_by_date`, constrained `orders.priority`, open-order planning index.

Future schema changes must remain ordered, replay-safe and covered by fresh + previous-version upgrade tests.

## Immediate next milestone: verify and harden

Feature expansion stops here for this delivery thread. The next agent should begin from `docs/next-agent-handoff.md` and make verification the first priority.

Required sequence:

1. install dependencies with `npm install` and commit the generated `package-lock.json`;
2. run `npm run typecheck`;
3. run `npm test`;
4. run `npm run build`;
5. fix failures without weakening tenant, authorization, inventory or migration invariants;
6. perform a browser/manual smoke pass of critical flows, including Wave Picking success and partial-failure recovery;
7. review Draft PR #3 holistically for security, tenant isolation, stock/order invariants and migration replay safety; and
8. update the PR verification section with actual evidence before deciding whether it is ready for review.

### Wave Picking smoke-pass emphasis

Deliberately verify:

- same-location selection lock;
- maximum 10-order selection;
- hardware/manual/camera scan entry;
- repeated SKU aggregation across multiple orders;
- visible per-order allocation preview;
- a complete successful wave;
- a partial pick;
- one-order failure after another order succeeds; and
- that successful orders are removed and never offered for silent retry.

## Production readiness after verification

Once the full gate is green:

- perform final responsive/accessibility checks using the adopted Agent-Template UI/UX skills;
- confirm retention/export/deletion and backup/recovery launch requirements;
- confirm the explicit compliance decision around Workers AI before enabling `AI_DOCUMENT_EXTRACTION_ENABLED`;
- bootstrap/configure Cloudflare resources and Google OAuth redirects/secrets as documented in `README.md`;
- run remote control-plane migrations; and
- deploy only from a reviewed, verified commit.

## Follow-up product roadmap

After the rebuild is stable, prefer focused follow-up PRs instead of continuing to grow PR #3 indefinitely. Candidate areas:

1. stronger onboarding and first-workspace guidance;
2. richer exception/inbox workflows for blocked orders, supplier delays, unmatched imports and stock anomalies;
3. stronger replenishment forecasting once sufficient real demand history exists;
4. richer warehouse efficiency only when justified by operator feedback (bin routing, packing stages, labels, etc.);
5. customer storefront and external sales-channel integrations;
6. carrier/shipping integrations;
7. payment processing if OrderMate's scope requires it; and
8. additional reviewed automation/natural-language operational analysis where the model remains read-only or proposal-based.

Do not add batches/lots/serial/manufacturing, autonomous AI mutations or destructive existing-catalogue bulk upserts without a fresh plan-gate because they materially change domain invariants.

## Verification status

The branch is intentionally **not merge-ready yet**. The previous session did not run or claim these as passing:

```sh
npm install
npm run typecheck
npm test
npm run build
```

The generated `package-lock.json` must be committed before production deployment. See `docs/next-agent-handoff.md` for the exact continuation sequence.
