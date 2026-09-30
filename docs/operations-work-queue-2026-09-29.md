# Operations Work Queue — delivery contract

Date: 29 September 2026 · updated 30 September 2026

## Product intent

The Operations Work Queue turns deterministic operational signals into durable work. It is not another dashboard and it is not an autonomous agent.

A signal moves through this lifecycle:

`canonical condition → stable fingerprint → durable work item → owner/team/action → verified clear or deliberate close → recurrence reopens the same identity`

The queue must answer four questions a small-business operator otherwise tracks across memory, chat and spreadsheets:

1. What needs attention now?
2. Who or which team is dealing with it?
3. What did we decide or do, and by when?
4. Has the underlying condition actually cleared?

## Production slice delivered on PR #11

Sources:

- overdue and urgent customer promises;
- forecast stock risk from Operating Intelligence;
- overdue and partially received purchase orders;
- open receiving discrepancies;
- open integration exceptions, including Shopify and Xero reconciliation failures.

Lifecycle and coordination:

- stable source fingerprint;
- `open`, `acknowledged`, `snoozed`, `resolved`, `dismissed` states;
- assign to self / unassign;
- team ownership;
- acknowledgement;
- bounded snooze (maximum 30 days);
- explicit due date and escalation timestamp;
- automatic escalation marking and audit history;
- resolve or dismiss with a required reason;
- automatic clear when the canonical condition disappears;
- recurrence reopens the same work-item identity and retains history;
- immutable work-item lifecycle events;
- global audit events for material lifecycle changes.

Frontline experience:

- Owner/Admin/Manager: cross-domain queue;
- Inventory: `stock_risk`, `supply_risk`, `receiving_exception` only;
- Fulfilment: `customer_promise`, `receiving_exception` only;
- Viewer: no persistent Work Queue access;
- server-side category scoping is authoritative; hiding a category in the browser is never the security boundary;
- filters for category and “Mine”;
- exact-record URLs preserve page, entity type and record identity across reload/back/forward navigation;
- order, purchase-order, receiving-discrepancy and integration-exception links resolve directly to their record view;
- 30-day detection-to-resolution metrics include resolution rate, median and p90 time to close.

## Source-of-truth rules

- Browser input never creates operational signals.
- `POST /work-queue/refresh` is a server-side recomputation from canonical tenant state and integration exceptions.
- An unchanged refresh does not create history/audit noise.
- The full deterministic Flow Plan signal set is used for persistence. The dashboard may still show a capped top-eight ephemeral view, but falling below that presentation cap must never be interpreted as condition resolution.
- A source-read failure other than a deliberately disabled module fails the refresh instead of clearing existing work.
- Manual resolve/dismiss does not pretend the canonical condition disappeared. The item remains historically closed while the active signal exists; after the signal truly clears and later recurs, the same fingerprint reopens.
- Due dates, escalation and assignment coordinate work only; they never mutate the underlying order, stock, purchase order or integration record.

## Permission boundary

The persistent queue is intentionally role-scoped rather than management-only.

Owner, Admin and Manager can coordinate across every category. Inventory and Fulfilment can read/update only the categories explicitly allowed for their operational role. Viewer has no Work Queue grant. The server applies the same category scope to list, metrics and mutation access so the queue cannot become a side-channel for supplier or integration information.

Team labels are operational routing metadata, not a second RBAC system. Assigning an item to a team never grants a user access they do not already have through their workspace role.

## Definition of done

Source acceptance requires automated proof that:

1. repeated refresh of the same signal keeps one durable item ID;
2. assignment and acknowledgement persist;
3. clearing the underlying condition removes the item from actionable work and auto-resolves it;
4. recurrence reopens the same item ID and retains lifecycle history;
5. integration exceptions enter the same queue and clear when the integration condition resolves;
6. the full Flow Plan signal set can exceed eight while the presentation view remains capped;
7. schema migration is replay-safe and fails closed on a newer unknown version;
8. refresh is classified as a derived read while lifecycle/coordination actions require Work Queue update permission;
9. frontline roles are category-scoped on the server and Viewer remains excluded;
10. due dates/escalations are durable and auditable;
11. exact-record links survive a full SPA reload;
12. detection-to-resolution metrics never report a resolution rate above 100%;
13. existing guest-demo, production build and staging build gates remain green.

## Follow-on slices

The next useful depth is deliberately narrower than the work already delivered:

1. validated workspace-member assignment rather than only self-assignment plus team routing;
2. centrally managed team definitions/membership if SMEs need them, without turning teams into another authorisation system;
3. service visit/invoice exceptions and exhausted integration retry signals as additional sources where they create real operator value;
4. exact inventory-position drill-down for stock-risk items once Inventory has a stable record-detail surface;
5. detection-to-acknowledgement, reopen rate and recurring exception-family analytics;
6. safe recommended-action descriptors where an existing canonical command can be proposed for human confirmation.

Do not add autonomous purchasing or generic free-form mutation as part of this queue.
