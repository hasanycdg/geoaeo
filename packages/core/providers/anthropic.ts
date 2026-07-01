// Claude adapter — Messages API with the server-side web_search tool.
// The grounded answer comes back as text blocks; citations arrive as
// `web_search_result`/citation annotations on the content.
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_MODELS, ANSWER_SYSTEM_PROMPT } from "./config";
import { mockResult } from "./mock";
import {
  type Citation,
  type ProviderAdapter,
  type ProviderQueryResult,
  type QueryOptions,
  ProviderError,
} from "./types";

const cfg = PROVIDER_MODELS.ANTHROPIC;

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "ANTHROPIC" as const;
  readonly modelId = cfg.answer;
  private client?: Anthropic;

  isConfigured() {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private getClient() {
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  async query(prompt: string, opts: QueryOptions = {}): Promise<ProviderQueryResult> {
    if (!this.isConfigured()) return mockResult(this.provider, prompt, this.modelId);

    try {
      const res = await this.getClient().messages.create(
        {
          model: this.modelId,
          max_tokens: 2048,
          system: ANSWER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: localize(prompt, opts) }],
          tools: [{ type: cfg.extra!.webSearchToolType as "web_search_20260209", name: "web_search" }],
        },
        { signal: opts.signal },
      );

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      return {
        text,
        citations: extractCitations(res.content),
        modelId: res.model ?? this.modelId,
        usage: {
          promptTokens: res.usage?.input_tokens,
          completionTokens: res.usage?.output_tokens,
        },
        raw: res,
      };
    } catch (err) {
      throw new ProviderError("ANTHROPIC", `Claude query failed: ${msg(err)}`, err);
    }
  }
}

// Citations show up as `citations` arrays on text blocks (web_search_result_location).
function extractCitations(content: Anthropic.ContentBlock[]): Citation[] {
  const out = new Map<string, Citation>();
  for (const block of content) {
    const cites = (block as { citations?: Array<{ url?: string; title?: string }> }).citations;
    if (!Array.isArray(cites)) continue;
    for (const c of cites) {
      if (c.url && !out.has(c.url)) out.set(c.url, { url: c.url, title: c.title });
    }
  }
  return [...out.values()];
}

function localize(prompt: string, opts: QueryOptions): string {
  if (!opts.locale && !opts.country) return prompt;
  const loc = [opts.locale, opts.country].filter(Boolean).join(" / ");
  return `${prompt}\n\n(Answer for a user in locale: ${loc}.)`;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
