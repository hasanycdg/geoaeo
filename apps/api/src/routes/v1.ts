// Public API v1. Same core logic for every platform; the tenant is resolved by
// the requireTenant middleware. WordPress plugins and the Shopify app both hit
// these routes. Breaking changes go to v2 (see routes/v2.ts).
import { Hono } from "hono";
import { prisma } from "@geo/db";
import { enqueueTenantScan } from "@geo/core/queue";
import { getDashboard } from "@geo/core/models";
import { runAudit } from "@geo/core/audit";
import { generateLlmsTxt, saveLlmsTxt, suggestProductCopy, toProductDetail } from "@geo/core/content";
import { remainingQuota } from "@geo/core/billing";
import { planConfig } from "@geo/core/config/plans";
import { requireTenant, tenantOf } from "../tenant";
import { adaptersFor } from "../adapters";

const v1 = new Hono();
v1.use("*", requireTenant);

function primaryDomainOf(externalId: string, primaryDomain: string | null): string {
  if (primaryDomain) return primaryDomain;
  return externalId.includes("://") ? new URL(externalId).host : externalId;
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

// --- Billing -----------------------------------------------------------------
v1.post("/billing/checkout", async (c) => {
  const t = tenantOf(c);
  const body = await c.req.json<{ plan: "STARTER" | "GROWTH" | "PRO"; returnUrl: string }>();
  const { billing } = await adaptersFor(t);
  const session = await billing.createCheckout(t, body.plan, body.returnUrl);
  return c.json(session);
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
