// PROMPT_DISCOVERY phase. Generates buyer-intent prompts from the compact
// snapshot (one small LLM call), then dedupes and caps to MAX_PROMPTS. Falls back
// to deterministic templates when no LLM key is configured.
import { openaiJson, analysisConfigured } from "../providers/analysis-llm.server";
import type { ShopSnapshot, GeneratedPrompt } from "./types";
import { MAX_PROMPTS, MAX_CANDIDATE_PROMPTS } from "./types";

/** PURE: normalize, dedupe by text, sort by priority desc, cap to `max`. */
export function dedupeAndLimit(prompts: GeneratedPrompt[], max: number = MAX_PROMPTS): GeneratedPrompt[] {
  const seen = new Set<string>();
  const unique: GeneratedPrompt[] = [];
  for (const p of prompts) {
    const key = p.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...p, priority: Math.max(0, Math.min(100, Math.round(p.priority))) });
  }
  return unique.sort((a, b) => b.priority - a.priority).slice(0, max);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          intent: {
            type: "string",
            enum: ["best_for", "vs_alternatives", "affordable", "premium", "attribute", "problem_solution", "category_reco", "comparison", "which_to_choose"],
          },
          priority: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["text", "intent", "priority", "reason"],
      },
    },
  },
  required: ["prompts"],
} as const;

function templatePrompts(snap: ShopSnapshot): GeneratedPrompt[] {
  const cats = snap.categories.length ? snap.categories : ["products"];
  const out: GeneratedPrompt[] = [];
  for (const c of cats.slice(0, 6)) {
    out.push({ text: `best ${c} for beginners`, intent: "best_for", priority: 80, reason: `Core category: ${c}` });
    out.push({ text: `affordable ${c}`, intent: "affordable", priority: 60, reason: `Price-sensitive buyers for ${c}` });
    out.push({ text: `which ${c} should I choose`, intent: "which_to_choose", priority: 70, reason: `Decision-stage buyers for ${c}` });
    out.push({ text: `${c} vs alternatives`, intent: "comparison", priority: 55, reason: `Comparison intent for ${c}` });
  }
  return out;
}

export async function generateBuyerPrompts(snap: ShopSnapshot): Promise<GeneratedPrompt[]> {
  if (!analysisConfigured()) return dedupeAndLimit(templatePrompts(snap));

  const user = [
    `Brand: ${snap.brandName}`,
    `Domain: ${snap.primaryDomain}`,
    `Product categories: ${snap.categories.join(", ") || "(unknown)"}`,
    `Sample products: ${snap.topProducts.map((p) => p.title).slice(0, 12).join("; ")}`,
    ``,
    `Generate up to ${MAX_CANDIDATE_PROMPTS} realistic buyer-intent questions a shopper would ask an AI assistant ` +
      `(ChatGPT/Claude/Gemini/Perplexity) when researching this kind of store — NOT containing the brand name. ` +
      `Cover: best X for Y, X vs alternatives, affordable X, premium X, attribute (sustainable/organic/local/etc.) ` +
      `if relevant, problem→solution, category recommendation, comparison, and "which should I choose". ` +
      `priority 0-100 = how likely this question drives a purchase for this store.`,
  ].join("\n");

  const res = await openaiJson<{ prompts: GeneratedPrompt[] }>({
    schemaName: "buyer_prompts",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2000,
    system:
      "You are a GEO strategist generating buyer-intent search prompts for measuring a store's visibility in AI answers. Return strict JSON only.",
    user,
  });

  const candidates = res?.prompts?.length ? res.prompts : templatePrompts(snap);
  return dedupeAndLimit(candidates);
}
