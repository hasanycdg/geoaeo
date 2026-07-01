// Core per-shop scan: query enabled providers for each active prompt, persist
// Run+Result rows, throttle on quota. Shared by the BullMQ worker and any
// direct/manual invocation. No BullMQ dependency here.
import type { Prisma } from "@geo/db";
import { prisma } from "@geo/db";
import { planConfig } from "../config/plans";
import { runScan, type ScanResult } from "./run-scan";
import {
  incrementUsage,
  remainingQuota,
  rolloverIfNeeded,
  ensureQuotaAlert,
} from "../billing/quota.server";
import type { BrandSpec } from "../analysis/analyze";

export interface TenantScanOutcome {
  skipped?: string;
  scansRun?: number;
  quotaHit?: boolean;
}

export async function runTenantScan(tenantId: string): Promise<TenantScanOutcome> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { prompts: { where: { isActive: true } }, competitors: true },
  });
  if (!tenant) return { skipped: "tenant-not-found" };
  const brandName = tenant.brandName;
  if (!brandName) return { skipped: "no-brand-name" };

  const rolled = await rolloverIfNeeded(tenant);
  const plan = planConfig(tenant.plan);

  const brand: BrandSpec = { name: brandName, aliases: tenant.brandAliases };
  // Own domains for citation attribution: the configured primary domain plus the
  // host derived from externalId (Shopify → myshopify domain, WordPress → site URL).
  const ownDomains = [tenant.primaryDomain, hostOf(tenant.externalId)].filter(
    (d): d is string => !!d,
  );
  const competitors: BrandSpec[] = tenant.competitors
    .slice(0, plan.maxCompetitors)
    .map((c) => ({ name: c.name, aliases: c.aliases }));
  const prompts = tenant.prompts.slice(0, plan.maxPrompts);

  let remaining = remainingQuota(rolled);
  let scansRun = 0;
  let quotaHit = false;
  let sampleError: string | null = null;

  try {
    outer: for (const prompt of prompts) {
      for (const provider of plan.providers) {
        if (remaining < plan.repetitions) {
          quotaHit = true;
          break outer;
        }
        const scan = await runScan({
          provider,
          prompt: prompt.text,
          brand,
          competitors,
          ownDomains,
          locale: prompt.locale,
          country: prompt.country,
          repetitions: plan.repetitions,
        });
        await persistScan(tenantId, prompt.id, scan);
        // Capture a representative provider error for worker-health surfacing.
        const failed = scan.runs.find((r) => r.error);
        if (failed?.error && !sampleError) sampleError = `${provider}: ${failed.error}`;
        const calls = scan.runs.length;
        await incrementUsage(tenantId, calls);
        remaining -= calls;
        scansRun++;
      }
    }
  } catch (err) {
    sampleError = err instanceof Error ? err.message : String(err);
    await recordHealth(tenantId, sampleError);
    throw err; // let BullMQ retry/record the job failure
  }

  await recordHealth(tenantId, sampleError);
  if (quotaHit) await ensureQuotaAlert(tenantId);
  return { scansRun, quotaHit };
}

/** Extract a bare host from an externalId that may be a domain or a full URL. */
function hostOf(externalId: string): string | null {
  try {
    if (externalId.includes("://")) return new URL(externalId).host;
    return externalId || null;
  } catch {
    return externalId || null;
  }
}

async function recordHealth(tenantId: string, error: string | null) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { lastScanCompletedAt: new Date(), lastScanError: error },
  });
}

async function persistScan(tenantId: string, promptId: string, scan: ScanResult) {
  for (const run of scan.runs) {
    const createdRun = await prisma.run.create({
      data: {
        tenantId,
        promptId,
        provider: scan.provider,
        modelId: run.modelId,
        batchId: scan.batchId,
        runIndex: run.runIndex,
        status: run.error ? "FAILED" : "SUCCESS",
        rawResponse: run.text || null,
        citations: run.citations as unknown as Prisma.InputJsonValue,
        error: run.error ?? null,
        promptTokens: run.promptTokens ?? null,
        completionTokens: run.completionTokens ?? null,
        completedAt: new Date(),
      },
    });
    if (run.analysis) {
      await prisma.result.create({
        data: {
          runId: createdRun.id,
          brandMentioned: run.analysis.brandMentioned,
          position: run.analysis.position,
          prominence: run.analysis.prominence,
          sentiment: run.analysis.sentiment,
          citedUrl: run.analysis.citedUrl,
          citedOwnDomain: run.analysis.citedOwnDomain,
          competitorMentions: run.analysis.competitorMentions as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}
