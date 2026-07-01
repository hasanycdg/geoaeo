// Zero-config onboarding for WordPress (PUSH model).
//
// The plugin generates a random token, serves it at the PUBLIC url
// https://<site>/?geo_verify=1 (no REST access needed), then POSTs {siteUrl,
// verifyToken} here. We fetch that public url and confirm it serves the token —
// proving the caller controls the domain — then mint the API key the plugin uses
// for all subsequent v1 calls. Works on hosts that block /wp-json externally.
import { Hono } from "hono";
import crypto from "node:crypto";
import { prisma } from "@geo/db";
import { sha256 } from "../tenant";

const onboard = new Hono();

// Browser-like UA so hardened hosts / WAFs don't 403 the verification fetch.
const VERIFY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

onboard.post("/wordpress", async (c) => {
  const { siteUrl, verifyToken } = await c.req.json<{
    siteUrl: string;
    verifyToken: string;
  }>();
  if (!siteUrl || !verifyToken) return c.json({ error: "missing_fields" }, 400);

  const externalId = siteUrl.replace(/\/$/, "");

  // Proof-of-control: the site must serve our token at its public verify url.
  const res = await fetch(`${externalId}/?geo_verify=1`, {
    headers: { "User-Agent": VERIFY_UA },
    redirect: "follow",
  }).catch(() => null);
  const body = res && res.ok ? (await res.text()).trim() : null;
  if (!body || !body.includes(verifyToken)) {
    return c.json({ error: "site_verification_failed" }, 401);
  }

  const apiKey = crypto.randomBytes(24).toString("hex");
  const tenant = await prisma.tenant.upsert({
    where: { platform_externalId: { platform: "WORDPRESS", externalId } },
    update: { verifyToken, verifiedAt: new Date() },
    create: { platform: "WORDPRESS", externalId, verifyToken, verifiedAt: new Date() },
  });
  // A credential row still holds the API-key hash used by requireTenant. No WP
  // secret is stored anymore (the push model needs no callback credentials).
  await prisma.tenantCredential.upsert({
    where: { tenantId: tenant.id },
    update: { secret: "", meta: { apiKeyHash: sha256(apiKey) } },
    create: { tenantId: tenant.id, secret: "", meta: { apiKeyHash: sha256(apiKey) } },
  });

  return c.json({ apiKey, tenantId: tenant.id, plan: tenant.plan });
});

export default onboard;
