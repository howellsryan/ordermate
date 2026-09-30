# Product context and source map

Repository: `howellsryan/ordermate`. Public identity: **Operating Layer**.

## Durable product intent
An operational layer for SMEs connecting external signals to completed business outcomes:
signal → consequence → prioritised exception → reviewed action → verified outcome.

Inventory-led SMEs are the documented primary audience. CRM/service modules also exist. The initial commercial segment, current paying customers, 90-day objective, pricing and delivery capacity require owner/customer evidence; do not infer them from the breadth of code.

Constraints: Cloudflare-native runtime/persisted product data, tenant isolation, audited canonical mutations, human review of consequential AI proposals. These can change only through an explicit owner decision.

## Repository sources
Read the actual files and applicable newer records:
- `AGENTS.md`: repository rules.
- `docs/brand.md`: positioning, naming and language.
- `docs/product-roadmap-2026-09-27.md`: product thesis and dated priorities.
- `docs/implementation-status.md`, `docs/next-agent-handoff.md`: historical verification/handoff evidence; confirm relevance to current main.
- `docs/integration-platform-2026-09-27.md`: integration contracts.
- `docs/operations-work-queue-2026-09-29.md`: persistent queue scope and follow-ons.
- `docs/xero-accounting-connector-2026-09-30.md`: accounting scope and live acceptance.
- `docs/competitive-gap-analysis.md`, `docs/sme-buying-friction-research-2026-09-26.md`, `docs/sme-workflow-research-2026-09-26.md`: dated discovery, not current market verification.
- `docs/cloudflare-ci.md`, `package.json`, `wrangler.jsonc`: current commands and CI/runtime configuration.
- Relevant code, migrations, tests and merged PRs: implementation and delivery evidence.

Look for explicitly maintained product records before introducing new ones. If none exist, propose a brief/current-state/roadmap/evidence/decision record structure; do not claim those records already exist.

## Historical starting checkpoint — revalidate before use
Reviewed main commit: `961c1cb87d864627f3959cee57063420bdb42dad`, 30 September 2026.

PR #11 merged Shopify outbound/returns, Xero service-invoice sync, onboarding and the persistent team Work Queue. Its reported automated verification is evidence for that revision only; live-provider acceptance was explicitly outstanding in the PR.

The September 27 roadmap still lists substantial parts of that delivery as upcoming. Xero contacts and issued service invoices do not imply product-sales accounting, supplier bills or a financial ledger. QuickBooks appearing in an integration schema does not prove a functioning connector.

The onboarding first-value timestamp is derived from the first order, PO or inventory movement creation. Validate whether that proxy represents the chosen customer's first useful completed workflow.

These are discovery leads, not permanent current-state assertions. Recheck main, release evidence and customer evidence each review.
