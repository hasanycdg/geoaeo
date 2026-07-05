// Usage accounting + hard quota throttling. The grounded-call budget is the
// dominant variable cost, so this is load-bearing for the business model:
// never crash on quota exhaustion — skip cleanly and surface it in the UI.
import type { Tenant } from "@geo/db";
import { prisma } from "@geo/db";
import { planConfig } from "../config/plans";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // ~1 billing month

/** Roll the usage window if the period elapsed. Returns the (possibly reset) tenant. */
export async function rolloverIfNeeded(tenant: Tenant): Promise<Tenant> {
  if (Date.now() - tenant.usagePeriodStart.getTime() < PERIOD_MS) return tenant;
  return prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      usageQueriesThisPeriod: 0,
      deepScanCreditsUsedThisPeriod: 0,
      usagePeriodStart: new Date(),
    },
  });
}

/** Deep Scan credits left this period for the shop's plan. */
export function remainingDeepScanCredits(
  tenant: Pick<Tenant, "plan" | "deepScanCreditsUsedThisPeriod">,
): number {
  const allowance = planConfig(tenant.plan).deepScanCreditsPerPeriod;
  return Math.max(0, allowance - tenant.deepScanCreditsUsedThisPeriod);
}

/** Whether the tenant can afford `n` more Deep Scan credits this period. */
export function canConsumeDeepScanCredits(
  tenant: Pick<Tenant, "plan" | "deepScanCreditsUsedThisPeriod">,
  n: number,
): boolean {
  if (n <= 0) return true;
  const allowance = planConfig(tenant.plan).deepScanCreditsPerPeriod;
  return Math.max(0, allowance - tenant.deepScanCreditsUsedThisPeriod) >= n;
}

/** Atomically consume `n` Deep Scan credits. */
export async function consumeDeepScanCredits(tenantId: string, n: number): Promise<void> {
  if (n <= 0) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { deepScanCreditsUsedThisPeriod: { increment: n } },
  });
}

/** Atomically reserve `n` Deep Scan credits. Returns false when insufficient. */
export async function reserveDeepScanCredits(tenant: Tenant, n: number): Promise<boolean> {
  if (!canConsumeDeepScanCredits(tenant, n)) return false;
  const allowance = planConfig(tenant.plan).deepScanCreditsPerPeriod;
  const res = await prisma.tenant.updateMany({
    where: {
      id: tenant.id,
      deepScanCreditsUsedThisPeriod: { lte: allowance - n },
    },
    data: { deepScanCreditsUsedThisPeriod: { increment: n } },
  });
  return res.count === 1;
}

/** Grounded calls left this period for the shop's plan. */
export function remainingQuota(tenant: Tenant): number {
  const limit = planConfig(tenant.plan).monthlyQueryQuota;
  return Math.max(0, limit - tenant.usageQueriesThisPeriod);
}

/** Atomically add `n` grounded calls to the tenant's usage. */
export async function incrementUsage(tenantId: string, n: number): Promise<void> {
  if (n <= 0) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { usageQueriesThisPeriod: { increment: n } },
  });
}

/** Record a one-off quota-reached alert (deduped per period via a marker check). */
export async function ensureQuotaAlert(tenantId: string): Promise<void> {
  const existing = await prisma.alert.findFirst({
    where: { tenantId, type: "QUOTA_REACHED", isRead: false },
  });
  if (existing) return;
  await prisma.alert.create({
    data: {
      tenantId,
      type: "QUOTA_REACHED",
      message:
        "You've reached this period's query quota. Scans will resume next " +
        "billing period, or upgrade your plan for a higher limit.",
    },
  });
}
