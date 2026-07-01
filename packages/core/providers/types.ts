// Unified provider abstraction. Every LLM answer-engine sits behind the same
// `query(prompt, opts) -> { text, citations[] }` signature so callers (the job
// queue, the run-batch aggregator) never branch on which provider they hit.

export type Provider = "OPENAI" | "ANTHROPIC" | "GEMINI" | "PERPLEXITY";

export interface Citation {
  url: string;
  title?: string;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ProviderQueryResult {
  /** The grounded, search-backed answer text. */
  text: string;
  /** Normalized sources the answer attributes to, across all providers. */
  citations: Citation[];
  /** Concrete model id that produced this answer (IDs drift — we persist it). */
  modelId: string;
  usage?: ProviderUsage;
  /** Raw provider payload, for debugging / re-analysis. Not persisted verbatim long-term. */
  raw?: unknown;
}

export interface QueryOptions {
  /** BCP-47 language tag, e.g. "en-US", "de-DE". */
  locale?: string;
  /** ISO-3166 country, e.g. "US", "DE" — used for geo-relevant grounding where supported. */
  country?: string;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  /** The answer-model id this adapter is configured to use. */
  readonly modelId: string;
  /** True when the required API key is present. Adapters without a key run in mock mode. */
  isConfigured(): boolean;
  /** Issue ONE grounded query. N-fold repetition + aggregation happens a layer up. */
  query(prompt: string, opts?: QueryOptions): Promise<ProviderQueryResult>;
}

/** Thrown when a provider call fails in a way the caller should record as a failed Run. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: Provider,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
