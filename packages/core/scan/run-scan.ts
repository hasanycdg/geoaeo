// One "scan" = query a single provider N times for one prompt, analyze each
// answer, and aggregate. Non-determinism is the whole reason for N>1: we report
// a mention RATE over repetitions, never a single run as absolute truth.
// Pure orchestration — no DB. The job worker (Step 4) persists Run/Result rows.
import { randomUUID } from "node:crypto";
import { getAdapter } from "../providers";
import type { Provider, ProviderAdapter, Citation } from "../providers/types";
import { ProviderError } from "../providers/types";
import { analyzeAnswer, type AnalysisResult, type BrandSpec, type Sentiment } from "../analysis/analyze";
import { DEFAULT_REPETITIONS, QUERY_TIMEOUT_MS } from "../providers/config";

export interface ScanRequest {
  provider: Provider;
  prompt: string;
  brand: BrandSpec;
  competitors: BrandSpec[];
  ownDomains?: string[];
  locale?: string;
  country?: string;
  repetitions?: number;
  signal?: AbortSignal;
}

export interface SingleRun {
  runIndex: number;
  modelId: string;
  text: string;
  citations: Citation[];
  promptTokens?: number;
  completionTokens?: number;
  analysis?: AnalysisResult;
  error?: string;
}

export interface ScanResult {
  provider: Provider;
  modelId: string;
  batchId: string;
  repetitions: number;
  successfulRuns: number;
  /** Fraction of successful runs in which the brand appeared (0..1). */
  mentionRate: number;
  avgPosition: number | null;
  avgProminence: number | null;
  sentiment: Sentiment; // majority sentiment across runs
  /** Mention counts across runs — UI derives share-of-model percentages. */
  shareOfModel: { brandMentions: number; competitorMentions: Record<string, number> };
  /** Competitors mentioned where the brand was NOT — the "gap" list. */
  gaps: string[];
  runs: SingleRun[];
}

export async function runScan(req: ScanRequest): Promise<ScanResult> {
  const adapter: ProviderAdapter = getAdapter(req.provider);
  const repetitions = req.repetitions ?? DEFAULT_REPETITIONS;
  const batchId = randomUUID();
  const runs: SingleRun[] = [];

  // Sequential within a batch keeps us gentle on provider rate limits; the job
  // queue throttles across batches.
  for (let i = 0; i < repetitions; i++) {
    try {
      // Always bound each query with a timeout; honor an external cancel too.
      const timeout = AbortSignal.timeout(QUERY_TIMEOUT_MS);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      const res = await adapter.query(req.prompt, {
        locale: req.locale,
        country: req.country,
        signal,
      });
      const analysis = await analyzeAnswer({
        text: res.text,
        citations: res.citations,
        brand: req.brand,
        competitors: req.competitors,
        ownDomains: req.ownDomains,
      });
      runs.push({
        runIndex: i,
        modelId: res.modelId,
        text: res.text,
        citations: res.citations,
        promptTokens: res.usage?.promptTokens,
        completionTokens: res.usage?.completionTokens,
        analysis,
      });
    } catch (err) {
      runs.push({
        runIndex: i,
        modelId: adapter.modelId,
        text: "",
        citations: [],
        error: err instanceof ProviderError ? err.message : String(err),
      });
    }
  }

  return aggregate(req, adapter, batchId, repetitions, runs);
}

function aggregate(
  req: ScanRequest,
  adapter: ProviderAdapter,
  batchId: string,
  repetitions: number,
  runs: SingleRun[],
): ScanResult {
  const ok = runs.filter((r) => !r.error && r.analysis);
  const mentions = ok.filter((r) => r.analysis!.brandMentioned);

  const positions = mentions.map((r) => r.analysis!.position).filter((p): p is number => p != null);
  const prominences = ok.map((r) => r.analysis!.prominence).filter((p): p is number => p != null);

  // Majority sentiment (ignoring UNKNOWN unless that's all we have).
  const sentCounts = new Map<Sentiment, number>();
  for (const r of mentions) {
    const s = r.analysis!.sentiment;
    if (s !== "UNKNOWN") sentCounts.set(s, (sentCounts.get(s) ?? 0) + 1);
  }
  const sentiment =
    [...sentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";

  // Share of model: count brand vs competitor mentions across all OK runs.
  const competitorMentions: Record<string, number> = {};
  for (const c of req.competitors) competitorMentions[c.name] = 0;
  for (const r of ok) {
    for (const cm of r.analysis!.competitorMentions) {
      if (cm.mentioned) competitorMentions[cm.name] = (competitorMentions[cm.name] ?? 0) + 1;
    }
  }

  // Gaps: competitors that appeared in runs where the brand did not.
  const gapSet = new Set<string>();
  for (const r of ok) {
    if (r.analysis!.brandMentioned) continue;
    for (const cm of r.analysis!.competitorMentions) {
      if (cm.mentioned) gapSet.add(cm.name);
    }
  }

  return {
    provider: req.provider,
    modelId: adapter.modelId,
    batchId,
    repetitions,
    successfulRuns: ok.length,
    mentionRate: ok.length ? mentions.length / ok.length : 0,
    avgPosition: positions.length ? avg(positions) : null,
    avgProminence: prominences.length ? avg(prominences) : null,
    sentiment,
    shareOfModel: { brandMentions: mentions.length, competitorMentions },
    gaps: [...gapSet],
    runs,
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
