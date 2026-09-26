# Operating Layer competitive gap analysis

Prepared 26 September 2026.

This document records the product discovery behind the Operating Intelligence release. It is deliberately capability-led rather than a claim that every competitor implements each workflow in the same way. Competitor observations below were checked against their public product/help material during this delivery cycle.

## Competitive reference set

The closest useful reference set is Cin7, Katana, Brightpearl, Unleashed, Zoho Inventory and Extensiv. They overlap Operating Layer across inventory, orders, purchasing, fulfilment and operational automation, but each emphasises a different part of the workflow.

Public product direction across that set shows four important expectations for a modern inventory operations platform:

1. **Forward-looking inventory planning** rather than only threshold-based low-stock alerts. Current products increasingly combine demand history, incoming supply, lead time, safety stock and future inventory position.
2. **Scenario-based buying decisions** rather than one opaque reorder number. Minimum/recommended/maximum quantities, stockout timing and order-by timing are increasingly visible to planners.
3. **Business context around the forecast.** Promotions, supplier delays and other known events can invalidate a purely historical projection, so leading planning experiences let an operator apply context before acting.
4. **Natural-language operational access and configurable automation.** Mature platforms are moving toward assistants over live business data and toward rules that reduce repetitive operational triage.

## Operating Layer gap before this release

Operating Layer already had a strong deterministic operating core: multi-location stock, reservations, immutable movements, purchase orders, expected deliveries, partial receiving, supplier mappings, replenishment policies, warehouse execution, wave picking, reports, attention items and reviewed document extraction.

The existing replenishment implementation nevertheless had a meaningful planning gap:

- it used only the most recent 30 days of fulfilled demand;
- it projected only to supplier lead time;
- it returned one recommended quantity;
- it did not expose a stockout date or order-by date;
- it had no safety-stock calculation tied to demand and lead time;
- it had no ABC segmentation;
- it had no temporary business-context scenario controls; and
- there was no conversational, permission-aware way to ask operational questions across orders, stock risk and incoming supply.

That made the product operationally safe but more reactive than the strongest products in the category.

## Delivered: Operating Intelligence

This release closes that gap without changing Operating Layer's trust model.

### Explainable forward planning

For every active tracked SKU/location position, Operating Layer now builds a 90-day demand signal:

- last 30 days are weighted at 70%;
- the prior 60-day run rate is weighted at 30%;
- recent-vs-prior trend applies a bounded adjustment rather than an unlimited extrapolation;
- available and incoming inventory are included;
- supplier/preferred-supplier lead time is included;
- safety stock scales with forecast demand and effective lead time; and
- the existing reorder point and target-stock policy remains authoritative where configured.

The result exposes:

- forecast daily demand;
- recent demand trend;
- days of cover;
- projected stockout date;
- order-by date;
- projected stock when replenishment should arrive;
- safety stock and buffer days; and
- a 12-week inventory projection.

The 12-week horizon is intentional. Operating Layer currently has a 90-day historical demand foundation and does not yet model seasonality. Showing a 12-month forecast before the product has enough history and seasonal features would create false precision.

### Minimum / recommended / maximum buying scenarios

Each at-risk position now has three explainable draft-PO scenarios:

- **Minimum** — restore the safety-stock buffer.
- **Recommended** — target roughly 28 days of post-arrival cover, while respecting any higher configured target stock.
- **Maximum** — target roughly 42 days of post-arrival cover.

Choosing a scenario only pre-fills the existing reviewed purchase-order flow. It does not submit a PO and it never mutates stock.

### Human context simulation

A planner can temporarily simulate:

- demand changes from -50% to +100%; and
- supplier delays from 0 to +30 days.

The plan recalculates in the browser. The scenario is intentionally non-persistent: it does not rewrite supplier lead time, inventory policies or demand history. This makes it safe for questions such as “what if the promotion lifts demand 40%?” or “what if this supplier slips two weeks?” without turning a planning thought experiment into business truth.

### ABC value/velocity segmentation

Tracked positions are classified A/B/C using 90-day fulfilled units multiplied by recorded unit cost, with cumulative 80% / 95% bands. The class is a planning aid, not a permission or mutation rule.

### Read-only operations copilot

Overview now includes a permission-aware operations copilot that can answer questions about:

- forecast stock risk;
- prioritised confirmed orders; and
- open/incoming purchase orders.

The copilot has two execution layers:

1. a deterministic fallback that works without an LLM; and
2. an optional Workers AI language layer that can improve wording/reasoning when explicitly enabled.

Both receive only role-permitted data. The AI path has no write tool and no mutation endpoint. It returns an answer, concrete evidence and links into the existing workflow. If the model is disabled or fails, the deterministic path remains available.

`AI_OPERATIONS_ASSISTANT_ENABLED` is `false` by default in production, staging and test configuration. This mirrors the existing explicit compliance gate used for document extraction rather than silently expanding AI processing scope.

### Guest-demo parity

The guest demo uses the same shared forecasting/scenario engine as live tenants. Its copilot uses the same deterministic answer contract and operates entirely from browser-local demo records. Demo operations do not call the live application API or Workers AI.

## Trust boundary retained

Operating Intelligence deliberately stops at **forecast -> explain -> propose**.

It does not:

- autonomously submit purchase orders;
- adjust on-hand stock;
- fulfil or cancel customer orders;
- overwrite supplier lead times;
- alter replenishment policies from a simulation; or
- let model output become canonical business state.

The existing deterministic, permission-checked, audited mutation paths remain authoritative.

## Remaining competitive gaps worth separate delivery slices

The next strongest gaps are real, but should not be hidden inside this release because they change data or integration boundaries:

1. **Configurable exception automations** — safe rules such as “when an A-class SKU reaches critical risk, create an assigned review task” or “when a PO is overdue by two days, surface/escalate it”. These should automate triage first; autonomous stock/order mutations remain out of scope.
2. **Supplier commercial constraints** — MOQ, order multiples, pack sizes and supplier minimum values so suggested quantities become order-ready rather than mathematically ideal only.
3. **Forecast maturity** — seasonality, longer history and backtesting before extending the horizon materially beyond 12 weeks.
4. **Warehouse depth** — bin/location routing, packing stages and carrier/label workflows when operator feedback justifies them.
5. **External demand capture** — storefront, marketplace and sales-channel integrations so more demand enters the same canonical order engine.
6. **Supplier/customer collaboration** — controlled external sharing of POs, delivery expectations and order status without exposing the internal workspace.

These should remain focused follow-up PRs. They have materially different schema, integration or trust implications and should receive their own plan-gates and regression coverage.
