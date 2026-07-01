# GEO Monitor — Runbook

Measures brand/product visibility in AI answer engines (ChatGPT, Claude, Gemini,
Perplexity) and helps merchants improve it. **One shared backend** serves both
**Shopify** and **WordPress**; the business logic is identical, only billing and
store access differ per platform.

## Architecture (monorepo)

```
packages/
  db/    @geo/db    — Prisma, single DB, platform-neutral Tenant model + client
  core/  @geo/core  — ALL business logic (scan, analysis, audit, content, queue,
                      providers, plans, quota). Zero platform SDKs. Talks only to
                      @geo/db + the ports below.
    ports/          — PlatformPort (store access) + BillingPort (payments)
apps/
  api/   @geo/api   — THE backend. Hono HTTP service (/api/v1, /api/v2) + BullMQ
                      worker. Implements the ports as adapters:
                        platform: ShopifyAdminAdapter | WordpressRestAdapter
                        billing:  ShopifyBillingAdapter | StripeBillingAdapter
  wordpress-plugin/ — thin PHP client of /api/v1 (zero-config self-provisioning)
app/                — the existing Shopify Remix app (OAuth + embedded Polaris UI)
```

**Key idea:** `@geo/core` is platform-blind. Which platform a tenant is on is
decided once, in `apps/api/src/adapters/index.ts`, by `tenant.platform`. Billing
is Shopify Managed Billing for Shopify tenants and Stripe for WordPress tenants —
both behind the same `BillingPort`. API versions (`v1`, `v2`) are pure
request/response mappers over the same core; see `apps/api/src/routes/`.

## Prerequisites

- **Node 22**, not linked globally — prefix every command:
  ```sh
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  ```
- **pnpm** via corepack: `corepack enable` (pnpm is the workspace package manager).
- **Docker Desktop** (Postgres + Redis + optional local WordPress).

## Install + DB

```sh
corepack pnpm install
pnpm --filter @geo/db generate            # generate the Prisma client
docker compose up -d postgres redis       # infra
pnpm --filter @geo/db migrate             # apply migrations (prisma migrate deploy)
# first-time / schema changes during dev:  pnpm --filter @geo/db migrate:dev
```

## Run the backend (serves BOTH platforms)

```sh
pnpm --filter @geo/api dev                # HTTP API on :3000
pnpm --filter @geo/api worker             # SEPARATE terminal: BullMQ worker + scheduler
```

The worker is mandatory — all LLM queries run there, never in a request. Scans are
platform-neutral, so one worker serves Shopify and WordPress tenants alike.

Health check: `curl localhost:3000/health`.

## Run the Shopify app (client of the backend)

```sh
npm run dev                               # Shopify CLI: tunnel + embedded app (Partner login)
```

Set in `.env`: `INTERNAL_API_SECRET` (shared with the API) and `GEO_API_URL`
(defaults to `http://localhost:3000`). On install, `afterAuth`
(`app/geo/provision.server.ts`) upserts a SHOPIFY tenant and stores the offline
token so the worker/API can call Admin GraphQL.

## Test the WordPress plugin locally

```sh
docker compose up -d wordpress wp-db      # WordPress on :8080 (plugin auto-mounted)
```

1. Finish WP setup at http://localhost:8080, log in.
2. Activate **GEO Monitor** under Plugins. It creates an Application Password and
   self-registers against the API (`GEO_BACKEND_URL` is set to the host API in
   `docker-compose.yml`). No keys to copy.
3. Open **GEO Monitor** in wp-admin → set brand, add a prompt, **Run scan now**.
4. `llms.txt` is served at http://localhost:8080/llms.txt after "Generate".

## Stripe (WordPress billing)

```sh
stripe listen --forward-to localhost:3000/webhooks/stripe   # dev webhook secret → STRIPE_WEBHOOK_SECRET
```

Set `STRIPE_SECRET_KEY` and `STRIPE_PRICE_{STARTER,GROWTH,PRO}` (recurring price
ids) in `.env`. Upgrade flow: plugin → `POST /api/v1/billing/checkout` →
`StripeBillingAdapter` → Checkout URL → `customer.subscription.*` webhook writes
the plan back to the tenant.

## Shopify billing

No Stripe. `ShopifyBillingAdapter` creates an `appSubscriptionCreate` via Admin
GraphQL (using the stored offline token) and returns the confirmation URL. The
`app_subscriptions/update` webhook (`/webhooks/shopify/billing`, HMAC-verified with
`SHOPIFY_API_SECRET`) writes the plan back. `SHOPIFY_BILLING_TEST=true` in dev.

## API keys (optional until real measurements)

Without them providers return deterministic **mock** answers, so the full pipeline
still works end-to-end.

```
OPENAI_API_KEY=...  ANTHROPIC_API_KEY=...  GEMINI_API_KEY=...  PERPLEXITY_API_KEY=...
```

## Typecheck

```sh
./node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json   # core
./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json        # backend
./node_modules/.bin/tsc --noEmit -p tsconfig.json                 # Shopify app
```

All three are expected to be clean.

## Deploy

- **apps/api** (web + worker): `docker build -f apps/api/Dockerfile -t geo-api .`
  Needs managed Postgres + Redis. Run two processes: default CMD (web) and a
  second container with `command: pnpm --filter @geo/api worker`.
- **Shopify app**: deploy as today (`shopify app deploy` + host the Remix server).
- **WordPress plugin**: ship the `apps/wordpress-plugin/geo-monitor` folder as a
  ZIP / to WP.org. `GEO_BACKEND_URL` points at the deployed API.

## Migrating existing Shopify data (Shop → Tenant)

`packages/db/prisma/migrations/0001_init` is a **fresh-DB** baseline. If a DB with
the old `Shop`-based schema already has data, backfill instead of recreating:

1. Deploy the new tables (`Tenant`, `TenantCredential`, and the renamed FKs).
2. Backfill: `INSERT INTO "Tenant" (...)` from `Shop` with `platform='SHOPIFY'`,
   `externalId = domain`; copy `TrackedPrompt/Competitor/Run/Result/...` FK
   `shopId → tenantId`; `ProductMention.shopifyProductId → externalProductId`.
3. Seed `TenantCredential.secret` from the offline token in `Session.accessToken`.
   (New installs get this automatically via `afterAuth`.)

## Shopify UI route cutover — DONE

All `app/routes/app.*` Polaris routes (dashboard, settings, improve, billing,
content), the app-proxy `llms.txt` route, and the uninstall/GDPR webhooks now go
through the shared backend via `app/geo/backend.server.ts`
(`apiGet/apiPost/apiPatch/apiDelete/apiGetText`). The duplicated
`app/{scan,analysis,audit,content,models,config,billing,queue,providers}` were
deleted — that logic lives only in `@geo/core`. `app/db.server` remains solely for
Shopify session storage (`db.session`). All four tsconfig projects typecheck clean.

To verify against a dev store: run the API + worker, `npm run dev`, install on the
store (OAuth `afterAuth` provisions the tenant + offline token), then exercise each
page. The backend must be reachable at `GEO_API_URL` with a matching
`INTERNAL_API_SECRET`.
```
