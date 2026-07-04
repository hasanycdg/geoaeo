// Deep Analysis report — the "why am I (not) visible in AI answers, and what do
// I do about it" narrative. Grounds ONE OpenAI call in the tenant's REAL data:
// actual AI answers from the last scan, share-of-model vs competitors, the
// technical audit, and the product catalog (with descriptions). Produces a
// scored, prioritized, shop-specific plan: reasons, categorized recommendations,
// a 30/60/90 roadmap, a competitor deep-dive, per-product GEO rewrites, and
// ready-to-track buyer prompts. Platform-agnostic: the caller gathers the inputs.
import { openaiJson, analysisConfigured } from "../providers/analysis-llm.server";
import type { Dashboard } from "../models/metrics.server";

export interface DeepReportAudit {
  robotsBlocked: number;
  robotsReachable: boolean;
  schemaMissing: string[];
  schemaReachable: boolean;
}

export interface DeepReportProduct {
  title: string;
  productType: string | null;
  description: string;
}

export interface DeepReportInput {
  brandName: string;
  domain: string;
  plan: string;
  prompts: string[];
  competitors: string[];
  dashboard: Dashboard;
  /** Real answers from the last scan, so the model reasons over what AI actually said. */
  sampleAnswers: { prompt: string; provider: string; brandMentioned: boolean; answer: string }[];
  products: DeepReportProduct[];
  audit: DeepReportAudit | null;
}

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type RecCategory = "CONTENT" | "TECHNICAL" | "CATALOG" | "PROMPTS" | "OFFSITE";

export interface DeepRecommendation {
  title: string;
  rationale: string;
  category: RecCategory;
  impact: Priority;
  effort: Priority;
}

export interface RoadmapPhase {
  phase: string; // e.g. "Now (week 1)", "30 days", "60–90 days"
  goal: string;
  actions: string[];
}

export interface CompetitorAnalysis {
  name: string;
  whyTheyWin: string; // grounded in the real answers
  whatToLearn: string; // concrete takeaway for this store
}

export interface ProductAnalysis {
  product: string;
  issues: string[]; // GEO weaknesses in the current listing
  optimizedDescription: string; // ready-to-paste, conversational, AI-friendly
  faqs: { question: string; answer: string }[];
  schemaTip: string; // structured-data advice specific to this product
}

export interface DeepReport {
  visibilityScore: number; // 0..100
  verdict: string; // one line
  summary: string; // 2-4 sentence overview
  whyNotVisible: string[];
  strengths: string[];
  recommendations: DeepRecommendation[];
  roadmap: RoadmapPhase[];
  competitorAnalysis: CompetitorAnalysis[];
  productAnalysis: ProductAnalysis[];
  suggestedPrompts: string[];
  source: "llm" | "fallback";
  generatedAt: string;
}

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    visibilityScore: { type: "integer" },
    verdict: { type: "string" },
    summary: { type: "string" },
    whyNotVisible: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          category: { type: "string", enum: ["CONTENT", "TECHNICAL", "CATALOG", "PROMPTS", "OFFSITE"] },
          impact: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          effort: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        required: ["title", "rationale", "category", "impact", "effort"],
      },
    },
    roadmap: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phase: { type: "string" },
          goal: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
        },
        required: ["phase", "goal", "actions"],
      },
    },
    competitorAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          whyTheyWin: { type: "string" },
          whatToLearn: { type: "string" },
        },
        required: ["name", "whyTheyWin", "whatToLearn"],
      },
    },
    productAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product: { type: "string" },
          issues: { type: "array", items: { type: "string" } },
          optimizedDescription: { type: "string" },
          faqs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { question: { type: "string" }, answer: { type: "string" } },
              required: ["question", "answer"],
            },
          },
          schemaTip: { type: "string" },
        },
        required: ["product", "issues", "optimizedDescription", "faqs", "schemaTip"],
      },
    },
    suggestedPrompts: { type: "array", items: { type: "string" } },
  },
  required: [
    "visibilityScore",
    "verdict",
    "summary",
    "whyNotVisible",
    "strengths",
    "recommendations",
    "roadmap",
    "competitorAnalysis",
    "productAnalysis",
    "suggestedPrompts",
  ],
} as const;

function buildUserPrompt(input: DeepReportInput): string {
  const d = input.dashboard;
  const providerLines = d.providers.length
    ? d.providers
        .map(
          (p) =>
            `  - ${p.provider}: mention rate ${(p.mentionRate * 100).toFixed(0)}% over ${p.totalRuns} runs, ` +
            `avg position ${p.avgPosition?.toFixed(1) ?? "n/a"}, sentiment ${p.sentiment}`,
        )
        .join("\n")
    : "  (no scan data yet)";

  const share = d.shareOfModel;
  const shareLine = share.competitors.length
    ? `You: ${share.brand} mentions. Competitors: ${share.competitors
        .map((c) => `${c.name} (${c.count})`)
        .join(", ")}`
    : `You: ${share.brand} mentions. No competitor mentions recorded.`;

  const gaps = d.gaps.length ? d.gaps.map((g) => `${g.name} (${g.count}x)`).join(", ") : "none recorded";

  const answers = input.sampleAnswers.length
    ? input.sampleAnswers
        .slice(0, 6)
        .map(
          (a, i) =>
            `[${i + 1}] Prompt: "${a.prompt}" (${a.provider}, brand ${a.brandMentioned ? "MENTIONED" : "ABSENT"})\n` +
            `Answer: ${a.answer.slice(0, 900)}`,
        )
        .join("\n\n")
    : "(no answers captured yet — run a scan first)";

  const products = input.products.length
    ? input.products
        .slice(0, 15)
        .map(
          (p) =>
            `- ${p.title}${p.productType ? ` [${p.productType}]` : ""}: ` +
            `${p.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "(no description)"}`,
        )
        .join("\n")
    : "(no products read from the store)";

  const audit = input.audit
    ? `robots.txt reachable: ${input.audit.robotsReachable}, AI crawlers blocked: ${input.audit.robotsBlocked}. ` +
      `Product structured data reachable: ${input.audit.schemaReachable}, missing schema types: ${
        input.audit.schemaMissing.length ? input.audit.schemaMissing.join(", ") : "none"
      }.`
    : "(audit not run)";

  return [
    `BRAND: ${input.brandName}`,
    `STORE DOMAIN: ${input.domain}`,
    `PLAN: ${input.plan}`,
    `TRACKED PROMPTS (buyer questions we measure):\n${input.prompts.map((p) => `  - ${p}`).join("\n") || "  (none configured)"}`,
    `KNOWN COMPETITORS: ${input.competitors.join(", ") || "(none configured)"}`,
    ``,
    `VISIBILITY BY AI ENGINE:\n${providerLines}`,
    `SHARE OF MODEL: ${shareLine}`,
    `COMPETITORS WINNING WHERE YOU'RE ABSENT: ${gaps}`,
    ``,
    `TECHNICAL AI-READINESS AUDIT: ${audit}`,
    ``,
    `WHAT THE AI ACTUALLY ANSWERED (real samples from the last scan):\n${answers}`,
    ``,
    `PRODUCT CATALOG (title [type]: description):\n${products}`,
  ].join("\n");
}

const SYSTEM_PROMPT =
  "You are a world-class GEO (Generative Engine Optimization) strategist advising " +
  "an e-commerce merchant on why AI assistants (ChatGPT, Claude, Gemini, Perplexity) " +
  "do or don't recommend their store — and exactly what to do about it. You are given " +
  "REAL measurement data: per-engine mention rates, share-of-model vs competitors, a " +
  "technical audit, real AI answers to their tracked buyer questions, and their product " +
  "catalog with descriptions. Analyze it like a senior consultant delivering a premium report.\n\n" +
  "Produce ALL of the following, strictly grounded in the data (never invent metrics):\n" +
  "- visibilityScore (0-100, reflecting the REAL mention rates) + a sharp one-line verdict + a 2-4 sentence summary.\n" +
  "- whyNotVisible: the concrete, evidence-based reasons (quote what the AI actually said when relevant).\n" +
  "- strengths: what's already working (empty if nothing).\n" +
  "- recommendations: prioritized, each with a rationale tied to evidence, a category, and honest impact/effort.\n" +
  "- roadmap: a phased plan — 'Now (week 1)', '30 days', '60–90 days' — each with a goal and concrete action steps.\n" +
  "- competitorAnalysis: for the competitors that win in the answers, WHY they win (grounded in the real answers) and what THIS store should learn.\n" +
  "- productAnalysis: pick the 3-5 most important/representative products and, for each, give specific GEO issues, a ready-to-paste OPTIMIZED description (natural, conversational, answers real buyer questions — NOT keyword-stuffed), 2-3 FAQs, and a structured-data (schema.org) tip. Base it on the real product descriptions provided.\n" +
  "- suggestedPrompts: 5-8 realistic buyer questions (natural language, no brand name) that THIS store should track, derived from the catalog.\n\n" +
  "Be specific to THIS store and THIS data — never generic. If there is no scan data yet, say so plainly and focus on setup, technical readiness, product copy and prompts. Return strict JSON only.";

/** Deterministic fallback when no OpenAI key is set (keeps the feature usable in mock mode). */
function fallbackReport(input: DeepReportInput): DeepReport {
  const d = input.dashboard;
  const avgRate = d.providers.length ? d.providers.reduce((a, p) => a + p.mentionRate, 0) / d.providers.length : 0;
  const score = Math.round(avgRate * 100);
  const why: string[] = [];
  if (!d.hasData) why.push("No scan data yet — run a scan so we can measure where you appear.");
  if (input.audit && input.audit.robotsBlocked > 0)
    why.push(`${input.audit.robotsBlocked} AI crawler(s) are blocked in robots.txt — they can't read your store at all.`);
  if (input.audit && input.audit.schemaMissing.length)
    why.push(`Product pages are missing structured data: ${input.audit.schemaMissing.join(", ")}.`);
  if (d.gaps.length) why.push(`Competitors appear where you don't: ${d.gaps.map((g) => g.name).join(", ")}.`);
  if (why.length === 0) why.push("Add an OpenAI key for a full AI-written strategic analysis.");

  return {
    visibilityScore: score,
    verdict: d.hasData ? `Mentioned in ~${score}% of AI answers` : "Not measured yet",
    summary:
      "This is a data-only summary (no OpenAI key set). Add OPENAI_API_KEY for a full, " +
      "AI-written strategic report with catalog-specific recommendations.",
    whyNotVisible: why,
    strengths: d.shareOfModel.brand > 0 ? ["Your brand already appears in some AI answers."] : [],
    recommendations: [],
    roadmap: [],
    competitorAnalysis: [],
    productAnalysis: [],
    suggestedPrompts: [],
    source: "fallback",
    generatedAt: new Date().toISOString(),
  };
}

export async function generateDeepReport(input: DeepReportInput): Promise<DeepReport> {
  if (!analysisConfigured()) return fallbackReport(input);

  const parsed = await openaiJson<Omit<DeepReport, "source" | "generatedAt">>({
    schemaName: "geo_deep_report",
    schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 4500,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(input),
  });

  if (!parsed) return fallbackReport(input);
  return { ...parsed, source: "llm", generatedAt: new Date().toISOString() };
}
