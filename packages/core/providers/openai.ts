// OpenAI (ChatGPT) adapter — Responses API with the web_search tool.
// Citations come back as `url_citation` annotations on the output text.
import OpenAI from "openai";
import { PROVIDER_MODELS, ANSWER_SYSTEM_PROMPT } from "./config";
import { mockResult } from "./mock";
import {
  type Citation,
  type ProviderAdapter,
  type ProviderQueryResult,
  type QueryOptions,
  ProviderError,
} from "./types";

const cfg = PROVIDER_MODELS.OPENAI;

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "OPENAI" as const;
  readonly modelId = cfg.answer;
  private client?: OpenAI;

  isConfigured() {
    return !!process.env.OPENAI_API_KEY;
  }

  private getClient() {
    if (!this.client) this.client = new OpenAI();
    return this.client;
  }

  async query(prompt: string, opts: QueryOptions = {}): Promise<ProviderQueryResult> {
    if (!this.isConfigured()) return mockResult(this.provider, prompt, this.modelId);

    try {
      const res = await this.getClient().responses.create(
        {
          model: this.modelId,
          instructions: ANSWER_SYSTEM_PROMPT,
          input: localize(prompt, opts),
          tools: [{ type: "web_search" }],
        },
        { signal: opts.signal },
      );

      return {
        text: res.output_text?.trim() ?? "",
        citations: extractCitations(res),
        modelId: res.model ?? this.modelId,
        usage: {
          promptTokens: res.usage?.input_tokens,
          completionTokens: res.usage?.output_tokens,
        },
        raw: res,
      };
    } catch (err) {
      throw new ProviderError("OPENAI", `OpenAI query failed: ${msg(err)}`, err);
    }
  }
}

// Walk output messages → content → annotations of type "url_citation".
function extractCitations(res: { output?: unknown[] }): Citation[] {
  const out = new Map<string, Citation>();
  for (const item of (res.output ?? []) as Array<{ content?: unknown[] }>) {
    for (const c of (item.content ?? []) as Array<{ annotations?: unknown[] }>) {
      for (const a of (c.annotations ?? []) as Array<{
        type?: string;
        url?: string;
        title?: string;
      }>) {
        if (a.type === "url_citation" && a.url && !out.has(a.url)) {
          out.set(a.url, { url: a.url, title: a.title });
        }
      }
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
