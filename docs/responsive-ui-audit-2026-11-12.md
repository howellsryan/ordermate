# Operating Layer — responsive UI/UX audit
Date: 12 November 2026  
Scope: public acquisition surface, workspace shell, shared patterns and operational pages  
Base: `main` at `961c1cb87d864627f3959cee57063420bdb42dad`

## Source-level findings addressed in this branch

| Surface | Finding | Change |
| --- | --- | --- |
| Workspace navigation | The sticky 100vh sidebar can contain more links than fit on short-height screens; actions at the bottom become hard to reach. | Dedicated scroll area for navigation, fixed-height brand and account sections, dynamic viewport height and safe-area padding. |
| Mobile navigation | The offscreen drawer had no close button, no focus containment, no Escape handling and no background scroll lock. | Explicit close affordance, aria-expanded/current, Escape and Tab handling, focus return, body lock and hidden closed state. |
| Business switcher | A visible `<button>` contained an overlapping interactive `<select>`, which is invalid nesting. | Changed the visual wrapper to `<div>` with a focus-within ring; kept the labelled select. |
| Landing navigation | Under tablet width all section links disappeared without a replacement. | Compact responsive disclosure with accessible expanded state and working section links. |
| Narrow landing header | Logo and long CTA compete for width, particularly around 320–420px. | Brand sizing and short mobile CTA labels, preserved full desktop wording. |
| Landing hero | The decorative dashboard was wider than the phone viewport and angled off-canvas, while two callouts crowded each other. | Straightened, contained illustration and simplified very narrow views; improved type scale and spacing. |
| Landing hierarchy | Tiny text in editorial tiles made problem/outcome messaging harder to scan. | More readable feature/positioning text, fluid headings and consistent block spacing. |
| Modal form focus | Re-created `onClose` handlers could restart focus management every parent re-render, interrupting typing. | Stable escape handler via ref; the trap runs only on mount; autofocus fields are preferred. |
| Mobile forms | 11–12px input text can trigger iOS zoom and targets are awkward to tap. | 16px handheld inputs, larger form controls/buttons and safe-area aware bottom sheets. |
| Tables / dense layouts | Long data rows need bounded horizontal scrolling instead of stretching the viewport. | Container overflow, touch scrolling, readable labels and action sizing; compact responsive grids. |
| Analytics / inventory / receiving | Seven-column data facts, planning forms, scanner panels and record details become cramped on narrower canvases. | Responsive fact grids and editor stacking, with clearer status labels and wrapping. |
| Mobile search | The sticky topbar's backdrop filter could turn the fixed search popup into a relative containing block, shifting it down. | Mobile topbar uses an opaque surface and the search dropdown is anchored to the viewport. |
| Reduced motion | Navigation transitions and decorative animation should respect reduced-motion settings. | Reduced-motion treatment for both workspace and landing navigation. |

## Design consistency

Keep `docs/brand.md` authoritative: near-black navigation, warm field/paper colours, restrained signal orange and live chartreuse, editorial public site and quieter operations UI. No third-party CSS framework or external asset service added. No API, data model or Cloudflare infrastructure change.

## Screen and workflow QA matrix (still required before a visual sign-off)

**Viewports:** 320×568, 375×667, 390×844, 430×932, 768×1024, 1024×768, 1440×900, 1920×1080. Check iOS Safari, Android Chrome and desktop Chrome/Firefox/Safari where possible. Check 200% text zoom and keyboard-only usage.

- **Public:** header and mobile section menu; CTA sign-in and demo; editorial hero/dashboard motif; problem cards; system band; real product proof images; automation illustration; adoption tiles; trust cards; FAQ; footer; floating guest-demo launcher.
- **Entry:** Google sign-in, invitation gate, create-business form, tenant switcher, desktop and drawer navigation.
- **Core:** overview, workstream, CRM, service, orders, warehouse picking and receiving, wave picking, cycle counts, products, inventory, purchasing and suppliers.
- **Oversight:** reports, activity/export, team/invites, feature flags, settings.
- **Shared dialogues:** product/order editors, create forms, CSV import review, scanner input and mobile camera, record details, errors/loading/empty states.
- **Interactions:** drawer Escape/Tab/focus return; modal Escape/Tab/typing focus; dismissing global search; horizontal table scrolling without horizontal page overflow; switches between tenants and pages; landscape, touch targets and reduced motion.

## Verification and remaining risk

This is a **source-level audit and implementation**. There is no attached browser screenshot evidence, no claim of a full device-specific visual pass, and no claim that every screen is pixel-perfect. The connected GitHub API does not provide an interactive browser/build environment here; the normal verification gate must still be executed on the PR head:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Then run the full manual visual matrix above using the staging demo and authenticated workflows. Do **not** merge or deploy based on the source review alone if that full level of assurance is required. Known exceptions should be reported as follow-up issues with exact route, device, screenshot and reproduction steps.
