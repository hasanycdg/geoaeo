// Central helper for the CHEAP analysis/generation LLM calls (sentiment,
// product copy, deep report). Runs on OpenAI so the whole product works with a
// single OPENAI_API_KEY — no separate Anthropic key needed.
//
// Uses Chat Completions with strict JSON-schema structured outputs, so callers
// get validated, parsed JSON back (or null on any failure — these calls must
// never crash a scan or a request).
import OpenAI from "openai";
import { OPENAI_ANALYSIS_MODEL } from "./config";

let client: OpenAI | undefined;

/** True when the analysis LLM has a key; callers fall back to string-match / templates otherwise. */
export function analysisConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface OpenAiJsonArgs {
  system: string;
  user: string;
  /** JSON schema for the structured output. Must be strict-mode compatible. */
  schema: Record<string, unknown>;
  /** Short a-zA-Z0-9_ name for the schema (required by the API). */
  schemaName: string;
  maxTokens?: number;
}

export async function openaiJson<T>(args: OpenAiJsonArgs): Promise<T | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    client ??= new OpenAI();
    const res = await client.chat.completions.create({
      model: OPENAI_ANALYSIS_MODEL,
      max_completion_tokens: args.maxTokens ?? 512,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      },
    });
    const text = res.choices[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null; // never crash the caller; degrade gracefully
  }
}
