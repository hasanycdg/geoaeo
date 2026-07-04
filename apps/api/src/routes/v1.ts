// Public API v1. Same core logic for every platform; the tenant is resolved by
// the requireTenant middleware. WordPress plugins and the Shopify app both hit
// these routes. Breaking changes go to v2 (see routes/v2.ts).
import { Hono } from "hono";
import { prisma, type Prisma } from "@geo/db";
import { enqueueTenantScan, enqueueDeepScan } from "@geo/core/queue";
import { getDashboard } from "@geo/core/models";
import { runAudit } from "@geo/core/audit";
import { generateDeepReport } from "@geo/core/analysis";
import { generateLlmsTxt, saveLlmsTxt, suggestProductCopy, toProductDetail } from "@geo/core/content";
import {
  remainingQuota,
  remainingDeepScanCredits,
  canConsumeDeepScanCredits,
  reserveDeepScanCredits,
  rolloverIfNeeded,
} from "@geo/core/billing";
import { planConfig, DEEP_SCAN_CREDIT_COST, planCatalog } from "@geo/core/config/plans";
import { DEEP_SCAN_PHASES } from "@geo/core/deep-scan";
import { requireTenant, tenantOf } from "../tenant";
import { adaptersFor } from "../adapters";

const v1 = new Hono();
v1.use("*", requireTenant);

function primaryDomainOf(externalId: string, primaryDomain: string | null): string {
  if (primaryDomain) return primaryDomain;
  return externalId.includes("://") ? new URL(externalId).host : externalId;
}

function deepScanProgress(phase: string, status: string) {
  if (status === "COMPLETED") {
    return { currentStep: DEEP_SCAN_PHASES.length, totalSteps: DEEP_SCAN_PHASES.length, percent: 100 };
  }
  const idx = Math.max(0, DEEP_SCAN_PHASES.indexOf(phase as (typeof DEEP_SCAN_PHASES)[number]));
  return {
    currentStep: Math.min(idx + 1, DEEP_SCAN_PHASES.length),
    totalSteps: DEEP_SCAN_PHASES.length,
    percent: Math.max(5, Math.round((idx / (DEEP_SCAN_PHASES.length - 1)) * 100)),
  };
}

function deepScanCreditErrorMessage(plan: string, remaining: number) {
  return plan === "FREE"
    ? `Deep Scan isn't included on the Free plan. Upgrade to run a Deep Scan (${DEEP_SCAN_CREDIT_COST} credits).`
    : `Deep Scan needs ${DEEP_SCAN_CREDIT_COST} credits; you have ${remaining} left this period.`;
}

// --- Tenant config -----------------------------------------------------------
v1.get("/tenant", async (c) => {
  const t = tenantOf(c);
  const full = await prisma.tenant.findUniqueOrThrow({
    where: { id: t.id },
    include: { prompts: { orderBy: { createdAt: "asc" } }, competitors: { orderBy: { createdAt: "asc" } } },
  });
  const limits = planConfig(full.plan);
  return c.json({
    tenant: full,
    limits,
    onboarded: !!full.brandName && full.prompts.length > 0,
    usage: {
      used: full.usageQueriesThisPeriod,
      remaining: remainingQuota(full),
      quota: limits.monthlyQueryQuota,
    },
  });
});

// Both clients (Shopify app, WP plugin) POST to update the tenant.
v1.post("/tenant", async (c) => {
  const t = tenantOf(c);
  const body = await c.req.json<{ brandName?: string; brandAliases?: string[]; primaryDomain?: string }>();
  const updated = await prisma.tenant.update({
    where: { id: t.id },
    data: {
      brandName: body.brandName ?? undefined,
      brandAliases: body.brandAliases ?? undefined,
      primaryDomain: body.primaryDomain ?? undefined,
    },
  });
  return c.json({ tenant: updated });
});

// WordPress push sync: the plugin sends the locally-gathered store profile +
// catalog (no REST pull). Cached on the tenant; the WP adapter reads it. Shopify
// tenants never call this (they read the live Admin API).
v1.post("/wp/sync", async (c) => {
  const t = tenantOf(c);
  const body = await c.req.json<{
    storeProfile?: { name?: string; description?: string | null; primaryUrl?: string };
    catalog?: unknown[];
  }>();
  await prisma.tenant.update({
    where: { id: t.id },
    data: {
      storeProfile: body.storeProfile ?? undefined,
      catalog: body.catalog === undefined ? undefined : (body.catalog as Prisma.InputJsonValue),
    },
  });
  return c.json({ ok: true, items: Array.isArray(body.catalog) ? body.catalog.length : 0 });
});

v1.post("/prompts", async (c) => {
  const t = tenantOf(c);
  const limit = planConfig(t.plan).maxPrompts;
  const count = await prisma.trackedPrompt.count({ where: { tenantId: t.id } });
  if (count >= limit) return c.json({ error: "prompt_limit_reached", limit }, 402);
  const body = await c.req.json<{ text: string; locale?: string; country?: string }>();
  const prompt = await prisma.trackedPrompt.create({
    data: {
      tenantId: t.id,
      text: body.text,
      locale: body.locale ?? t.defaultLocale,
      country: body.country ?? t.defaultCountry,
    },
  });
  return c.json({ prompt }, 201);
});

v1.delete("/prompts/:id", async (c) => {
  const t = tenantOf(c);
  await prisma.trackedPrompt.deleteMany({ where: { id: c.req.param("id"), tenantId: t.id } });
  return c.body(null, 204);
});

v1.post("/competitors", async (c) => {
  const t = tenantOf(c);
  const limit = planConfig(t.plan).maxCompetitors;
  const count = await prisma.competitor.count({ where: { tenantId: t.id } });
  if (count >= limit) return c.json({ error: "competitor_limit_reached", limit }, 402);
  const body = await c.req.json<{ name: string; aliases?: string[]; domain?: string }>();
  const competitor = await prisma.competitor.create({
    data: { tenantId: t.id, name: body.name, aliases: body.aliases ?? [], domain: body.domain },
  });
  return c.json({ competitor }, 201);
});

v1.delete("/competitors/:id", async (c) => {
  const t = tenantOf(c);
  await prisma.competitor.deleteMany({ where: { id: c.req.param("id"), tenantId: t.id } });
  return c.body(null, 204);
});

// --- Scan (async via queue) --------------------------------------------------
v1.post("/scan", async (c) => {
  const t = tenantOf(c);
  const job = await enqueueTenantScan(t.id, "manual");
  return c.json({ enqueued: true, jobId: job.id }, 202);
});

// --- Dashboard ---------------------------------------------------------------
v1.get("/dashboard", async (c) => {
  const t = tenantOf(c);
  const windowDays = Number(c.req.query("windowDays") ?? 90);
  return c.json(await getDashboard(t.id, windowDays));
});

// --- Deep Analysis report ----------------------------------------------------
// Grounds one OpenAI call in the tenant's REAL data (last-scan answers, share of
// model, technical audit, catalog) → scored, prioritized, shop-specific plan.
// On-demand (not persisted) so it needs no schema change.
v1.post("/deep-report", async (c) => {
  const t = tenantOf(c);
  const full = await prisma.tenant.findUniqueOrThrow({
    where: { id: t.id },
    include: {
      prompts: { where: { isActive: true }, orderBy: { createdAt: "asc" } },
      competitors: { orderBy: { createdAt: "asc" } },
    },
  });
  const domain = primaryDomainOf(full.externalId, full.primaryDomain);

  // Real AI answers from the most recent runs, so the model reasons over what
  // the assistants actually said (not just aggregate numbers).
  const runs = await prisma.run.findMany({
    where: { tenantId: t.id, rawResponse: { not: null } },
    include: { prompt: true, result: true },
    orderBy: { completedAt: "desc" },
    take: 8,
  });
  const sampleAnswers = runs.map((r) => ({
    prompt: r.prompt.text,
    provider: r.provider as string,
    brandMentioned: r.result?.brandMentioned ?? false,
    answer: r.rawResponse ?? "",
  }));

  const { platform } = await adaptersFor(full);
  const catalog = await platform.listProducts(full).catch(() => []);
  const products = catalog.map((p) => ({
    title: p.title,
    productType: p.productType,
    description: p.description ?? "",
  }));

  const [dashboard, audit] = await Promise.all([
    getDashboard(t.id),
    runAudit(t.id, domain).catch(() => null),
  ]);

  const report = await generateDeepReport({
    brandName: full.brandName ?? full.externalId,
    domain,
    plan: full.plan,
    prompts: full.prompts.map((p) => p.text),
    competitors: full.competitors.map((cm) => cm.name),
    dashboard,
    sampleAnswers,
    products,
    audit,
  });

  // Persist an immutable snapshot so merchants keep a dated history.
  const saved = await prisma.deepReport.create({
    data: {
      tenantId: t.id,
      visibilityScore: report.visibilityScore,
      verdict: report.verdict,
      data: report as unknown as Prisma.InputJsonValue,
    },
  });
  return c.json({ ...report, id: saved.id });
});

// History list (newest first) — id + date + headline metrics for the picker.
v1.get("/deep-report/history", async (c) => {
  const t = tenantOf(c);
  const reports = await prisma.deepReport.findMany({
    where: { tenantId: t.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, createdAt: true, visibilityScore: true, verdict: true },
  });
  return c.json({ reports });
});

// Reopen a stored report by id.
v1.get("/deep-report/:id", async (c) => {
  const t = tenantOf(c);
  const row = await prisma.deepReport.findFirst({
    where: { id: c.req.param("id"), tenantId: t.id },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ...(row.data as object), id: row.id });
});

// --- Deep Scan (credit-gated, async BullMQ workflow) --------------------------
v1.post("/deep-scans/run", async (c) => {
  const t = tenantOf(c);
  const fresh = await prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
  const rolled = await rolloverIfNeeded(fresh);
  if (!canConsumeDeepScanCredits(rolled, DEEP_SCAN_CREDIT_COST)) {
    const remaining = remainingDeepScanCredits(rolled);
    return c.json(
      {
        error: "insufficient_credits",
        message: deepScanCreditErrorMessage(rolled.plan, remaining),
        remaining,
        cost: DEEP_SCAN_CREDIT_COST,
      },
      402,
    );
  }
  const reserved = await reserveDeepScanCredits(rolled, DEEP_SCAN_CREDIT_COST);
  if (!reserved) {
    const latest = await prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
    const remaining = remainingDeepScanCredits(latest);
    return c.json(
      {
        error: "insufficient_credits",
        message: deepScanCreditErrorMessage(latest.plan, remaining),
        remaining,
        cost: DEEP_SCAN_CREDIT_COST,
      },
      402,
    );
  }

  let scanId: string | null = null;
  try {
    const scan = await prisma.deepScan.create({
      data: { tenantId: t.id, creditCost: DEEP_SCAN_CREDIT_COST, status: "PENDING" },
    });
    scanId = scan.id;
    await enqueueDeepScan(scan.id);
    return c.json(
      {
        id: scan.id,
        status: scan.status,
        currentPhase: scan.currentPhase,
        creditCost: scan.creditCost,
        progress: deepScanProgress(scan.currentPhase, scan.status),
      },
      202,
    );
  } catch (err) {
    await prisma.tenant.update({
      where: { id: t.id },
      data: { deepScanCreditsUsedThisPeriod: { decrement: DEEP_SCAN_CREDIT_COST } },
    });
    if (scanId) {
      await prisma.deepScan.update({
        where: { id: scanId },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    }
    throw err;
  }
});

v1.get("/deep-scans", async (c) => {
  const t = tenantOf(c);
  const [scans, tenant] = await Promise.all([
    prisma.deepScan.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, status: true, currentPhase: true, createdAt: true, completedAt: true, creditCost: true },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: t.id } }),
  ]);
  return c.json({
    scans: scans.map((scan) => ({ ...scan, progress: deepScanProgress(scan.currentPhase, scan.status) })),
    remaining: remainingDeepScanCredits(tenant),
    cost: DEEP_SCAN_CREDIT_COST,
    plan: tenant.plan,
  });
});

v1.get("/deep-scans/:id", async (c) => {
  const t = tenantOf(c);
  const scan = await prisma.deepScan.findFirst({
    where: { id: c.req.param("id"), tenantId: t.id },
    include: {
      tenant: { select: { plan: true } },
      research: true,
      answers: {
        select: {
          prompt: true,
          engine: true,
          ownBrandMentioned: true,
          ownBrandPosition: true,
          detectedBrands: true,
        },
      },
      _count: { select: { answers: true } },
    },
  });
  if (!scan) return c.json({ error: "not_found" }, 404);
  const expectedEngines = planConfig(scan.tenant.plan).providers;
  const promptCount = Array.isArray(scan.generatedPrompts) ? scan.generatedPrompts.length : new Set(scan.answers.map((a) => a.prompt)).size;
  const ownBrandMentionedAnswers = scan.answers.filter((a) => a.ownBrandMentioned).length;
  const competitorPresentWithoutOwnBrand = scan.answers.filter((a) => {
    const detected = Array.isArray(a.detectedBrands) ? a.detectedBrands : [];
    return !a.ownBrandMentioned && detected.length > 0;
  }).length;
  const ownBrandPositions = scan.answers
    .map((a) => a.ownBrandPosition)
    .filter((pos): pos is number => typeof pos === "number");
  const avgOwnBrandPosition = ownBrandPositions.length
    ? Number((ownBrandPositions.reduce((sum, pos) => sum + pos, 0) / ownBrandPositions.length).toFixed(2))
    : null;
  const failedEngines = expectedEngines.filter((engine) => {
    const count = scan.answers.filter((answer) => answer.engine === engine).length;
    return promptCount > 0 && count < promptCount;
  });
  const progress = deepScanProgress(scan.currentPhase, scan.status);
  return c.json({
    progress,
    answersSummary: {
      totalAnswers: scan.answers.length,
      promptCount,
      expectedEngines,
      failedEngines,
      ownBrandMentionedAnswers,
      competitorPresentWithoutOwnBrand,
      avgOwnBrandPosition,
      visibilityScore: scan.answers.length ? Math.round((ownBrandMentionedAnswers / scan.answers.length) * 100) : 0,
    },
    scan: {
      ...scan,
      tenant: undefined,
      answers: undefined,
      progress,
    },
  });
});

// --- AI Answer Explorer: the real answers per prompt (latest per engine) ------
v1.get("/answers", async (c) => {
  const t = tenantOf(c);
  const runs = await prisma.run.findMany({
    where: { tenantId: t.id, rawResponse: { not: null } },
    include: { prompt: true, result: true },
    orderBy: { completedAt: "desc" },
    take: 80,
  });
  const byPrompt = new Map<
    string,
    {
      promptId: string;
      prompt: string;
      answers: {
        provider: string;
        brandMentioned: boolean;
        sentiment: string;
        position: number | null;
        competitors: string[];
        citations: { url: string; title?: string }[];
        answer: string;
        completedAt: Date | null;
      }[];
    }
  >();
  for (const r of runs) {
    let grp = byPrompt.get(r.promptId);
    if (!grp) {
      grp = { promptId: r.promptId, prompt: r.prompt.text, answers: [] };
      byPrompt.set(r.promptId, grp);
    }
    if (grp.answers.some((a) => a.provider === r.provider)) continue; // keep latest per engine (desc order)
    const cms = (r.result?.competitorMentions as unknown as { name: string; mentioned: boolean }[]) ?? [];
    grp.answers.push({
      provider: r.provider as string,
      brandMentioned: r.result?.brandMentioned ?? false,
      sentiment: (r.result?.sentiment as string) ?? "UNKNOWN",
      position: r.result?.position ?? null,
      competitors: cms.filter((cm) => cm.mentioned).map((cm) => cm.name),
      citations: (r.citations as unknown as { url: string; title?: string }[]) ?? [],
      answer: r.rawResponse ?? "",
      completedAt: r.completedAt,
    });
  }
  return c.json({ prompts: [...byPrompt.values()] });
});

// --- Visibility trends over time (per scan batch) -----------------------------
v1.get("/trends", async (c) => {
  const t = tenantOf(c);
  const runs = await prisma.run.findMany({
    where: { tenantId: t.id, completedAt: { not: null } },
    include: { result: true },
    orderBy: { completedAt: "asc" },
  });
  type Batch = {
    date: Date | null;
    total: number;
    mentioned: number;
    byProvider: Record<string, { total: number; mentioned: number }>;
    competitors: Record<string, number>; // competitor name -> answers mentioning it, this batch
  };
  const batches = new Map<string, Batch>();
  const totalByCompetitor = new Map<string, number>();
  let brandTotal = 0;

  for (const r of runs) {
    if (!r.result) continue;
    const b =
      batches.get(r.batchId) ?? { date: r.completedAt, total: 0, mentioned: 0, byProvider: {}, competitors: {} };
    b.total++;
    if (r.result.brandMentioned) {
      b.mentioned++;
      brandTotal++;
    }
    if (r.completedAt && (!b.date || r.completedAt > b.date)) b.date = r.completedAt;
    const bp = b.byProvider[r.provider] ?? { total: 0, mentioned: 0 };
    bp.total++;
    if (r.result.brandMentioned) bp.mentioned++;
    b.byProvider[r.provider] = bp;

    const cms = (r.result.competitorMentions as unknown as { name: string; mentioned: boolean }[]) ?? [];
    for (const cm of cms) {
      if (!cm.mentioned) continue;
      b.competitors[cm.name] = (b.competitors[cm.name] ?? 0) + 1;
      totalByCompetitor.set(cm.name, (totalByCompetitor.get(cm.name) ?? 0) + 1);
    }
    batches.set(r.batchId, b);
  }

  const ordered = [...batches.values()].sort((a, b) =>
    a.date && b.date ? a.date.getTime() - b.date.getTime() : 0,
  );
  const points = ordered.map((b) => ({
    date: b.date,
    mentionRate: b.total ? b.mentioned / b.total : 0,
    byProvider: Object.fromEntries(
      Object.entries(b.byProvider).map(([k, v]) => [k, v.total ? v.mentioned / v.total : 0]),
    ),
  }));

  // Share of voice: brand + competitors by total answers mentioning them.
  const leaderboard = [
    { name: "You", count: brandTotal, isBrand: true },
    ...[...totalByCompetitor.entries()].map(([name, count]) => ({ name, count, isBrand: false })),
  ].sort((a, b) => b.count - a.count);

  // Appearance-rate series for the top competitors, aligned to `points` order.
  const topCompetitors = [...totalByCompetitor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n]) => n);
  const competitorSeries = topCompetitors.map((name) => ({
    name,
    values: ordered.map((b) => (b.total ? (b.competitors[name] ?? 0) / b.total : 0)),
  }));

  return c.json({ points, leaderboard, competitorSeries });
});

// --- Action-Layer audit (robots.txt + schema) --------------------------------
v1.post("/audit", async (c) => {
  const t = tenantOf(c);
  const domain = primaryDomainOf(t.externalId, t.primaryDomain);
  const body = await c.req.json<{ productUrl?: string }>().catch(() => ({}) as { productUrl?: string });
  const summary = await runAudit(t.id, domain, body.productUrl);
  return c.json(summary);
});

v1.get("/recommendations", async (c) => {
  const t = tenantOf(c);
  const recommendations = await prisma.recommendation.findMany({
    where: { tenantId: t.id, status: { in: ["OPEN", "DONE"] } },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "desc" }],
  });
  return c.json({ recommendations });
});

v1.patch("/recommendations/:id", async (c) => {
  const t = tenantOf(c);
  const body = await c.req.json<{ status: "OPEN" | "DONE" | "DISMISSED" }>();
  await prisma.recommendation.updateMany({
    where: { id: c.req.param("id"), tenantId: t.id },
    data: { status: body.status },
  });
  return c.json({ ok: true });
});

// --- Content: products (picker) + AI copy ------------------------------------
v1.get("/content/products", async (c) => {
  const t = tenantOf(c);
  const { platform } = await adaptersFor(t);
  const products = await platform.listProducts(t).catch(() => []);
  return c.json({ products: products.map((p) => ({ id: p.externalId, title: p.title })) });
});

v1.post("/content/product-copy", async (c) => {
  const t = tenantOf(c);
  const { productId } = await c.req.json<{ productId: string }>();
  const { platform } = await adaptersFor(t);
  const products = await platform.listProducts(t);
  const item = products.find((p) => p.externalId === productId);
  if (!item) return c.json({ error: "product_not_found" }, 404);
  const suggestion = await suggestProductCopy(toProductDetail(item));
  return c.json({ productTitle: item.title, suggestion });
});

// --- Content: llms.txt -------------------------------------------------------
v1.post("/content/llms-txt", async (c) => {
  const t = tenantOf(c);
  const { platform } = await adaptersFor(t);
  const result = await generateLlmsTxt(platform, t);
  await saveLlmsTxt(t.id, result.content);
  // Push to platforms that host the file themselves (WordPress).
  if (platform.publishLlmsTxt) await platform.publishLlmsTxt(t, result.content).catch(() => {});
  return c.json(result);
});

// Serve the cached llms.txt (Shopify app proxy / WP virtual route reads this).
v1.get("/content/llms-txt", async (c) => {
  const t = tenantOf(c);
  const row = await prisma.tenant.findUniqueOrThrow({ where: { id: t.id }, select: { llmsTxt: true } });
  return c.text(row.llmsTxt ?? "", 200, { "Content-Type": "text/plain; charset=utf-8" });
});

// --- Pricing catalog (shared by Shopify UI + WordPress plugin) ---------------
v1.get("/plans", async (c) => {
  const t = tenantOf(c);
  return c.json({ plans: planCatalog(), currentPlan: t.plan });
});

// --- Billing -----------------------------------------------------------------
v1.post("/billing/checkout", async (c) => {
  const t = tenantOf(c);
  const body = await c.req.json<{ plan: "STARTER" | "GROWTH" | "PRO"; returnUrl: string }>();
  const { billing } = await adaptersFor(t);
  try {
    const session = await billing.createCheckout(t, body.plan, body.returnUrl);
    return c.json(session);
  } catch (err) {
    // e.g. "Apps without a public distribution cannot use the Billing API" in dev.
    // Return a clean error instead of a 500 so the UI can show a friendly notice.
    return c.json({ error: "billing_unavailable", message: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Reconcile the tenant's plan with the provider's authoritative state.
v1.get("/billing/plan", async (c) => {
  const t = tenantOf(c);
  const { billing } = await adaptersFor(t);
  const plan = await billing.getActivePlan(t);
  if (plan !== t.plan) await prisma.tenant.update({ where: { id: t.id }, data: { plan } });
  return c.json({ plan });
});

v1.post("/billing/cancel", async (c) => {
  const t = tenantOf(c);
  const { billing } = await adaptersFor(t);
  await billing.cancel(t);
  await prisma.tenant.update({ where: { id: t.id }, data: { plan: "FREE", billingRef: null } });
  return c.json({ ok: true });
});

export default v1;
