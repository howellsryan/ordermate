# SME order & inventory workflow research — 26 September 2026

This note records the product discovery behind the Flow Plan and supplier-ordering work. It intentionally separates observed competitor capabilities from Operating Layer product decisions. Vendor performance claims are treated as directional marketing evidence, not independent benchmarks.

## Product question

How can Operating Layer remove the administrative delay between **seeing operational data** and **deciding what the team should do next**, without creating a complex ERP or silently mutating business-critical records?

The target customer is a growing product SME where a small team is still reconciling orders, stock, purchase orders, supplier dates and warehouse work manually.

## Competitive evidence

| Product | Observed capability | Implication for Operating Layer |
| --- | --- | --- |
| Cin7 Core | Automated reorder points, demand planning, workflow automation, order capture/routing and broad channel integrations. | Reorder alerts alone are table stakes. The product must connect the signal to an operational decision. |
| Brightpearl | Configurable commerce automation templates can allocate inventory, route orders, send POs/vendor notifications and flag backorders/delays. | Exception automation is a mature competitive pattern. Operating Layer should make the common SME playbooks useful without requiring a generic rules-engine project. |
| Linnworks | Rules Engine automates routing/tagging/staging; Spotlight AI identifies repeated manual decisions and recommends automations. Linnworks publishes a 52-hours/month average time-saved claim; this is vendor-reported, not independently verified here. | Repetitive decision detection is a strong future direction, but the first product step should automate obvious cross-module triage using data Operating Layer already owns. |
| Unleashed | Replenishment uses stock, demand, incoming supply and supplier information; purchasing can automatically create POs from stock/reorder/forecast signals. | Forecasting must lead toward order-ready purchasing rather than end at a recommendation card. |
| Zoho Inventory | General workflow rules can send email, update fields, call webhooks and custom functions when criteria match. | A generic rules builder is flexible but adds setup burden. Operating Layer can differentiate with prebuilt operations-specific playbooks first. |
| MRPeasy | Procurement reports can create a PO from critical stock, automatically include other low-stock items from the same vendor, and prefill price, MOQ and expected delivery when purchase terms exist. | MOQ/order multiple and supplier consolidation are practical buying constraints that turn a theoretical reorder quantity into executable work. |

### Sources

- Cin7 order management: https://www.cin7.com/features/sales/order-management/
- Cin7 automations: https://www.cin7.com/features/ai/automations/
- Brightpearl Automation Engine: https://www.brightpearl.com/automation
- Brightpearl purchase orders: https://www.brightpearl.com/purchase-order-software
- Linnworks AI & automation: https://www.linnworks.com/features/ai-automation/
- Linnworks order management: https://www.linnworks.com/solutions/order-management/
- Unleashed replenishment: https://www.unleashedsoftware.com/inventory-replenishment-software/
- Unleashed purchase orders: https://www.unleashedsoftware.com/product/purchase-order-software/
- Zoho Inventory automation: https://www.zoho.com/us/inventory/help/settings/automation.html
- MRPeasy critical on-hand: https://www.mrpeasy.com/resources/user-manual/procurement/critical-on-hand/

## Product decision: automate the handoff, not authority

Operating Layer already has canonical inventory movements, reservations, expected purchase dates, delivery discrepancies, customer required-by dates and forward replenishment intelligence. The largest near-term opportunity is therefore not another report. It is the handoff between those facts and a human action.

The product model is:

> **Detect → prioritise → explain → prepare → human commits**

This preserves the existing trust boundary: automatic systems can identify and prepare work, while stock, fulfilment and purchasing mutations continue through explicit permission-checked and audited workflows.

## Delivered in this slice

### 1. Automatic Flow Plan

The Overview now derives a short decision queue from live operational truth. It continuously checks four cross-module conditions:

1. **Customer promise dates** — overdue and urgent confirmed orders.
2. **Forecast stock risk** — critical/warning replenishment positions including ABC importance, days of cover, stockout/order-by timing and recommended quantity.
3. **Incoming supplier dates** — overdue POs and partial receipts.
4. **Receiving exceptions** — unresolved delivery discrepancies.

The result is capped at eight actions and ranked by explicit deterministic priority. This is intentionally not another infinite inbox. It answers: **what should this small team move next?**

### 2. Supplier-orderable replenishment

Supplier-item mappings now support:

- minimum order quantity (MOQ),
- order multiple / pack size.

Positive replenishment scenarios are rounded up to satisfy those terms. A zero recommendation remains zero, so entering an MOQ can never create demand on its own. The explanation trail states when supplier terms changed a scenario.

This removes a common manual spreadsheet step between “the forecast says buy 23” and “the supplier only sells cases of 12 with an MOQ of 24”.

### 3. Landing-page positioning

The public story now leads with operational outcomes rather than module inventory:

- fewer things to chase manually,
- automatic exception triage,
- forward stock planning,
- customer-promise prioritisation,
- reviewed rather than silent automation.

No fabricated ROI number is used. The page demonstrates workflows the product can actually execute or calculate today.

## Next workflow roadmap

### P0 — Smart Buy Batches

Group at-risk recommendations by preferred supplier and destination location. One review action should prepare a draft PO containing every due line for that supplier, already rounded for MOQ/order multiple and using last known cost. The user reviews/edits before the draft becomes an ordered PO.

**Delay removed:** buyer copies multiple SKU recommendations into a PO one-by-one.

### P0 — Supplier Chase Loop

When an ordered PO passes its expected date, automatically create a review item with supplier contact context and the affected at-risk SKUs/customer orders. Add a one-click draft follow-up message later when outbound email is deliberately integrated.

**Delay removed:** late inbound stock is only discovered when someone checks the PO list or asks the supplier manually.

### P0 — Promise Guardian

Before a customer required-by date is at risk, combine reservations, current location stock, transfer options and dated incoming supply. Recommend the lowest-friction recovery path:

1. fulfil now,
2. transfer from another location,
3. expedite linked incoming supply,
4. prepare replenishment,
5. escalate for customer communication.

**Delay removed:** operations staff manually reconcile stock and supply before deciding whether an order can still ship on time.

### P1 — Persistent ownership & escalation

Turn Flow Plan items into durable work only when ownership adds value. Support assignee, due date, snooze, status and deterministic auto-resolution when the underlying condition clears. Prebuilt escalation policies should come before a generic rules builder.

**Delay removed:** exceptions are noticed but become nobody's explicit responsibility.

### P1 — Repetitive-work mining

Use audit history to count repeated safe manual actions and suggest a playbook only when the data shows meaningful repetition. Keep recommendations explainable: action frequency, affected workflow, candidate automation and risk boundary.

**Delay removed:** SMEs do not know which small manual decisions are consuming the most aggregate time.

### P1 — Supplier/customer collaboration

Controlled external links for PO acknowledgement, expected-date confirmation and customer order status can remove email/status chasing without granting access to the full workspace.

### P2 — External demand capture

Channel/accounting integrations become increasingly important after the internal operating loop is strong. Prioritise integrations based on validated customer demand rather than breadth for its own sake.

## Measurement plan

Instrument workflow outcomes before claiming time savings. Useful product metrics:

- median age of unresolved critical Flow Plan actions,
- percentage of overdue customer promises,
- percentage of ordered POs that become overdue,
- time from receiving discrepancy creation to resolution,
- percentage of replenishment suggestions converted into draft/ordered POs,
- number of manual line edits between recommended quantity and ordered quantity,
- percentage of supplier mappings with lead time + MOQ/multiple completeness,
- repeated audited action count by workflow (input to future automation recommendations).

Avoid claiming “stockouts prevented” or “hours saved” until there is a defensible counterfactual or direct customer measurement.

## Product principles retained

1. **SME-first defaults:** common playbooks before a generic automation canvas.
2. **Exception-first UI:** normal work should flow quietly; risk should become obvious.
3. **Prepared actions:** calculate and prefill as much as possible before asking for human input.
4. **Canonical truth:** inventory changes only through stock movements/reservations and existing lifecycle transitions.
5. **Explainability:** a user can see why something is prioritised or rounded.
6. **Auditability:** mutations and commercial-term changes record the actor.
7. **No AI dependency for core operations:** deterministic workflows remain useful if optional AI is disabled.
