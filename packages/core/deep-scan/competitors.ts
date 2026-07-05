// Competitor detection scoring + top-2 selection. PURE (no IO) so it is unit
// tested. Aggregates detected brands across all Deep Scan answers and ranks by
// mention count, engine spread, prompt spread, citation presence and position.
import type { DeepScanAnswerData, DetectedCompetitor, CompetitorDetectionResult } from "./types";
import { TOP_COMPETITORS } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const tokenize = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

export function scoreCompetitors(
  answers: DeepScanAnswerData[],
  ownTerms: string[],
  shopCategories: string[] = [],
): DetectedCompetitor[] {
  const own = new Set(ownTerms.map(norm).filter(Boolean));
  const categoryTerms = new Set(shopCategories.flatMap(tokenize));

  interface Agg {
    name: string;
    domain: string | null;
    mentions: number;
    engines: Set<string>;
    prompts: Set<string>;
    relevantPrompts: Set<string>;
    positions: number[];
    hasCitations: boolean;
  }
  const map = new Map<string, Agg>();

  for (const a of answers) {
    const promptTokens = new Set(tokenize(a.prompt));
    const categoryRelevant = [...categoryTerms].some((token) => promptTokens.has(token));
    a.detectedBrands.forEach((b, idx) => {
      const key = norm(b.name);
      if (!key || own.has(key)) return;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          name: b.name,
          domain: b.domain,
          mentions: 0,
          engines: new Set(),
          prompts: new Set(),
          relevantPrompts: new Set(),
          positions: [],
          hasCitations: false,
        };
        map.set(key, agg);
      }
      agg.mentions++;
      agg.engines.add(a.engine);
      agg.prompts.add(a.prompt);
      if (categoryRelevant) agg.relevantPrompts.add(a.prompt);
      agg.positions.push(idx + 1); // rank by appearance order within the answer
      if (!agg.domain && b.domain) agg.domain = b.domain;
      if (b.domain) agg.hasCitations = true;
    });
  }

  const detected: DetectedCompetitor[] = [...map.values()].map((agg) => {
    const avgPosition = agg.positions.length ? agg.positions.reduce((x, y) => x + y, 0) / agg.positions.length : null;
    const positionBonus = avgPosition != null ? Math.max(0, 5 - avgPosition) : 0;
    const score =
      agg.mentions * 3 +
      agg.engines.size * 4 +
      agg.prompts.size * 2 +
      agg.relevantPrompts.size * 2.5 +
      (agg.hasCitations ? 3 : 0) +
      positionBonus;
    return {
      name: agg.name,
      domain: agg.domain,
      mentionCount: agg.mentions,
      avgPosition: avgPosition != null ? Number(avgPosition.toFixed(2)) : null,
      engines: [...agg.engines],
      promptCount: agg.prompts.size,
      relevantPromptCount: agg.relevantPrompts.size,
      hasCitations: agg.hasCitations,
      score: Number(score.toFixed(2)),
      selectedForResearch: false,
    };
  });

  detected.sort((a, b) => b.score - a.score || b.mentionCount - a.mentionCount);
  detected.forEach((c, i) => {
    c.selectedForResearch = i < TOP_COMPETITORS;
  });
  return detected;
}

export function selectTopCompetitors(detected: DetectedCompetitor[]): CompetitorDetectionResult {
  const selected = detected.filter((c) => c.selectedForResearch).slice(0, TOP_COMPETITORS);
  return {
    all_detected: detected,
    selected_top_competitors: selected.map((c) => ({ name: c.name, domain: c.domain })),
  };
}
