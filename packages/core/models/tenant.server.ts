// Tenant row helpers. A tenant is keyed by (platform, externalId):
//   SHOPIFY   → externalId = myshopify domain
//   WORDPRESS → externalId = site URL
import type { Platform } from "@geo/db";
import { prisma } from "@geo/db";
import { planConfig } from "../config/plans";

export async function getOrCreateTenant(platform: Platform, externalId: string) {
  return prisma.tenant.upsert({
    where: { platform_externalId: { platform, externalId } },
    update: {},
    create: { platform, externalId },
  });
}

export async function getTenantWithConfig(platform: Platform, externalId: string) {
  const tenant = await getOrCreateTenant(platform, externalId);
  return prisma.tenant.findUniqueOrThrow({
    where: { id: tenant.id },
    include: {
      prompts: { orderBy: { createdAt: "asc" } },
      competitors: { orderBy: { createdAt: "asc" } },
    },
  });
}

export type TenantWithConfig = Awaited<ReturnType<typeof getTenantWithConfig>>;

/** Whether the merchant has the minimum config to run a meaningful scan. */
export function isOnboarded(tenant: { brandName: string | null; prompts: unknown[] }) {
  return !!tenant.brandName && tenant.prompts.length > 0;
}

export function limitsFor(plan: Parameters<typeof planConfig>[0]) {
  return planConfig(plan);
}
