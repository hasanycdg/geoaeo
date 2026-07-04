// Bridges Shopify OAuth into the shared @geo/db tenant model. On install we
// upsert a SHOPIFY tenant and persist the OFFLINE access token as its
// credential — that token is what lets the headless API + worker call the
// Admin GraphQL API later without a live session.
//
// NOTE: `@geo/db` is a linked workspace package whose Prisma client
// (`generated/client`) is emitted as CommonJS. Remix's Vite dev SSR inlines
// linked packages and evaluates them as ESM, which blows up on the client's
// `exports`/`require` ("exports is not defined"). It can't be externalized
// (Vite always bundles linked deps) nor prebundled (index.ts imports the client
// by relative path), so we load the CJS client through Node's native require,
// which bypasses Vite's ESM evaluator. tsx/Node (apps/api) are unaffected.
// Singleton-guarded to avoid connection storms across HMR reloads.
import { createRequire } from "node:module";
import type { PrismaClient as PrismaClientType } from "@geo/db";

const nodeRequire = createRequire(import.meta.url);
const { PrismaClient } = nodeRequire("@geo/db/client");

const globalForPrisma = globalThis as unknown as { geoDbPrisma?: PrismaClientType };
const prisma: PrismaClientType = globalForPrisma.geoDbPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.geoDbPrisma = prisma;

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
