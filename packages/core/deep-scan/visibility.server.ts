// AI_VISIBILITY_SCAN phase. Runs the selected prompts against the plan's engines
// (1 run per prompt per engine for cost control), reuses the existing provider
// adapters + analyzeAnswer, and extracts competitor brands with the rules-based
// parser (no extra LLM). Persists each answer for resumability. Resilient: a
// failing engine is recorded and the scan continues.
import { prisma } from "@geo/db";
import { getAdapter, type Provider } from "../providers";
import { QUERY_TIMEOUT_MS } from "../providers/config";
import { analyzeAnswer } from "../analysis/analyze";
import { extractBrandsFromAnswer } from "./brands";
import type { GeneratedPrompt, DeepScanAnswerData } from "./types";

export interface VisibilityInput {
  deepScanId: string;
  prompts: GeneratedPrompt[];
  brand: { name: string; aliases: string[] };
  ownDomains: string[];
  engines: Provider[];
}

export interface VisibilityResult {
  answers: DeepScanAnswerData[];
  failedEngines: string[];
  groundedCalls: number;
  analysisCalls: number;
}

export async function runVisibilityScan(input: VisibilityInput): Promise<VisibilityResult> {
  const { deepScanId, prompts, brand, ownDomains, engines } = input;
  const ownTerms = [brand.name, ...brand.aliases].filter(Boolean);
  const answers: DeepScanAnswerData[] = [];
  const failed = new Set<string>();
  let groundedCalls = 0;
  let analysisCalls = 0;

  for (const p of prompts) {
    const perEngine = await Promise.all(
      engines.map(async (engine): Promise<DeepScanAnswerData | null> => {
        try {
          const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
          const res = await getAdapter(engine).query(p.text, { signal: timeout });
          groundedCalls++;
          const analysis = await analyzeAnswer({
            text: res.text,
            citations: res.citations,
            brand: { name: brand.name, aliases: brand.aliases },
            competitors: [],
            ownDomains,
          });
          analysisCalls++;
          const detectedBrands = extractBrandsFromAnswer(res.text, res.citations, ownTerms, ownDomains);
          return {
            engine,
            prompt: p.text,
            promptIntent: p.intent,
            answerText: res.text,
            citations: res.citations,
            detectedBrands,
            ownBrandMentioned: analysis.brandMentioned,
            ownBrandPosition: analysis.position,
            sentiment: analysis.sentiment,
          };
        } catch (err) {
          failed.add(engine);
          console.error(`[deep-scan] engine ${engine} failed for "${p.text}": ${(err as Error).message}`);
          return null;
        }
      }),
    );
    answers.push(...perEngine.filter((a): a is DeepScanAnswerData => a !== null));
  }

  // Persist for resumability / the AI answers UI.
  if (answers.length) {
    await prisma.deepScanAnswer.createMany({
      data: answers.map((a) => ({
        deepScanId,
        prompt: a.prompt,
        promptIntent: a.promptIntent,
        engine: a.engine,
        answerText: a.answerText,
        citations: a.citations as unknown as object,
        detectedBrands: a.detectedBrands as unknown as object,
        ownBrandMentioned: a.ownBrandMentioned,
        ownBrandPosition: a.ownBrandPosition,
        sentiment: a.sentiment,
      })),
    });
  }

  return { answers, failedEngines: [...failed], groundedCalls, analysisCalls };
}
