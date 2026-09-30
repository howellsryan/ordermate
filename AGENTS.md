# Operating Layer agent instructions

## Product and scope
Operating Layer is a multi-tenant SaaS for inventory, orders, purchasing, warehouse operations and optional CRM/service workflows. Runtime and persisted product/customer data remain Cloudflare-native unless the owner explicitly changes that constraint.

Use **Operating Layer** in customer-facing copy and British English in the product. Existing `ordermate-*` resources, staging hostname, package/repository names and `x-ordermate-*` headers are compatibility identifiers. Do not rename provisioned resources as a cosmetic refactor; see [brand rules](docs/brand.md).

## Orientation
- Read `package.json` and `wrangler.jsonc` before changing commands, entrypoints or bindings. The deployed Worker currently enters through `src/worker/main-xero.ts`; follow its composed Worker and TenantStore exports rather than assuming `index.ts` is the whole application.
- Use [architecture](docs/architecture.md) for design intent and dated domain contracts in `docs/` for feature boundaries. Confirm current behaviour against code, migrations and recent merged work: architecture, roadmap, implementation-status and handoff documents can describe earlier releases.
- For roadmap, opportunity assessment or delivery briefs use [operating-layer-product-review](.agents/skills/operating-layer-product-review/SKILL.md). Read its full instructions when needed; a link is not an installation or execution claim.
- Keep product planning in the product skill and records; these always-on instructions govern repository work.

## Infrastructure invariants
- Deploy on Cloudflare Workers using the repository-pinned Wrangler CLI. Do not add another hosted runtime/database dependency.
- EU-jurisdiction D1 is the global control plane: authentication, organisations, membership/invitations, integration routing and OAuth state. Tenant operational records, integration credentials/entity links and reconciliation state belong in the tenant Durable Object.
- Each tenant uses its own EU-jurisdiction SQLite-backed `TenantStore` Durable Object. Documents/proposals use EU-jurisdiction R2 with tenant-scoped access.
- Use Cloudflare Queues for existing asynchronous workloads. Workflows are an available design option, not a currently provisioned dependency.
- Keep application secrets in Wrangler secrets / local `.dev.vars`. Store provider credentials encrypted through the integration credential path; never commit tokens or return them in normal reads.
- Preserve replay-safe migration tracking and fail closed on newer unsupported schemas. Use the relevant existing domain migration runner; do not replace tenant objects or casually consolidate independent migration histories.

## Security and domain invariants
- Browser tenant IDs are selectors. Verify authenticated membership in `CONTROL_DB` and enforce permissions server-side before routing. Provider callbacks/webhooks require their own validated OAuth state/signature and trusted routing.
- The public Worker is the external boundary; tenant objects are not directly exposed. Overwrite internal actor headers before forwarding. Unknown tenant routes fail closed.
- Enforce record/category/actor scope as well as role permissions. UI hiding, team assignment and feature flags do not grant access.
- Audit material business mutations; unchanged derived refreshes must not create audit noise. Preserve immutable inventory and work-item history.
- Store money as integer minor units and snapshot historic commercial values. Inventory changes use canonical movement/reservation paths, never a second stock engine.
- External replay/retries must not duplicate canonical mutations. Preserve durable identity, reconciliation, bounded retry and operator-visible exceptions.
- A refund does not imply restock. A PO is a commitment, not a supplier bill. Xero's current slice exports issued service invoices; do not imply broader accounting coverage.
- AI extracts, explains or proposes; human-reviewed canonical paths own consequential changes. Keep both AI flags disabled unless the existing processing/compliance decision authorises enablement. EU storage does not prove EU AI inference.

## Delivery workflow
Use the shared [Engineering Workflow rule](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/plugins/engineering-workflow/templates/always-on-agent-rule.md) as guidance: plan before novel/cross-cutting, security, storage or build-pipeline changes; keep implementation within scope; review the actual diff; verify before completion. A plan gate does not create a new approval requirement when the session already authorises the work.

Shared resources are pinned to Agent-Template commit `3bd2fa6e165ad415becf8a24b5f95a895fa6e017`. Installation and dependency handling are described in its [distribution guide](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/docs/distribution.md). Read applicable instructions through available tools; do not claim an unavailable skill/script ran.

For UI work use the applicable catalogue guidance: [frontend-design](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/catalog/ui-ux/frontend-design.md), [ui-ux-pro-max](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/catalog/ui-ux/ui-ux-pro-max.md), [React best practices](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/catalog/frontend-engineering/vercel-react-best-practices.md) and [web-design-guidelines](https://github.com/howellsryan/Agent-Template/blob/3bd2fa6e165ad415becf8a24b5f95a895fa6e017/catalog/ui-ux/web-design-guidelines.md). Follow canonical upstream links when needed; catalogue cards are pointers, not installed skills.

## Verification and completion
Use Node 24+ and the committed lockfile. For material application changes run:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run build:staging
```

Run focused checks while iterating. Documentation/skill-only changes require reference, instruction and diff review; they do not require application tests unless executable behaviour changes.

New tenant-scoped endpoints require tenant-isolation and permission coverage. Test affected invariants, migration upgrades/replay, integration idempotency and failure recovery when relevant. Exercise affected user flows with local Wrangler bindings; report browser/device checks separately.

Automatic verification uses Cloudflare Workers Builds; GitHub Actions verification is manual-only. See [CI configuration](docs/cloudflare-ci.md). Checks-only builds do not deploy or run remote migrations. Do not infer a successful check from a push or from an earlier commit.

Distinguish implemented, technically verified, deployed, live-provider validated and customer-outcome validated. Connector changes need relevant development-store/demo-company acceptance before claiming live readiness. State the tested revision, results and remaining gates. Do not deploy or run remote migrations solely to satisfy a local verification step.
