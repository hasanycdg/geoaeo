# Deploy — GEO backend on Hetzner (backend-only)

Runs `apps/api` (web + worker) + Postgres + Redis + Caddy (TLS) via
`docker-compose.prod.yml`. The Shopify Remix app is hosted separately and points
at this API through `GEO_API_URL`.

## Prerequisites on the server

- A Hetzner VM (Ubuntu 22.04+ is fine), ports **80** and **443** open.
- Docker + Docker Compose plugin:
  ```sh
  curl -fsSL https://get.docker.com | sh
  ```
- A DNS **A-record** for `api.<your-domain>` pointing at the server's public IP.
  (Caddy needs this resolvable before it can issue a TLS cert.)

## First deploy

```sh
git clone https://github.com/hasanycdg/geoaeo.git
cd geoaeo
cp .env.prod.example .env
nano .env            # set API_DOMAIN, POSTGRES_PASSWORD, DATABASE_URL, INTERNAL_API_SECRET, keys
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` service applies `prisma migrate deploy` once, then `api-web` and
`api-worker` start. Caddy provisions a Let's Encrypt cert for `API_DOMAIN`
automatically (give it ~30s after DNS resolves).

## Verify

```sh
curl https://api.<your-domain>/health          # {"ok":true,"service":"geo-api"}
docker compose -f docker-compose.prod.yml ps    # all services Up; migrate = Exited (0)
docker compose -f docker-compose.prod.yml logs -f api-worker   # "geo worker up"
```

## Updates (later)

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Deploy the embedded Shopify app (app.<domain>)

The Shopify Remix app now runs as the `web` service in the same compose stack
(shares the DB with the API/worker). To host it publicly for testing/submission:

1. **DNS**: add an A-record `app.<domain>` → this server's IP.
2. **.env** (on the server): fill in the Shopify credentials from the Partner
   Dashboard → your app → API credentials, plus the public app URL:
   ```
   SHOPIFY_API_KEY=...
   SHOPIFY_API_SECRET=...
   SHOPIFY_APP_URL=https://app.getbrandradar.com
   WEB_HOST_PORT=8780
   ```
3. **Build + start** (rebuilds api + web, runs migrations, starts everything):
   ```sh
   docker compose -f docker-compose.prod.yml up -d --build
   ```
4. **nginx + TLS** for the app subdomain:
   ```sh
   sudo cp deploy/nginx-app.conf /etc/nginx/sites-available/app.getbrandradar.com
   sudo ln -s /etc/nginx/sites-available/app.getbrandradar.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d app.getbrandradar.com
   ```
5. **Point Shopify at the deployed URL** — in `shopify.app.toml` set:
   ```toml
   application_url = "https://app.getbrandradar.com"
   [auth]
   redirect_urls = [ "https://app.getbrandradar.com/auth/callback" ]
   [app_proxy]
   url = "https://app.getbrandradar.com/proxy"
   ```
   then push the config + extensions from your machine:
   ```sh
   npm run deploy          # = shopify app deploy
   ```
6. In the **Partner Dashboard**, set distribution to **Public (unlisted)** so you
   can install on a test store and exercise the real billing flow before submitting.

Verify: `curl https://app.getbrandradar.com` returns the app (302 to Shopify auth
when hit directly is expected), and installing on the dev store loads the embedded UI.

## Wiring the clients

- **WordPress plugin**: default backend is `https://api.getbrandradar.com`. If your
  domain differs, set in `wp-config.php`:
  `define('GEO_BACKEND_URL', 'https://api.<your-domain>');`
- **Shopify app**: hosted as the `web` service above; it reaches the API over the
  internal compose network (`GEO_API_URL=http://api-web:3000`, set in compose) and
  shares `INTERNAL_API_SECRET` from `.env`.

## Notes

- **Secrets**: `.env` is gitignored — it lives only on the server. Rotate
  `INTERNAL_API_SECRET` and `POSTGRES_PASSWORD` from the examples.
- **Backups**: the `pgdata` volume holds all tenant data. Snapshot it (or use
  `pg_dump`) before updates once you have real customers.
- **Webhooks** (once billing is live): Stripe → `https://api.<domain>/webhooks/stripe`,
  Shopify billing → `https://api.<domain>/webhooks/shopify/billing`.
