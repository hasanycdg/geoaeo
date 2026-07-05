// COMPETITOR_RESEARCH phase. Researches ONLY the top-2 competitors, max 5 pages
// each. Parser-first: extract title/meta/headings/schema-types/FAQ questions and
// boolean signals — NEVER send full HTML to an LLM. Caches by domain for
// RESEARCH_CACHE_DAYS. Resilient: a failing page or unresolved domain is skipped.
import { prisma } from "@geo/db";
import { auditSchemaHtml } from "../audit/schema.server";
import { auditHomepageHtml } from "../audit/web.server";
import type { ShopSnapshot, CompetitorResearch, ResearchedPage, DetectedCompetitor } from "./types";
import { MAX_PAGES_PER_COMPETITOR, RESEARCH_CACHE_DAYS } from "./types";

const UA = { "user-agent": "GEO-Monitor-Deep-Scan/1.0" };

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
}

function extractHeadings(html: string): string[] {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1 && t.length < 120)
    .slice(0, 12);
}

function extractFaqQuestions(html: string, headings: string[]): string[] {
  const qs = new Set<string>();
  for (const m of html.matchAll(/"@type"\s*:\s*"Question"[\s\S]{0,200}?"name"\s*:\s*"([^"]{5,160})"/gi)) qs.add(m[1].trim());
  for (const h of headings) if (h.endsWith("?")) qs.add(h);
  return [...qs].slice(0, 10);
}

function sameHost(href: string, host: string): string | null {
  try {
    const u = new URL(href, `https://${host}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() === host ? u.toString().split("#")[0] : null;
  } catch {
    return null;
  }
}

function classify(url: string): ResearchedPage["kind"] | null {
  const u = url.toLowerCase();
  if (/faq|help|support/.test(u)) return "faq";
  if (/guide|blog|learn|compare|vs-|versus/.test(u)) return "guide";
  if (/product|\/p\/|item/.test(u)) return "product";
  if (/collection|category|shop|catalog/.test(u)) return "category";
  return null;
}

async function inspectPage(url: string, kind: string): Promise<ResearchedPage> {
  const html = await fetchHtml(url);
  if (!html) return { url, kind, title: null, metaDescription: false, headings: [], schemaTypes: [], faqQuestions: [], ok: false };
  const headings = extractHeadings(html);
  const schema = auditSchemaHtml(html);
  const { hasMetaDescription } = auditHomepageHtml(html);
  return {
    url,
    kind,
    title: extractTitle(html),
    metaDescription: hasMetaDescription,
    headings,
    schemaTypes: schema.found,
    faqQuestions: extractFaqQuestions(html, headings),
    ok: true,
  };
}

/** Pick up to MAX_PAGES pages: homepage + best-matching category/product/faq/guide links. */
function pickPages(homepageHtml: string, host: string): { url: string; kind: string }[] {
  const links = new Set<string>();
  for (const m of homepageHtml.matchAll(/href=["']([^"']+)["']/gi)) {
    const abs = sameHost(m[1], host);
    if (abs) links.add(abs);
  }
  const byKind = new Map<string, string>();
  for (const link of links) {
    const kind = classify(link);
    if (kind && !byKind.has(kind)) byKind.set(kind, link);
    if (byKind.size >= MAX_PAGES_PER_COMPETITOR - 1) break;
  }
  return [...byKind.entries()].map(([kind, url]) => ({ url, kind }));
}

export interface ResearchInput {
  competitor: DetectedCompetitor;
  externalSources: string[]; // citation URLs for this competitor from AI answers
  snapshot: ShopSnapshot;
}

export async function researchCompetitor(input: ResearchInput): Promise<CompetitorResearch> {
  const { competitor, externalSources, snapshot } = input;
  const domain = competitor.domain;

  const base: CompetitorResearch = {
    name: competitor.name,
    domain,
    resolved: !!domain,
    mentionCount: competitor.mentionCount,
    avgPosition: competitor.avgPosition,
    engines: competitor.engines,
    researchedPages: [],
    schemaAudit: { product: false, offer: false, aggregateRating: false, review: false, faqPage: false },
    contentPatterns: { hasFaqContent: false, hasBuyerGuide: false, hasComparisonPage: false, hasReviewSignals: false, recurringHeadings: [] },
    externalSources: externalSources.slice(0, 10),
    comparisonToShop: {},
  };

  if (!domain) return base; // unresolved → skip crawling, keep what we know

  // Domain cache: reuse recent research (any tenant) for this domain.
  const cacheCutoff = new Date(Date.now() - RESEARCH_CACHE_DAYS * 24 * 60 * 60 * 1000);
  const cached = await prisma.deepScanCompetitorResearch
    .findFirst({ where: { competitorDomain: domain, createdAt: { gte: cacheCutoff } }, orderBy: { createdAt: "desc" } })
    .catch(() => null);
  if (cached?.researchedPages) {
    return {
      ...base,
      researchedPages: cached.researchedPages as unknown as ResearchedPage[],
      schemaAudit: (cached.schemaAudit as unknown as CompetitorResearch["schemaAudit"]) ?? base.schemaAudit,
      contentPatterns: (cached.contentPatterns as unknown as CompetitorResearch["contentPatterns"]) ?? base.contentPatterns,
      comparisonToShop: buildComparison(
        (cached.schemaAudit as unknown as CompetitorResearch["schemaAudit"]) ?? base.schemaAudit,
        (cached.contentPatterns as unknown as CompetitorResearch["contentPatterns"]) ?? base.contentPatterns,
        snapshot,
      ),
    };
  }

  const homeUrl = `https://${domain}`;
  const homeHtml = await fetchHtml(homeUrl);
  const pages: ResearchedPage[] = [];
  if (homeHtml) {
    const headings = extractHeadings(homeHtml);
    const schema = auditSchemaHtml(homeHtml);
    const { hasMetaDescription } = auditHomepageHtml(homeHtml);
    pages.push({
      url: homeUrl,
      kind: "homepage",
      title: extractTitle(homeHtml),
      metaDescription: hasMetaDescription,
      headings,
      schemaTypes: schema.found,
      faqQuestions: extractFaqQuestions(homeHtml, headings),
      ok: true,
    });
    for (const { url, kind } of pickPages(homeHtml, domain)) {
      if (pages.length >= MAX_PAGES_PER_COMPETITOR) break;
      pages.push(await inspectPage(url, kind));
    }
  } else {
    pages.push({ url: homeUrl, kind: "homepage", title: null, metaDescription: false, headings: [], schemaTypes: [], faqQuestions: [], ok: false });
  }

  const allTypes = new Set(pages.flatMap((p) => p.schemaTypes.map((t) => t.toLowerCase())));
  const schemaAudit = {
    product: allTypes.has("product"),
    offer: allTypes.has("offer"),
    aggregateRating: allTypes.has("aggregaterating"),
    review: allTypes.has("review"),
    faqPage: allTypes.has("faqpage"),
  };
  const headingBlob = pages.flatMap((p) => p.headings).join(" ").toLowerCase();
  const contentPatterns = {
    hasFaqContent: schemaAudit.faqPage || pages.some((p) => p.faqQuestions.length > 0),
    hasBuyerGuide: pages.some((p) => p.kind === "guide") || /guide|how to|buying/.test(headingBlob),
    hasComparisonPage: pages.some((p) => /compare|vs |versus/.test(p.url.toLowerCase())) || /\bvs\b|compare/.test(headingBlob),
    hasReviewSignals: schemaAudit.review || schemaAudit.aggregateRating || /review|rating|testimonial/.test(headingBlob),
    recurringHeadings: [...new Set(pages.flatMap((p) => p.headings))].slice(0, 8),
  };

  return {
    ...base,
    researchedPages: pages,
    schemaAudit,
    contentPatterns,
    comparisonToShop: buildComparison(schemaAudit, contentPatterns, snapshot),
  };
}

function buildComparison(
  schemaAudit: CompetitorResearch["schemaAudit"],
  patterns: CompetitorResearch["contentPatterns"],
  snapshot: ShopSnapshot,
): CompetitorResearch["comparisonToShop"] {
  const s = snapshot.signals;
  const shopSchema = new Set(s.schemaFound.map((t) => t.toLowerCase()));
  return {
    productSchema: { shop: shopSchema.has("product"), competitor: schemaAudit.product },
    reviewSchema: { shop: shopSchema.has("review") || shopSchema.has("aggregaterating"), competitor: schemaAudit.review || schemaAudit.aggregateRating },
    faqSchema: { shop: s.hasFaqSchema, competitor: schemaAudit.faqPage },
    faqContent: { shop: s.hasFaqSchema, competitor: patterns.hasFaqContent },
    buyerGuide: { shop: false, competitor: patterns.hasBuyerGuide },
    comparisonPage: { shop: false, competitor: patterns.hasComparisonPage },
    reviewSignals: { shop: shopSchema.has("review"), competitor: patterns.hasReviewSignals },
    metaDescription: { shop: s.metaDescription, competitor: true },
  };
}
