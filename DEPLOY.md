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

## Wiring the clients

- **WordPress plugin**: default backend is `https://api.geo-monitor.app`. If your
  domain differs, set in `wp-config.php`:
  `define('GEO_BACKEND_URL', 'https://api.<your-domain>');`
- **Shopify app**: set `GEO_API_URL=https://api.<your-domain>` and the SAME
  `INTERNAL_API_SECRET` as this server's `.env`.

## Notes

- **Secrets**: `.env` is gitignored — it lives only on the server. Rotate
  `INTERNAL_API_SECRET` and `POSTGRES_PASSWORD` from the examples.
- **Backups**: the `pgdata` volume holds all tenant data. Snapshot it (or use
  `pg_dump`) before updates once you have real customers.
- **Webhooks** (once billing is live): Stripe → `https://api.<domain>/webhooks/stripe`,
  Shopify billing → `https://api.<domain>/webhooks/shopify/billing`.
