// RECOMMENDATION_GENERATION phase. Final synthesis: one LLM call turns the
// snapshot + gaps + competitor research + visibility summary into an executive
// summary, prioritized fixes and a 30-day plan. Falls back to a deterministic
// bundle (built from the rule-based gaps) when no LLM key is set.
import { openaiJson, analysisConfigured } from "../providers/analysis-llm.server";
import type { ShopSnapshot, GapFinding, CompetitorResearch, RecommendationBundle, Recommendation } from "./types";

export interface VisibilitySummary {
  overallMentionRate: number; // 0..1
  promptsScanned: number;
  answersCount: number;
  brandAbsentCompetitorPresent: number;
  failedEngines: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    executiveSummary: { type: "string" },
    visibilitySummary: { type: "string" },
    whyOutperforming: { type: "array", items: { type: "string" } },
    topMissingAssets: { type: "array", items: { type: "string" } },
    priorityFixes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          impact: { type: "string", enum: ["low", "medium", "high"] },
          effort: { type: "string", enum: ["low", "medium", "high"] },
          why_it_matters: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          auto_fix_available: { type: "boolean" },
        },
        required: ["title", "impact", "effort", "why_it_matters", "steps", "auto_fix_available"],
      },
    },
    actionPlan30Day: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          week: { type: "string" },
          focus: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
        },
        required: ["week", "focus", "actions"],
      },
    },
    contentIdeas: { type: "array", items: { type: "string" } },
  },
  required: ["executiveSummary", "visibilitySummary", "whyOutperforming", "topMissingAssets", "priorityFixes", "actionPlan30Day", "contentIdeas"],
} as const;

function fallback(
  snapshot: ShopSnapshot,
  gaps: GapFinding[],
  competitors: CompetitorResearch[],
  vis: VisibilitySummary,
): RecommendationBundle {
  const fixes: Recommendation[] = gaps.slice(0, 6).map((g) => ({
    title: g.recommendation,
    impact: g.impact,
    effort: g.effort,
    why_it_matters: `${g.title}. ${g.evidence.competitors[0] ?? ""}`.trim(),
    steps: [g.recommendation],
    auto_fix_available: g.auto_fix_possible,
  }));
  return {
    executiveSummary: `${snapshot.brandName} appears in ~${Math.round(vis.overallMentionRate * 100)}% of AI answers for ${vis.promptsScanned} buyer prompts. ${gaps.length} improvement areas found vs the top competitors.`,
    visibilitySummary: `${vis.answersCount} answers analyzed; brand absent while a competitor was present in ${vis.brandAbsentCompetitorPresent} answers.`,
    topCompetitors: competitors.map((c) => ({ name: c.name, domain: c.domain })),
    whyOutperforming: competitors.map((c) => `${c.name} shows signals (schema/FAQ/guides) missing from this shop.`),
    topMissingAssets: gaps.slice(0, 5).map((g) => g.title),
    priorityFixes: fixes,
    actionPlan30Day: [
      { week: "Week 1", focus: "Technical AI-readiness", actions: gaps.filter((g) => g.category === "technical").map((g) => g.recommendation) },
      { week: "Week 2", focus: "Structured data", actions: gaps.filter((g) => g.category === "structured_data").map((g) => g.recommendation) },
      { week: "Weeks 3–4", focus: "Content & trust", actions: gaps.filter((g) => ["content", "trust", "buyer_intent_content", "comparison_content"].includes(g.category)).map((g) => g.recommendation) },
    ],
    contentIdeas: gaps.filter((g) => g.category.includes("content")).map((g) => g.recommendation),
  };
}

export async function generateRecommendations(
  snapshot: ShopSnapshot,
  gaps: GapFinding[],
  competitors: CompetitorResearch[],
  vis: VisibilitySummary,
): Promise<RecommendationBundle> {
  if (!analysisConfigured()) return fallback(snapshot, gaps, competitors, vis);

  const user = [
    `Brand: ${snapshot.brandName} (${snapshot.primaryDomain})`,
    `Categories: ${snapshot.categories.join(", ")}`,
    `Visibility: mention rate ${Math.round(vis.overallMentionRate * 100)}% over ${vis.promptsScanned} prompts, ${vis.answersCount} answers; brand absent while a competitor present in ${vis.brandAbsentCompetitorPresent} answers.`,
    `Top competitors researched: ${competitors.map((c) => `${c.name} (${c.domain ?? "domain unknown"})`).join(", ") || "none"}`,
    `Competitor signals: ${competitors.map((c) => `${c.name}: FAQ=${c.contentPatterns.hasFaqContent}, guide=${c.contentPatterns.hasBuyerGuide}, comparison=${c.contentPatterns.hasComparisonPage}, review=${c.contentPatterns.hasReviewSignals}, productSchema=${c.schemaAudit.product}`).join(" | ")}`,
    `Gap findings (rule-based): ${gaps.map((g) => `${g.title} [${g.severity}]`).join("; ")}`,
    ``,
    `Write a concise, prioritized action report for THIS shop. Prioritize high-impact/low-effort fixes that are directly doable in Shopify/WordPress and tied to prompts where competitors appeared and the brand did not. ` +
      `Do NOT claim causality ("they win BECAUSE of X"); use correlational wording ("signals missing from this shop that appear among brands AI engines mention"). Return strict JSON only.`,
  ].join("\n");

  const res = await openaiJson<Omit<RecommendationBundle, "topCompetitors">>({
    schemaName: "deep_scan_recommendations",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2500,
    system: "You are a senior GEO strategist producing a prioritized, safe-worded action report. Return strict JSON only.",
    user,
  });

  if (!res) return fallback(snapshot, gaps, competitors, vis);
  return { ...res, topCompetitors: competitors.map((c) => ({ name: c.name, domain: c.domain })) };
}
