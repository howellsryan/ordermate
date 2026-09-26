# Operating Layer agent instructions

## Product boundary
Operating Layer is a multi-tenant order, purchasing and inventory SaaS. The runtime and persisted product data must remain Cloudflare-native unless the owner explicitly changes that constraint.

Customer-facing identity is **Operating Layer**. Existing `ordermate-*` Cloudflare resources, the current staging hostname and `x-ordermate-*` internal headers are legacy compatibility identifiers for the provisioned environment; do not rename them as a cosmetic refactor. See `docs/brand.md`.

## Infrastructure invariants
- Deploy application code on Cloudflare Workers using Wrangler.
- Use D1 only for the global control plane (authentication, organizations and memberships).
- Store each tenant's operational data inside its own EU-jurisdiction SQLite-backed `TenantStore` Durable Object.
- Store documents/images in EU-jurisdiction R2.
- Use Cloudflare Queues and Workflows for asynchronous/durable jobs when required.
- Do not introduce AWS, Azure, GCP, Vercel, Neon, Supabase or another hosted runtime/database dependency.
- Secrets belong in Wrangler secrets / local `.dev.vars`, never source control.

## Security invariants
- Never trust a tenant ID supplied by the browser without verifying the authenticated user's membership in `CONTROL_DB`.
- The public Worker is the only route to tenant Durable Objects. Tenant objects are not directly exposed.
- Overwrite internal actor headers before forwarding a request to a tenant object.
- Every tenant mutation emits an audit event.
- Money is stored as integer minor units, never floating point.
- Historic order and purchase-order lines snapshot commercial values.
- Inventory changes occur through movement/reservation operations; never silently overwrite stock.

## Delivery workflow
Use the current `howellsryan/Agent-Template` Engineering Workflow principles: plan-gate before cross-cutting/security/storage changes, scope-fence during implementation, verification-before-completion, and explicit evidence for completion claims. For UI work apply the catalogue's frontend-design, ui-ux-pro-max, Vercel React best-practices and web-design-guidelines resources.

## Verification
Before calling a material change complete run, when applicable:
`npm run typecheck`
`npm test`
`npm run build`
Then exercise the affected flow using local Wrangler bindings. Tenant isolation tests are mandatory for any new tenant-scoped endpoint.
