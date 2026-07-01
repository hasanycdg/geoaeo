// Perplexity adapter — OpenAI-compatible chat completions with the `sonar`
// online models. Natively search-grounded; returns a top-level `citations`
// array (and a richer `search_results`). Closest to what end users see.
import { PROVIDER_MODELS, ANSWER_SYSTEM_PROMPT } from "./config";
import { mockResult } from "./mock";
import {
  type Citation,
  type ProviderAdapter,
  type ProviderQueryResult,
  type QueryOptions,
  ProviderError,
} from "./types";

const cfg = PROVIDER_MODELS.PERPLEXITY;

interface PerplexityResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: string[];
  search_results?: Array<{ url?: string; title?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

export class PerplexityAdapter implements ProviderAdapter {
  readonly provider = "PERPLEXITY" as const;
  readonly modelId = cfg.answer;

  isConfigured() {
    return !!process.env.PERPLEXITY_API_KEY;
  }

  async query(prompt: string, opts: QueryOptions = {}): Promise<ProviderQueryResult> {
    if (!this.isConfigured()) return mockResult(this.provider, prompt, this.modelId);

    try {
      const resp = await fetch(`${cfg.extra!.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        },
        signal: opts.signal,
        body: JSON.stringify({
          model: this.modelId,
          messages: [
            { role: "system", content: ANSWER_SYSTEM_PROMPT },
            { role: "user", content: localize(prompt, opts) },
          ],
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const data = (await resp.json()) as PerplexityResponse;

      return {
        text: (data.choices?.[0]?.message?.content ?? "").trim(),
        citations: extractCitations(data),
        modelId: data.model ?? this.modelId,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        },
        raw: data,
      };
    } catch (err) {
      throw new ProviderError("PERPLEXITY", `Perplexity query failed: ${msg(err)}`, err);
    }
  }
}

function extractCitations(data: PerplexityResponse): Citation[] {
  const out = new Map<string, Citation>();
  // Prefer the richer search_results (has titles); fall back to citations urls.
  for (const r of data.search_results ?? []) {
    if (r.url && !out.has(r.url)) out.set(r.url, { url: r.url, title: r.title });
  }
  for (const url of data.citations ?? []) {
    if (url && !out.has(url)) out.set(url, { url });
  }
  return [...out.values()];
}

function localize(prompt: string, opts: QueryOptions): string {
  if (!opts.locale && !opts.country) return prompt;
  const loc = [opts.locale, opts.country].filter(Boolean).join(" / ");
  return `${prompt}\n\n(Answer for a user in locale: ${loc}.)`;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
