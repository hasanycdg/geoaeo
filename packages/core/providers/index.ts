// Provider registry. Callers resolve an adapter by Provider enum and never
// import a concrete adapter directly.
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { GeminiAdapter } from "./gemini";
import { PerplexityAdapter } from "./perplexity";
import type { Provider, ProviderAdapter } from "./types";

const REGISTRY: Record<Provider, ProviderAdapter> = {
  ANTHROPIC: new AnthropicAdapter(),
  OPENAI: new OpenAIAdapter(),
  GEMINI: new GeminiAdapter(),
  PERPLEXITY: new PerplexityAdapter(),
};

export const ALL_PROVIDERS = Object.keys(REGISTRY) as Provider[];

export function getAdapter(provider: Provider): ProviderAdapter {
  return REGISTRY[provider];
}

export * from "./types";
