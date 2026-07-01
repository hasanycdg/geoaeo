// Zero-config onboarding for WordPress. The plugin creates a WP Application
// Password on install and POSTs it here. We verify control of the site by
// calling its REST API with those credentials, then mint an API key the plugin
// uses for all subsequent v1 calls. No manual key copying by the merchant.
import { Hono } from "hono";
import crypto from "node:crypto";
import { prisma } from "@geo/db";
import { sha256 } from "../tenant";

const onboard = new Hono();

onboard.post("/wordpress", async (c) => {
  const { siteUrl, username, appPassword } = await c.req.json<{
    siteUrl: string;
    username: string;
    appPassword: string;
  }>();
  if (!siteUrl || !username || !appPassword) return c.json({ error: "missing_fields" }, 400);

  const externalId = siteUrl.replace(/\/$/, "");
  const auth = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  // Proof-of-control: the credentials must authenticate against the site.
  const check = await fetch(`${externalId}/wp-json/wp/v2/users/me`, {
    headers: { Authorization: auth, "User-Agent": "GEO-Monitor/1.0" },
  }).catch(() => null);
  if (!check || !check.ok) return c.json({ error: "site_verification_failed" }, 401);

  const apiKey = crypto.randomBytes(24).toString("hex");
  const tenant = await prisma.tenant.upsert({
    where: { platform_externalId: { platform: "WORDPRESS", externalId } },
    update: {},
    create: { platform: "WORDPRESS", externalId },
  });
  await prisma.tenantCredential.upsert({
    where: { tenantId: tenant.id },
    update: {
      secret: JSON.stringify({ username, appPassword }),
      meta: { apiKeyHash: sha256(apiKey), restBase: externalId },
    },
    create: {
      tenantId: tenant.id,
      secret: JSON.stringify({ username, appPassword }),
      meta: { apiKeyHash: sha256(apiKey), restBase: externalId },
    },
  });

  return c.json({ apiKey, tenantId: tenant.id, plan: tenant.plan });
});

export default onboard;
