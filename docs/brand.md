# Operating Layer brand system

Status: implemented brand foundation for Draft PR #3 · 26 September 2026

## Brand idea

**Operating Layer** is the system between order and outcome.

The name describes the layer where an inventory-led business actually operates: customer demand becomes warehouse work, warehouse work changes stock, stock changes purchasing decisions, and every decision leaves an auditable operational record.

The brand should never feel like generic “AI software”. It should feel precise, useful, calm under pressure and close to the physical operation.

## Positioning

### Primary category
Inventory, order, purchasing and warehouse operations software for growing product businesses.

### Primary audience
Growing SMEs and operational teams that have outgrown spreadsheet reconciliation, disconnected inventory/order tools and undocumented team knowledge, but do not want the implementation weight of a large ERP.

### Brand promise
**The system between order and outcome.**

### Homepage proposition
**Inventory, orders & purchasing. One operating layer.**

### Supporting narrative
One live system for inventory control, order fulfilment, purchasing and warehouse work. The value is not “more modules”; it is one connected operational truth and one controlled path through the work.

## Messaging pillars

1. **Live truth** — on-hand, reserved, available and incoming stock connect to the movements that created them.
2. **Controlled flow** — demand moves through picking, fulfilment, stock and replenishment without duplicate mutation paths.
3. **Explainable action** — important changes are attributable, reviewable and auditable.
4. **Human-reviewed automation** — software can extract, match, surface and propose; people keep authority over canonical business changes.

## Voice

Operating Layer sounds like an experienced operator, not an AI hype cycle.

Use:
- concrete operational nouns: stock, order, purchase order, receiving, fulfilment, supplier, location, movement;
- short confident sentences;
- outcome language before feature language;
- “review”, “surface”, “propose” and “explain” for assisted workflows;
- British English in the product and public site.

Avoid:
- “revolutionary”, “game-changing”, “magic”, “autonomous business”, “10x” and unsupported superlatives;
- vague “single pane of glass” copy;
- presenting AI as the product’s authority;
- invented customer metrics, logos, reviews or social proof.

## Visual language

The visual direction is **industrial editorial**: operational precision with the confidence of a strong editorial identity.

It intentionally avoids the default blue/purple SaaS gradient. Warm field colours keep dense interfaces approachable; near-black creates authority; signal orange marks decision/action; electric chartreuse represents live system state.

### Core colours

| Token | Hex | Role |
| --- | --- | --- |
| Ink | `#111714` | Primary text, navigation, dark surfaces |
| Ink soft | `#1C2520` | Secondary dark surface |
| Paper | `#FFF9ED` | Cards and light foreground surfaces |
| Field | `#F2EDDF` | Public-site canvas |
| Signal | `#F25F3A` | Brand signature, selected editorial emphasis, action signal |
| Signal deep | `#C94124` | Accessible signal text/accent |
| Live | `#D9FF72` | Live state, positive system signal, active data |
| Blue | `#8098FF` | Optional informational/data accent |
| Muted | `#69736D` | Secondary copy |

Signal and Live should be sparse. They are operational signals, not decoration.

### Typography

The shipped system avoids a remote-font dependency for speed, CSP simplicity and resilience.

- Display / UI: system grotesk stack (`Inter`, `ui-sans-serif`, system UI fallbacks).
- Editorial emphasis: Georgia / Times fallback, italic, used selectively inside major headlines.
- Operational labels: system monospace stack for kickers, states and machine-like microcopy.

Large display copy is tightly tracked and compact. Body copy is generous and readable. Monospace is never used for long passages.

## Mark

The Operating Layer glyph is an abstract operating stack rather than the initials `OL`.

- orange top plane = incoming demand / decision;
- paper middle layer = the operation itself;
- live lower signal = resulting state;
- live node = the observable point in the system.

The mark works without the wordmark at favicon/app-icon sizes and avoids tying the identity to a literal box, warehouse or AI sparkle.

Master assets:
- `/public/brand/mark.svg`
- `/public/brand/lockup.svg`
- `/public/brand/social-card.svg`
- `/public/favicon.svg`

Runtime React primitives live in `src/client/Brand.tsx`.

### Mark rules

- Never put letters inside the glyph.
- Never recolour the three signal planes arbitrarily.
- Keep clear space of at least 25% of the glyph width around the mark.
- On dark surfaces use the standard mark or the inverse runtime treatment.
- Do not add glow, glassmorphism or 3D extrusion to the logo itself.

## Product UI

The authenticated product is deliberately calmer than the acquisition surface.

- near-black navigation remains the anchor;
- live chartreuse is reserved for state/positive system information;
- signal orange identifies selected navigation and moments that need human attention;
- the acquisition-site grid, editorial serif and large brand gestures should not leak into dense workflow screens where they reduce scan speed.

## Imagery and product proof

Use the real product as the primary visual asset. Product screenshots should show meaningful operational states and realistic labels rather than empty mockups.

Preferred visual order:
1. real UI / faithful product illustration;
2. operational diagrams and branded data motifs;
3. documentary photography only when it adds human/physical context.

Avoid decorative stock photography, floating generic 3D blobs and fake analytics.

## Naming and clearance note

“Operating layer” is already used descriptively across software and operations products. This implementation therefore treats the visual identity, category statement and verbal system as important sources of distinctiveness.

The repository work is **not trademark or domain-name legal clearance**. Before a public commercial launch, complete professional trademark/domain/company-name clearance in the intended markets and decide the production domain before filing or announcing the brand broadly.

## Implementation boundary

Customer-facing identity is **Operating Layer**.

Existing `ordermate-*` Cloudflare resource names, the current staging hostname and `x-ordermate-*` internal request headers are compatibility identifiers for the already-provisioned PR #3 staging stack. They are not public brand copy and must not be renamed casually: changing them requires an explicit infrastructure migration/cutover plan.

The client migrates the old `ordermate:tenant` local-storage key to `operating-layer:tenant` without dropping a user’s selected workspace.
