// Runs the AI-readiness audits and turns findings into actionable Recommendation
// rows. Replaces prior OPEN recommendations of the regenerated types so the
// to-do list reflects the current state; leaves DONE/DISMISSED history intact.
import type { Prisma } from "@geo/db";
import { prisma } from "@geo/db";
import { auditRobots } from "./robots.server";
import { auditSchema } from "./schema.server";
import { auditWeb } from "./web.server";

// Types this run regenerates (deleted+recreated). PRODUCT_COPY is managed elsewhere.
const MANAGED_TYPES: Prisma.RecommendationCreateManyInput["type"][] = [
  "ROBOTS_TXT",
  "SCHEMA",
  "LLMS_TXT",
  "WEB",
];

export interface AuditSummary {
  robotsBlocked: number;
  robotsReachable: boolean;
  schemaMissing: string[];
  schemaReachable: boolean;
  llmsTxtGenerated: boolean;
  sitemapReachable: boolean;
  hasMetaDescription: boolean;
  hasOpenGraph: boolean;
}

export async function runAudit(
  tenantId: string,
  domain: string,
  productUrl?: string,
): Promise<AuditSummary> {
  const [robots, schema, web, tenant] = await Promise.all([
    auditRobots(domain),
    auditSchema(productUrl || `https://${domain}`),
    auditWeb(domain),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { llmsTxt: true } }),
  ]);
  const llmsTxtGenerated = !!tenant?.llmsTxt;
  const foundLc = new Set(schema.found.map((t) => t.toLowerCase()));

  await prisma.recommendation.deleteMany({
    where: { tenantId, type: { in: MANAGED_TYPES }, status: "OPEN" },
  });

  const recs: Prisma.RecommendationCreateManyInput[] = [];

  // --- robots.txt ---
  if (robots.reachable && robots.blocked.length > 0) {
    recs.push({
      tenantId,
      type: "ROBOTS_TXT",
      severity: 1, // critical — silently kills AI visibility
      title: `${robots.blocked.length} AI crawler(s) blocked in robots.txt`,
      detail:
        `These AI crawlers are disallowed and cannot read your store: ` +
        `${robots.blocked.map((b) => b.bot).join(", ")}. ` +
        `Edit your theme's robots.txt.liquid to allow them, or remove the ` +
        `Disallow rules for these user-agents. Blocked crawlers means you ` +
        `cannot appear in those AI answers at all.`,
      data: { blocked: robots.blocked } as unknown as Prisma.InputJsonValue,
    });
  } else if (!robots.reachable) {
    recs.push({
      tenantId,
      type: "ROBOTS_TXT",
      severity: 3,
      title: "Couldn't check robots.txt",
      detail: `We couldn't fetch your robots.txt (${robots.error ?? "unknown"}). Set your store domain in Setup so we can audit it.`,
      data: { error: robots.error } as unknown as Prisma.InputJsonValue,
    });
  }

  // --- product structured data ---
  if (schema.reachable && schema.missingImportant.length > 0) {
    recs.push({
      tenantId,
      type: "SCHEMA",
      severity: 2,
      title: `Missing structured data: ${schema.missingImportant.join(", ")}`,
      detail:
        `Your product page is missing JSON-LD for: ${schema.missingImportant.join(", ")}. ` +
        `AI assistants rely on this markup to understand and recommend products. ` +
        `Add Product, Offer, AggregateRating and Review structured data via your ` +
        `theme or a structured-data app.`,
      data: { found: schema.found, missing: schema.missingImportant } as unknown as Prisma.InputJsonValue,
    });
  } else if (!schema.reachable) {
    recs.push({
      tenantId,
      type: "SCHEMA",
      severity: 3,
      title: "Couldn't check structured data",
      detail: `We couldn't fetch a product page (${schema.error ?? "unknown"}).`,
      data: { error: schema.error } as unknown as Prisma.InputJsonValue,
    });
  }

  // --- FAQ structured data (bonus: strong for conversational AI answers) ---
  if (schema.reachable && !foundLc.has("faqpage")) {
    recs.push({
      tenantId,
      type: "SCHEMA",
      severity: 3,
      title: "Add FAQ structured data (FAQPage)",
      detail:
        `Your product page has no FAQPage JSON-LD. FAQ markup answers the exact ` +
        `questions buyers ask assistants and is frequently quoted verbatim in AI ` +
        `answers. Add a few Q&As as FAQPage structured data (the AI content tab ` +
        `generates ready-to-use FAQs).`,
      data: {} as Prisma.InputJsonValue,
    });
  }

  // --- llms.txt ---
  if (!llmsTxtGenerated) {
    recs.push({
      tenantId,
      type: "LLMS_TXT",
      severity: 2,
      title: "Publish an llms.txt for your store",
      detail:
        `You haven't generated an llms.txt yet. It's a machine-readable map of your ` +
        `catalog that AI assistants can read directly. Generate it in the AI content ` +
        `tab — it's served automatically once the app is live.`,
      data: {} as Prisma.InputJsonValue,
    });
  }

  // --- site-level web checks ---
  if (web.reachable && !web.hasMetaDescription) {
    recs.push({
      tenantId,
      type: "WEB",
      severity: 2,
      title: "Homepage is missing a meta description",
      detail:
        `Your homepage has no meta description. Search and AI engines use it to ` +
        `summarize your store. Add a concise, benefit-led description in your theme's ` +
        `SEO / preferences settings.`,
      data: {} as Prisma.InputJsonValue,
    });
  }
  if (web.reachable && !web.hasOpenGraph) {
    recs.push({
      tenantId,
      type: "WEB",
      severity: 3,
      title: "Add Open Graph tags",
      detail:
        `No Open Graph (og:) tags were found on your homepage. They control how your ` +
        `store looks when shared or cited, and help AI engines extract title, description ` +
        `and image. Most themes add these automatically — check your theme or an SEO app.`,
      data: {} as Prisma.InputJsonValue,
    });
  }
  if (web.reachable && !web.sitemapReachable) {
    recs.push({
      tenantId,
      type: "WEB",
      severity: 2,
      title: "sitemap.xml not reachable",
      detail:
        `We couldn't reach /sitemap.xml. A sitemap helps crawlers (including AI crawlers) ` +
        `discover all your products and pages. Shopify generates one automatically — ensure ` +
        `it isn't blocked in robots.txt and your storefront password is off.`,
      data: {} as Prisma.InputJsonValue,
    });
  }

  if (recs.length) await prisma.recommendation.createMany({ data: recs });

  return {
    robotsBlocked: robots.blocked.length,
    robotsReachable: robots.reachable,
    schemaMissing: schema.missingImportant,
    schemaReachable: schema.reachable,
    llmsTxtGenerated,
    sitemapReachable: web.sitemapReachable,
    hasMetaDescription: web.hasMetaDescription,
    hasOpenGraph: web.hasOpenGraph,
  };
}
