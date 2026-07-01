// Hybrid answer analysis.
//   String matching (free, deterministic): brand/competitor detection, position,
//     prominence, own-domain citation detection.
//   ONE cheap LLM call (claude-haiku-4-5): sentiment + fuzzy mention recovery
//     (typos / paraphrased brand names string matching misses).
// The expensive grounded model is NEVER used here — that's the cost lever.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYSIS_MODEL } from "../providers/config";
import type { Citation } from "../providers/types";

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED" | "UNKNOWN";

export interface BrandSpec {
  name: string;
  aliases?: string[];
}

export interface CompetitorMention {
  name: string;
  mentioned: boolean;
  position: number | null;
}

export interface AnalysisInput {
  text: string;
  citations: Citation[];
  brand: BrandSpec;
  competitors: BrandSpec[];
  /** Shop's own domain(s), for own-vs-third-party citation detection. */
  ownDomains?: string[];
}

export interface AnalysisResult {
  brandMentioned: boolean;
  position: number | null; // 1-based rank of brand among all recognized mentions
  prominence: number | null; // 0..1, earlier = higher
  sentiment: Sentiment;
  citedUrl: string | null;
  citedOwnDomain: boolean;
  competitorMentions: CompetitorMention[];
}

// --- string matching ----------------------------------------------------

function firstIndex(haystack: string, spec: BrandSpec): number {
  const terms = [spec.name, ...(spec.aliases ?? [])].filter(Boolean);
  let best = -1;
  for (const t of terms) {
    const re = new RegExp(`\\b${escapeRe(t)}\\b`, "i");
    const m = re.exec(haystack);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// --- cheap LLM step ------------------------------------------------------

const SENTIMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentiment: { type: "string", enum: ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED"] },
    brandMentioned: { type: "boolean" },
  },
  required: ["sentiment", "brandMentioned"],
} as const;

async function llmSentiment(
  text: string,
  brand: BrandSpec,
): Promise<{ sentiment: Sentiment; brandMentioned: boolean } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null; // no key → skip, string-match only
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 256,
      system:
        "You analyze how a brand is portrayed in an AI assistant's answer. " +
        "Return strict JSON. brandMentioned=true if the brand (or a close " +
        "variant/typo) appears at all. sentiment is how the brand is portrayed.",
      messages: [
        {
          role: "user",
          content:
            `Brand: ${brand.name}${brand.aliases?.length ? ` (aliases: ${brand.aliases.join(", ")})` : ""}\n\n` +
            `Answer:\n"""${text.slice(0, 6000)}"""`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: SENTIMENT_SCHEMA } },
    });
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!block) return null;
    const parsed = JSON.parse(block.text) as { sentiment: Sentiment; brandMentioned: boolean };
    return parsed;
  } catch {
    return null; // analysis must never crash a run; fall back to string match
  }
}

// --- public API ----------------------------------------------------------

export async function analyzeAnswer(input: AnalysisInput): Promise<AnalysisResult> {
  const { text, citations, brand, competitors, ownDomains = [] } = input;

  const brandIdx = firstIndex(text, brand);
  const compIdx = competitors.map((c) => ({ c, idx: firstIndex(text, c) }));

  // Rank all recognized mentions by appearance order to derive brand position.
  const ordered = [
    { name: brand.name, idx: brandIdx, isBrand: true },
    ...compIdx.map(({ c, idx }) => ({ name: c.name, idx, isBrand: false })),
  ]
    .filter((m) => m.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const brandRank = ordered.findIndex((m) => m.isBrand);
  const position = brandRank >= 0 ? brandRank + 1 : null;
  const prominence = brandIdx >= 0 && text.length > 0 ? 1 - brandIdx / text.length : null;

  // Citations: own vs third-party.
  const ownSet = new Set(ownDomains.map((d) => d.replace(/^www\./, "").toLowerCase()));
  let citedUrl: string | null = null;
  let citedOwnDomain = false;
  for (const c of citations) {
    const host = hostname(c.url);
    if (!host) continue;
    const isOwn = [...ownSet].some((d) => host === d || host.endsWith(`.${d}`));
    if (isOwn) {
      citedOwnDomain = true;
      citedUrl = c.url;
      break;
    }
    if (!citedUrl) citedUrl = c.url;
  }

  const llm = await llmSentiment(text, brand);

  return {
    brandMentioned: brandIdx >= 0 || llm?.brandMentioned === true,
    position,
    prominence,
    sentiment: llm?.sentiment ?? "UNKNOWN",
    citedUrl,
    citedOwnDomain,
    competitorMentions: compIdx.map(({ c, idx }) => ({
      name: c.name,
      mentioned: idx >= 0,
      position: idx >= 0 ? idx : null,
    })),
  };
}
