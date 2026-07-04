// CENTRAL MODEL CONFIG.
// Provider model IDs drift frequently — this is the ONE place to update them.
// `answer` = the expensive, search-grounded model that produces the answer we measure.
// `analysis` = the cheap model that evaluates the answer (mention/sentiment/position).
//
// Verified against provider docs (June 2026). Re-check before each release:
//   Perplexity: https://docs.perplexity.ai/api-reference/chat-completions-post
//   OpenAI:     https://platform.openai.com/docs/guides/tools-web-search
//   Gemini:     https://ai.google.dev/gemini-api/docs/google-search
//   Anthropic:  web_search tool type "web_search_20260209"
//
// Each is overridable via env so you can bump a model without a code deploy.
import type { Provider } from "./types";

const env = (k: string, fallback: string) => process.env[k]?.trim() || fallback;

export interface ProviderModelConfig {
  /** Grounded answer model. */
  answer: string;
  /** Provider-specific knobs (tool version, base url, etc.). */
  extra?: Record<string, string>;
}

export const PROVIDER_MODELS: Record<Provider, ProviderModelConfig> = {
  ANTHROPIC: {
    answer: env("ANTHROPIC_ANSWER_MODEL", "claude-sonnet-4-6"),
    extra: { webSearchToolType: "web_search_20260209" },
  },
  OPENAI: {
    // Responses API + web_search tool. Verify current GA model id before release.
    answer: env("OPENAI_ANSWER_MODEL", "gpt-4.1"),
  },
  GEMINI: {
    // generateContent + google_search grounding. "gemini-3.5-flash" also available.
    answer: env("GEMINI_ANSWER_MODEL", "gemini-2.5-flash"),
    extra: { apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  },
  PERPLEXITY: {
    // OpenAI-compatible. Tiers: sonar | sonar-pro | sonar-reasoning | sonar-deep-research.
    answer: env("PERPLEXITY_ANSWER_MODEL", "sonar"),
    extra: { apiBase: "https://api.perplexity.ai" },
  },
};

/** Cheap model for the hybrid analysis step (sentiment + fuzzy mention detection). */
export const ANALYSIS_MODEL = env("ANALYSIS_MODEL", "claude-haiku-4-5");

/**
 * Cheap OpenAI model for analysis + generation (sentiment, product copy, deep
 * report). Kept on OpenAI so the whole product runs on a single OPENAI_API_KEY.
 */
export const OPENAI_ANALYSIS_MODEL = env("OPENAI_ANALYSIS_MODEL", "gpt-4o-mini");

/** Default repetitions per (prompt × model × scheduled run). Non-determinism → aggregate. */
export const DEFAULT_REPETITIONS = Number(env("QUERY_REPETITIONS", "3"));

/** Hard per-query timeout. A hung provider must never stall the worker. */
export const QUERY_TIMEOUT_MS = Number(env("QUERY_TIMEOUT_MS", "60000"));

/** System instruction that makes the answer resemble a consumer asking the assistant. */
export const ANSWER_SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question directly and " +
  "concisely using current web information. Recommend specific brands and " +
  "products where relevant, as you naturally would.";
