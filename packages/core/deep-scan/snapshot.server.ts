// SHOP_SNAPSHOT phase. Builds a COMPACT structured profile from existing
// platform data + the audit parsers. Never passes raw product descriptions to an
// LLM — summaries are truncated and the catalog is reduced to counts/titles.
import crypto from "node:crypto";
import type { Tenant } from "@geo/db";
import type { PlatformPort } from "../ports";
import { auditRobots } from "../audit/robots.server";
import { auditSchema } from "../audit/schema.server";
import { auditWeb } from "../audit/web.server";
import type { ShopSnapshot } from "./types";

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export async function buildShopSnapshot(
  platform: PlatformPort,
  tenant: Tenant,
  domain: string,
): Promise<ShopSnapshot> {
  const [profile, products] = await Promise.all([
    platform.getStoreProfile(tenant).catch(() => null),
    platform.listProducts(tenant).catch(() => []),
  ]);

  const brandName = tenant.brandName || profile?.name || domain;
  const firstProductUrl = products[0]?.url || `https://${domain}`;

  const [robots, web, schema] = await Promise.all([
    auditRobots(domain).catch(() => ({ reachable: false, blocked: [] as { bot: string }[] })),
    auditWeb(domain).catch(() => ({ reachable: false, hasMetaDescription: false, hasOpenGraph: false, sitemapReachable: false })),
    auditSchema(firstProductUrl).catch(() => ({ reachable: false, found: [] as string[], missingImportant: [] as string[] })),
  ]);

  // Category distribution (top by frequency).
  const catCount = new Map<string, number>();
  for (const p of products) if (p.productType) catCount.set(p.productType, (catCount.get(p.productType) ?? 0) + 1);
  const categories = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);

  const topProducts = products.slice(0, 12).map((p) => ({
    title: p.title,
    summary: stripHtml(p.description ?? "").slice(0, 160),
    productType: p.productType,
  }));

  const foundLc = new Set(schema.found.map((t) => t.toLowerCase()));

  const snapshot: Omit<ShopSnapshot, "contentHash"> = {
    brandName,
    aliases: tenant.brandAliases ?? [],
    primaryDomain: domain,
    productCount: products.length,
    categories,
    topProducts,
    signals: {
      schemaFound: schema.found,
      schemaMissingImportant: schema.missingImportant,
      hasFaqSchema: foundLc.has("faqpage"),
      llmsTxt: !!tenant.llmsTxt,
      sitemap: web.sitemapReachable,
      robotsReachable: robots.reachable,
      blockedAiCrawlers: robots.blocked.map((b) => b.bot),
      metaDescription: web.hasMetaDescription,
      openGraph: web.hasOpenGraph,
    },
  };

  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ brandName, domain, count: products.length, titles: topProducts.map((p) => p.title) }))
    .digest("hex")
    .slice(0, 16);

  return { ...snapshot, contentHash };
}
