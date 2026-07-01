// Google Gemini adapter — generateContent with Google Search grounding.
// Sources live in candidates[].groundingMetadata.groundingChunks[].web.{uri,title}.
// Uses plain fetch against the REST endpoint to avoid an extra SDK dependency.
import { PROVIDER_MODELS, ANSWER_SYSTEM_PROMPT } from "./config";
import { mockResult } from "./mock";
import {
  type Citation,
  type ProviderAdapter,
  type ProviderQueryResult,
  type QueryOptions,
  ProviderError,
} from "./types";

const cfg = PROVIDER_MODELS.GEMINI;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "GEMINI" as const;
  readonly modelId = cfg.answer;

  isConfigured() {
    return !!process.env.GEMINI_API_KEY;
  }

  async query(prompt: string, opts: QueryOptions = {}): Promise<ProviderQueryResult> {
    if (!this.isConfigured()) return mockResult(this.provider, prompt, this.modelId);

    const url =
      `${cfg.extra!.apiBase}/models/${this.modelId}:generateContent` +
      `?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: opts.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ANSWER_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: localize(prompt, opts) }] }],
          tools: [{ google_search: {} }],
        }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const data = (await resp.json()) as GeminiResponse;
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();

      return {
        text,
        citations: extractCitations(data),
        modelId: this.modelId,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount,
          completionTokens: data.usageMetadata?.candidatesTokenCount,
        },
        raw: data,
      };
    } catch (err) {
      throw new ProviderError("GEMINI", `Gemini query failed: ${msg(err)}`, err);
    }
  }
}

function extractCitations(data: GeminiResponse): Citation[] {
  const out = new Map<string, Citation>();
  for (const chunk of data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (uri && !out.has(uri)) out.set(uri, { url: uri, title: chunk.web?.title });
  }
  return [...out.values()];
}

function localize(prompt: string, opts: QueryOptions): string {
  if (!opts.locale && !opts.country) return prompt;
  const loc = [opts.locale, opts.country].filter(Boolean).join(" / ");
  return `${prompt}\n\n(Answer for a user in locale: ${loc}.)`;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
