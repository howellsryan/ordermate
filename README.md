# OrderMate

OrderMate is a Cloudflare-native multi-tenant SaaS for products, purchasing, orders and inventory.

## Architecture

- React + Vite frontend served by Cloudflare Workers Static Assets.
- Hono API on Cloudflare Workers.
- Better Auth with Google OAuth.
- D1 control plane for users, sessions, organizations, memberships and workspace invitations.
- One EU-jurisdiction SQLite-backed Durable Object per tenant for operational data.
- EU-jurisdiction R2 for product images and documents.
- Cloudflare Queues/Workflows for asynchronous and durable automation.
- Wrangler is the source of truth for deployable Cloudflare resources.

See `docs/architecture.md` and `docs/delivery-plan.md`.

## Local setup

1. Install the pinned dependencies:

   ```sh
   npm install
   ```

2. Authenticate the repository-pinned Wrangler CLI:

   ```sh
   npx wrangler login
   ```

3. Bootstrap the compliance-sensitive Cloudflare resources:

   ```sh
   npm run cf:bootstrap
   ```

   The script creates `ordermate-control` as an EU-jurisdiction D1 database, writes its `CONTROL_DB` binding into `wrangler.jsonc`, creates the EU-jurisdiction `ordermate-documents` R2 bucket, and creates the `ordermate-events` queue. The tenant SQLite Durable Object namespace is created from the Wrangler migration on deploy.

4. Create a Google OAuth **Web application** client. For local development, add the Better Auth redirect URI for the origin printed by Vite, ending in:

   ```text
   /api/auth/callback/google
   ```

   For example, if the local application is `http://localhost:5173`, use `http://localhost:5173/api/auth/callback/google`.

5. Create `.dev.vars` from `.env.example` and set:

   ```text
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   BETTER_AUTH_SECRET=...
   ```

   Use a cryptographically random, high-entropy value for `BETTER_AUTH_SECRET`. Never commit `.dev.vars`.

6. Apply the D1 control-plane migrations locally:

   ```sh
   npm run db:migrate:local
   ```

7. Run OrderMate locally:

   ```sh
   npm run dev
   ```

## Verification

Before proposing a material change for merge:

```sh
npm run typecheck
npm test
npm run build
```

The test suite runs the Worker and SQLite-backed Durable Objects using Cloudflare's Vitest integration. Tenant isolation and inventory consistency are required regression tests.

## Production configuration

Add the production application origin to the same Google OAuth client, using:

```text
https://<your-domain>/api/auth/callback/google
```

Store production credentials as Worker secrets rather than Wrangler vars or repository files:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put BETTER_AUTH_SECRET
```

Apply the control-plane migrations before deploying application code:

```sh
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` builds the React client and deploys the Worker, static assets, Durable Object migration and bindings through Wrangler.

## Cloudflare-only infrastructure rule

OrderMate's application runtime and durable product/customer data stay on Cloudflare unless the architecture is explicitly changed. Do not introduce AWS, Azure, GCP, Vercel, Neon, Supabase or another hosted runtime/database as an implicit dependency. Google is used only as the OAuth identity provider.
