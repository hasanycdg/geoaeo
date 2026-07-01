// Mock results for adapters without an API key. Lets the whole pipeline
// (queue → aggregation → dashboard) run end-to-end before keys are added.
// Mock answers vary by call so aggregation/non-determinism logic is exercised.
import type { Citation, Provider, ProviderQueryResult } from "./types";

const SAMPLE_BRANDS = ["NorthPeak", "VeganVit", "PureForm", "GreenLabel", "EverFit"];

export function mockResult(
  provider: Provider,
  prompt: string,
  modelId: string,
  seed = 0,
): ProviderQueryResult {
  // Pseudo-random but deterministic per (prompt, seed) so tests are stable.
  const h = [...`${prompt}:${seed}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const picks = SAMPLE_BRANDS.filter((_, i) => ((h >> i) & 1) === 1);
  const text =
    `For "${prompt}", popular options include ${picks.join(", ") || "several brands"}. ` +
    `These are frequently recommended based on current reviews. [MOCK ${provider}]`;
  const citations: Citation[] = picks.map((b) => ({
    url: `https://example.com/${b.toLowerCase()}`,
    title: `${b} review`,
  }));
  return { text, citations, modelId: `${modelId} (mock)`, usage: {}, raw: { mock: true } };
}
