# Operating Layer product roadmap — 27 September 2026

This roadmap is based on the current product at `main` commit `a3e25e588ac8803f5653135a2c341a198d83bcfd`, the implementation delivered through PRs #4–#8, current repository structure, the existing SME buying-friction research and a fresh review of Cin7, Linnworks, Katana, Zoho Inventory and Shopify's platform direction.

## Product thesis

Operating Layer should not become a smaller ERP with a long menu of disconnected features.

Its strongest position is the operational layer between **an external signal and a completed business outcome**:

> connect what happened → understand the operational consequence → prioritise the exception → recommend a safe action → let a human approve or act → verify the outcome → learn from what happened.

That loop is where a small team gets leverage. Integrations make the loop possible; operating intelligence makes it valuable; a persistent work queue makes it executable.

## What is already strong

Do not rebuild or dilute these advantages:

- physically isolated tenant operational data with explicit server-side membership checks;
- deterministic order, reservation, stock-movement, purchasing and fulfilment rules;
- audited human-review boundaries around consequential mutations;
- useful replenishment intelligence with stockout/order-by timing, supplier terms, scenarios and Smart Buy batches;
- cross-module Automatic Flow Plan;
- reviewed document extraction/matching rather than autonomous source-of-truth changes;
- modular CRM/service workflows without forcing every SME into one operating model;
- six local guest demos and a strong test culture;
- workspace feature controls that allow a business to start narrow.

## Prioritised roadmap

### P0.1 — Integration platform + Shopify live connector

**Why now:** this is the clearest commercial blocker. Product SMEs already operating on Shopify will not adopt a second system that requires demand to be recreated manually. Current category leaders treat live channel connectivity as baseline.

**Value:** orders arrive automatically; inventory intelligence sees real demand; fulfilment and available stock can flow back to the storefront; the rest of Operating Layer becomes useful without double entry.

**Deliver:** provider-neutral connection/event/link/exception model; secure credential handling; webhook routing; Shopify GraphQL integration; catalogue/location mapping; orders in; inventory and fulfilment out; reconciliation and connection health.

**Success evidence:** a design-partner store can operate a full Shopify order lifecycle without re-keying an order or stock quantity and without duplicate canonical mutations after webhook replay.

**Started:** `docs/integration-platform-2026-09-27.md`, `src/shared/integration-contract.ts` and contract tests on `feature/integration-platform-foundation`.

### P0.2 — Persistent Operations Work Queue

**Why now:** the current Flow Plan is useful intelligence but is ephemeral. A real operating layer must make exceptions accountable over time.

**Value:** the owner opens one screen and knows what needs attention, why, by when, who owns it and what safe next action is available. This is the product's strongest differentiation from an inventory system with dashboards.

**Deliver:** persistent operational tasks generated/upserted from deterministic signals; stable fingerprints; severity and due time; assignment; acknowledge; snooze; resolve/dismiss with reason; source evidence; suggested action descriptor; deep links; audit; automatic closure when the underlying condition is actually resolved.

Initial sources:

- customer promise at risk;
- forecast stockout/order-by breach;
- overdue/late supplier order;
- receiving discrepancy;
- integration mapping/sync failure;
- failed automation/retry exhaustion;
- service visit/invoice exceptions where enabled.

**Safety:** tasks may propose or deep-link to existing mutations but do not silently execute stock/order/purchasing changes.

**Success evidence:** an unresolved exception survives sessions, can be assigned/snoozed and disappears only because an operator resolves it or the canonical condition clears.

### P0.3 — Xero accounting connector, then QuickBooks Online

**Why now:** accounting compatibility is another adoption veto for UK SMEs. Competitors explicitly connect operations to accounting rather than asking customers to reconcile two worlds manually.

**Value:** removes duplicate entry and month-end friction without turning Operating Layer into accounting software.

**Deliver:** reuse the integration spine; Xero connection/auth; contact mapping; sales invoice/export strategy; purchase/bill strategy; tax-account mapping; payment/reconciliation input where appropriate; sync health and exceptions. Follow with QuickBooks Online using the same contracts.

**Boundary:** Xero/QuickBooks remain financial systems of record. Operating Layer owns operational state and publishes/reconciles accounting facts.

### P0.4 — Guided first-value onboarding + migration health

**Why now:** the existing catalogue import is strong, but a new workspace still has to know what to configure next.

**Value:** shorter time to first real workflow and lower implementation anxiety.

**Deliver:** module-aware owner checklist derived from real state rather than arbitrary completion toggles: business defaults, locations, catalogue/import, supplier mappings, integrations, team, opening stock and first completed operational flow. Show blockers, not tutorial theatre.

Add migration health for duplicate SKUs/barcodes, missing costs, unmapped suppliers, missing location mappings and incomplete opening-stock coverage.

### P0.5 — Complete data portability and exit package

**Why now:** trust improves when a business knows it can leave. Existing CSV exports are useful but not a complete workspace exit story.

**Value:** reduces perceived switching risk and supports backup, audit and migration.

**Deliver:** owner-only export manifest plus machine-readable exports for canonical master/transaction data, audit metadata and document index. Avoid exporting credentials or ephemeral secrets. Document what is and is not included and how references join.

### P1.1 — Public API, webhooks and connector SDK

**Why:** after Shopify/Xero prove the internal integration model, make the platform extensible without asking the core team to build every connector.

**Deliver:** scoped API credentials/service accounts, signed outbound webhooks, idempotency keys, rate limits, versioned contracts, integration test harness and a small connector SDK built around the same event/entity-link model.

**Do not** ship a broad unstable API before the internal connector contracts have survived real production traffic.

### P1.2 — Warehouse execution: bins → pick → pack → ship

**Why:** wave picking is already a good foundation, but competitors cover the physical execution after pick as well.

**Deliver:** bin/zone locations, putaway, pick-path hints, packing station, parcel/package state, shipping label provider boundary, tracking capture and dispatch. Keep carrier integrations behind an adapter rather than embedding one provider into order logic.

**Success evidence:** a warehouse order can move from reserved to picked to packed to shipped with traceable stock and operator history.

### P1.3 — Forecast maturity and measurable recommendation quality

**Why:** Operating Intelligence is already useful; the next improvement should increase decision quality, not add an opaque AI label.

**Deliver:** longer demand history, explicit seasonality, stockout/lost-sales correction, promotions/events as reviewed context, supplier reliability distribution rather than only a point lead time, backtesting and forecast error metrics by SKU/category.

Add an evidence panel that tells an operator how much history supported a recommendation and how the model has performed previously.

**Do not:** replace deterministic/reviewable logic with a black-box model solely to match competitor marketing.

### P1.4 — Supplier and customer collaboration surfaces

**Why:** many operational delays happen outside the SME's walls.

**Supplier side:** PO acknowledgement, confirmed ETA, partial-ship notice and discrepancy response through narrow secure links/portal.

**Customer side:** order/appointment status, confirmation and approved self-service actions where the enabled workflow makes sense.

**Value:** removes email chasing while preserving a canonical audit trail.

### P1.5 — Returns/RMA and quality intelligence

**Why:** returns are already operationally supported, but reasons and downstream learning are thin.

**Deliver:** RMA/reason taxonomy, disposition (restock/quarantine/write-off), supplier/product defect signals, repeat-return analytics and integration-safe ecommerce return handling.

### P1.6 — Operational outcome measurement

**Why:** the product should prove that its recommendations save time/cash/service failures.

**Deliver:** measure task detection→resolution time, prevented/experienced stockouts, late supplier occurrences, receiving discrepancy resolution, forecast error, order promise misses, inventory adjustments and manual touches avoided where attribution is defensible.

Use this for product learning first and customer proof second. Never invent savings figures.

### P2.1 — Vertical production packs

Only promote a vertical from demo to production when the underlying workflow is genuinely supported.

Candidate packs:

- ecommerce/retail: Shopify + fulfilment + returns;
- wholesale/distribution: customer ordering, purchasing, warehouse and accounting;
- field service/trades: request/quote/job/visit/invoice plus material stock;
- food/assembly businesses only after recipe/BOM/lot/expiry needs are deliberately supported.

Do not make vertical-specific shortcuts inside shared order/inventory invariants.

### P2.2 — Advanced inventory/manufacturing primitives when customer evidence demands them

Possible future capabilities: lot/batch/expiry, serials, kits/bundles, assemblies/BOM, FEFO, multi-stage manufacturing and demand planning by component.

These are valuable in specific segments but should not outrank live integrations, work execution and adoption friction for the current broad SME thesis.

## Codebase roadmap

### Freeze the legacy `TenantStore` inheritance chain

The repository has accumulated a sequence of runtime subclasses that intercept routes before delegating to `super.fetch`. Newer work already uses composed handlers such as `ServiceRuntime`, `FeatureRuntime` and `BusinessProfileRuntime`.

New domains must use composition. Gradually extract existing route groups when touched; do not schedule a risky rewrite solely for architectural neatness.

### Stop demo-domain duplication from growing

The guest demo is commercially useful, but its large parallel stores/runtimes will become a correctness tax if every production feature is reimplemented separately.

Move pure planning, validation, normalization and state-transition decisions into shared domain functions. Production adapters persist them in Durable Objects; demo adapters persist equivalent outcomes locally. Maintain explicit parity tests for safety-critical behavior.

### Keep migrations small and monotonic

Continue the current replay-safe schema strategy. Integration routing belongs in D1 only where cross-tenant routing is required; operational integration state belongs in the tenant Durable Object.

### Make queues/workflows first-class for integration workloads

External sync, retries, reconciliation and high-frequency stock publication are durable asynchronous workloads. Keep user-facing commands fast and queue provider work with bounded retries, DLQ visibility and idempotent consumers.

### Refresh stale status documentation

`docs/implementation-status.md` still describes the PR #3/v6-era state while current runtime work has advanced through PR #8 and tenant schema v9. Treat status docs as generated/reviewed release evidence or update them with each material roadmap delivery so future agents do not plan against stale truth.

## What not to prioritise next

- a generic chatbot that can mutate the business;
- more dashboard cards without a workflow attached;
- autonomous purchasing without approval/guardrails;
- a broad accounting ledger;
- manufacturing depth before customer evidence;
- dozens of shallow integrations before the Shopify/Xero spine is correct;
- cosmetic AI branding over deterministic operational intelligence;
- a wholesale rewrite of the Durable Object merely to improve code aesthetics.

## Competitive references reviewed

- Cin7 inventory/integrations: https://www.cin7.com/features/inventory/inventory-management/
- Cin7 Shopify: https://www.cin7.com/integrations/shopify/
- Linnworks channel integrations: https://www.linnworks.com/features/channel-integrations/
- Katana Shopify: https://support.katanamrp.com/en/articles/5968286-shopify-integration-overview
- Katana AI Replenishment: https://support.katanamrp.com/en/articles/15552396-how-katana-ai-replenishment-works
- Zoho Inventory integrations: https://www.zoho.com/us/inventory/addons/
- Shopify API direction: https://shopify.dev/docs/apps/build/apis

## Next implementation sequence

1. finish Integration Slice A verification and merge;
2. deliver Slice B connection/routing/security foundation;
3. deliver Slice C catalogue/location mapping;
4. in parallel after the integration data model stabilises, introduce the persistent Operations Work Queue schema/domain service;
5. deliver Shopify orders-in and then inventory/fulfilment-out;
6. start Xero only after the provider-neutral spine has survived the first real Shopify design partner;
7. build onboarding around the now-real connection/import path rather than a fictional setup wizard.
