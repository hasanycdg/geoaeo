// Tenant resolution + auth for the HTTP API. Two trust paths:
//
//  WordPress plugin  → headers  X-Geo-Site + X-Geo-Api-Key
//     The site URL identifies the tenant; the API key is verified against the
//     sha256 stored in TenantCredential.meta.apiKeyHash.
//
//  Shopify app (trusted first-party server) → headers X-Geo-Internal-Secret + X-Geo-Shop
//     The Remix app has already authenticated the merchant via OAuth, so a shared
//     internal secret is sufficient; the shop domain identifies the tenant.
import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { Tenant } from "@geo/db";
import { prisma } from "@geo/db";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

declare module "hono" {
  interface ContextVariableMap {
    tenant: Tenant;
  }
}

export const requireTenant: MiddlewareHandler = async (c, next) => {
  const internal = c.req.header("x-geo-internal-secret");
  const shop = c.req.header("x-geo-shop");
  const site = c.req.header("x-geo-site");
  const apiKey = c.req.header("x-geo-api-key");

  let tenant: Tenant | null = null;

  if (internal && shop) {
    if (internal !== process.env.INTERNAL_API_SECRET) return c.json({ error: "unauthorized" }, 401);
    // Trusted first party: upsert the tenant row so reads work even before the
    // OAuth afterAuth hook has run (the offline token is filled in on next auth).
    tenant = await prisma.tenant.upsert({
      where: { platform_externalId: { platform: "SHOPIFY", externalId: shop } },
      update: {},
      create: { platform: "SHOPIFY", externalId: shop, brandName: shop.replace(/\.myshopify\.com$/, "") },
    });
  } else if (site && apiKey) {
    const externalId = site.replace(/\/$/, "");
    const found = await prisma.tenant.findUnique({
      where: { platform_externalId: { platform: "WORDPRESS", externalId } },
      include: { credentials: true },
    });
    const meta = found?.credentials?.meta as { apiKeyHash?: string } | null;
    if (found && meta?.apiKeyHash && meta.apiKeyHash === sha256(apiKey)) {
      const { credentials: _omit, ...rest } = found;
      tenant = rest as Tenant;
    }
  }

  if (!tenant) return c.json({ error: "unauthorized" }, 401);
  c.set("tenant", tenant);
  await next();
};

/** Convenience accessor within handlers. */
export function tenantOf(c: Context): Tenant {
  return c.get("tenant");
}
