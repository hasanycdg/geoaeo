// GAP_ANALYSIS phase. PURE, rules-based comparison of the shop snapshot vs the
// researched top-2 competitors. No causal claims — wording stays correlational:
// "signals that are missing from this shop and appear among brands AI engines
// mention". Testable (no IO).
import type { ShopSnapshot, CompetitorResearch, GapFinding } from "./types";

export function analyzeGaps(snapshot: ShopSnapshot, research: CompetitorResearch[]): GapFinding[] {
  const findings: GapFinding[] = [];
  const s = snapshot.signals;
  const resolved = research.filter((r) => r.resolved);
  const names = resolved.map((r) => r.name);

  // How many researched competitors expose a given signal.
  const withFaq = resolved.filter((r) => r.contentPatterns.hasFaqContent);
  const withReview = resolved.filter((r) => r.contentPatterns.hasReviewSignals || r.schemaAudit.review || r.schemaAudit.aggregateRating);
  const withGuide = resolved.filter((r) => r.contentPatterns.hasBuyerGuide);
  const withComparison = resolved.filter((r) => r.contentPatterns.hasComparisonPage);
  const withProductSchema = resolved.filter((r) => r.schemaAudit.product);

  const compEvidence = (list: CompetitorResearch[], label: string) => list.map((r) => `${r.name} ${label}`);

  // FAQ content / schema
  if (!s.hasFaqSchema && withFaq.length > 0) {
    findings.push({
      title: "Missing FAQ content on product pages",
      category: "content",
      severity: "high",
      impact: "high",
      effort: "low",
      evidence: {
        shop: "No FAQPage schema/FAQ content detected on sampled pages.",
        competitors: compEvidence(withFaq, "exposes FAQ content/FAQPage schema"),
      },
      recommendation: "Add 4–6 buyer-focused FAQ questions to top product pages and expose them as FAQPage schema.",
      auto_fix_possible: true,
    });
  }

  // Product/Offer/Rating/Review structured data
  if (s.schemaMissingImportant.length > 0) {
    findings.push({
      title: `Missing product structured data: ${s.schemaMissingImportant.join(", ")}`,
      category: "structured_data",
      severity: withProductSchema.length ? "high" : "medium",
      impact: "high",
      effort: "medium",
      evidence: {
        shop: `Product page missing JSON-LD for ${s.schemaMissingImportant.join(", ")}.`,
        competitors: withProductSchema.length ? compEvidence(withProductSchema, "exposes Product/Offer schema") : ["Common among brands AI engines cite."],
      },
      recommendation: "Add Product, Offer, AggregateRating and Review JSON-LD via your theme or a structured-data app.",
      auto_fix_possible: true,
    });
  }

  // Review / trust signals
  if (!(s.schemaFound.map((t) => t.toLowerCase()).includes("review")) && withReview.length > 0) {
    findings.push({
      title: "Weak review / trust signals",
      category: "trust",
      severity: "medium",
      impact: "high",
      effort: "medium",
      evidence: { shop: "No review/rating schema detected.", competitors: compEvidence(withReview, "shows review/rating signals") },
      recommendation: "Collect product reviews and expose AggregateRating + Review schema on product pages.",
      auto_fix_possible: false,
    });
  }

  // Buyer guide / educational content
  if (withGuide.length > 0) {
    findings.push({
      title: "No buyer-guide / educational content",
      category: "buyer_intent_content",
      severity: "medium",
      impact: "medium",
      effort: "medium",
      evidence: { shop: "No buyer guide/blog content detected on sampled pages.", competitors: compEvidence(withGuide, "publishes buyer-guide/educational content") },
      recommendation: "Publish 1–2 buyer guides targeting the questions AI engines answer for your category.",
      auto_fix_possible: false,
    });
  }

  // Comparison content
  if (withComparison.length > 0) {
    findings.push({
      title: "No comparison content",
      category: "comparison_content",
      severity: "medium",
      impact: "medium",
      effort: "medium",
      evidence: { shop: "No comparison pages detected.", competitors: compEvidence(withComparison, "has comparison/versus content") },
      recommendation: `Create an honest comparison page vs ${names[0] ?? "a key competitor"} covering price, use-case and differentiators.`,
      auto_fix_possible: false,
    });
  }

  // Technical AI-readiness
  if (s.blockedAiCrawlers.length > 0) {
    findings.push({
      title: `${s.blockedAiCrawlers.length} AI crawler(s) blocked`,
      category: "technical",
      severity: "high",
      impact: "high",
      effort: "low",
      evidence: { shop: `robots.txt blocks: ${s.blockedAiCrawlers.join(", ")}.`, competitors: ["Cited brands are crawlable by AI engines."] },
      recommendation: "Allow AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, …) in robots.txt.",
      auto_fix_possible: true,
    });
  }
  if (!s.llmsTxt) {
    findings.push({
      title: "No llms.txt published",
      category: "technical",
      severity: "medium",
      impact: "medium",
      effort: "low",
      evidence: { shop: "No llms.txt generated/served.", competitors: ["A machine-readable catalog map helps AI engines read your store."] },
      recommendation: "Generate llms.txt in the AI content tab so assistants can read your catalog directly.",
      auto_fix_possible: true,
    });
  }
  if (!s.sitemap) {
    findings.push({
      title: "sitemap.xml not reachable",
      category: "technical",
      severity: "medium",
      impact: "medium",
      effort: "low",
      evidence: { shop: "sitemap.xml not reachable.", competitors: ["Sitemaps help crawlers discover all products."] },
      recommendation: "Ensure /sitemap.xml is reachable and not blocked.",
      auto_fix_possible: false,
    });
  }
  if (!s.metaDescription) {
    findings.push({
      title: "Homepage missing meta description",
      category: "technical",
      severity: "low",
      impact: "medium",
      effort: "low",
      evidence: { shop: "No meta description on homepage.", competitors: [] },
      recommendation: "Add a concise, benefit-led meta description in your theme SEO settings.",
      auto_fix_possible: true,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
