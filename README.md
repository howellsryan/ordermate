# OrderMate

OrderMate is a Cloudflare-native multi-tenant SaaS for products, purchasing, orders and inventory.

## Architecture

- React + Vite frontend served by Cloudflare Workers Static Assets.
- Hono API on Cloudflare Workers.
- Better Auth with Google OAuth.
- D1 control plane for users, sessions, organizations and memberships.
- One EU-jurisdiction SQLite-backed Durable Object per tenant for operational data.
- EU-jurisdiction R2 for product images and documents.
- Queues/Workflows for asynchronous automation.
- Wrangler is the source of truth for deployable Cloudflare resources.

See `docs/architecture.md` and `docs/delivery-plan.md`.

## Bootstrap

1. Install dependencies: `npm install`.
2. Authenticate Wrangler: `npx wrangler login`.
3. Run `npm run cf:bootstrap`. This creates the compliance-sensitive D1/R2 resources through Wrangler and explains the one binding value Wrangler writes/returns.
4. Put local Google OAuth credentials and `BETTER_AUTH_SECRET` in `.dev.vars`.
5. Apply control-plane migrations locally with `npm run db:migrate:local`.
6. Start with `npm run dev`.

Before the first production deploy, create the Google OAuth production callback and store secrets with `wrangler secret put`.

## Deployment

`npm run db:migrate:remote`
`npm run deploy`

The deploy command builds the client and deploys the Worker through Wrangler.
