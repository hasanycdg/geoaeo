// Bridges Shopify OAuth into the shared @geo/db tenant model. On install we
// upsert a SHOPIFY tenant and persist the OFFLINE access token as its
// credential — that token is what lets the headless API + worker call the
// Admin GraphQL API later without a live session.
import { prisma } from "@geo/db";

export async function provisionShopifyTenant(shop: string, offlineToken: string) {
  const tenant = await prisma.tenant.upsert({
    where: { platform_externalId: { platform: "SHOPIFY", externalId: shop } },
    update: {},
    create: {
      platform: "SHOPIFY",
      externalId: shop,
      brandName: shop.replace(/\.myshopify\.com$/, ""),
    },
  });
  await prisma.tenantCredential.upsert({
    where: { tenantId: tenant.id },
    update: { secret: offlineToken },
    create: { tenantId: tenant.id, secret: offlineToken },
  });
  return tenant;
}

/** GDPR / uninstall: remove the tenant and everything cascading from it. */
export async function deleteShopifyTenant(shop: string) {
  await prisma.tenant.deleteMany({ where: { platform: "SHOPIFY", externalId: shop } });
}
