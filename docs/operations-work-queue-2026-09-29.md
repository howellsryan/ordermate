# Operations Work Queue — delivery contract

Date: 29 September 2026

## Product intent

The Operations Work Queue turns deterministic operational signals into durable work. It is not another dashboard and it is not an autonomous agent.

A signal should move through this lifecycle:

`canonical condition → stable fingerprint → durable work item → owner/action → verified clear or deliberate close → recurrence reopens the same identity`

The queue must answer four questions a small-business operator otherwise tracks across memory, chat and spreadsheets:

1. What needs attention now?
2. Who is dealing with it?
3. What did we decide or do?
4. Has the underlying condition actually cleared?

## First production slice

Sources:

- overdue and urgent customer promises;
- forecast stock risk from Operating Intelligence;
- overdue and partially received purchase orders;
- open receiving discrepancies;
- open Shopify/integration exceptions.

Lifecycle:

- stable source fingerprint;
- `open`, `acknowledged`, `snoozed`, `resolved`, `dismissed` states;
- assign to self / unassign;
- acknowledgement;
- bounded snooze (maximum 30 days);
- resolve or dismiss with a required reason;
- automatic clear when the canonical condition disappears;
- recurrence reopens the same work-item identity and retains history;
- immutable work-item lifecycle events;
- global audit events for material lifecycle changes.

## Source-of-truth rules

- Browser input never creates operational signals.
- `POST /work-queue/refresh` is a server-side recomputation from canonical tenant state and integration exceptions.
- An unchanged refresh does not create history/audit noise.
- The full deterministic Flow Plan signal set is used for persistence. The dashboard may still show a capped top-eight view, but falling below that presentation cap must never be interpreted as condition resolution.
- A source-read failure other than a deliberately disabled module fails the refresh instead of clearing existing work.
- Manual resolve/dismiss does not pretend the canonical condition disappeared. The item remains historically closed while the active signal exists; after the signal truly clears and later recurs, the same fingerprint reopens.

## Permission boundary

The first persistent cross-domain queue is available to Owner, Admin and Manager only. These roles already have the relevant order, purchasing and integration visibility.

Inventory, Fulfilment and Viewer roles retain the existing role-filtered Automatic Flow Plan. Do not broaden the persistent queue to those roles until item/category-level visibility is implemented and tested; a unified queue must not become a data side-channel for supplier or integration information.

## Definition of done

Source acceptance requires automated proof that:

1. repeated refresh of the same signal keeps one durable item ID;
2. assignment and acknowledgement persist;
3. clearing the underlying condition removes the item from actionable work and auto-resolves it;
4. recurrence reopens the same item ID and retains lifecycle history;
5. integration exceptions enter the same queue and clear when the integration exception resolves;
6. the full Flow Plan signal set can exceed eight while the dashboard remains capped at eight;
7. schema migration is replay-safe and fails closed on a newer unknown version;
8. refresh is classified as a derived read while lifecycle actions require work-queue update permission;
9. non-management roles cannot read or mutate the cross-domain persistent queue;
10. existing guest-demo, production build and staging build gates remain green.

## Follow-on slices

After this foundation is proven, expand in this order:

1. category-scoped visibility/assignment for frontline Inventory and Fulfilment roles;
2. arbitrary team-member assignment using validated workspace membership;
3. explicit due dates/escalation policies and aging views;
4. service visit/invoice exceptions and automation retry exhaustion as additional signal sources;
5. deep links that select the exact order, PO, SKU or exception rather than page-level navigation only;
6. queue performance metrics: detection-to-acknowledgement, detection-to-resolution, reopen rate and recurring exception families;
7. safe recommended-action descriptors where an existing canonical command can be proposed for human confirmation.

Do not add autonomous purchasing or generic free-form mutation as part of this queue.