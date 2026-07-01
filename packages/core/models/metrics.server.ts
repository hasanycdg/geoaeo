// Read-time aggregation over the flat Run+Result model. At MVP volume
// (≤ a few hundred runs/shop/month) we fetch the window and aggregate in JS —
// simple and correct. Revisit with materialized rollups only if volume grows.
import { prisma } from "@geo/db";
import type { Provider } from "../providers/types";
import type { Sentiment } from "../analysis/analyze";

interface CompetitorMentionJson {
  name: string;
  mentioned: boolean;
  position: number | null;
}

export interface ProviderMetric {
  provider: Provider;
  totalRuns: number;
  mentionRate: number; // 0..1 over the window
  avgPosition: number | null;
  sentiment: Sentiment;
  /** Per-batch mention rate, oldest→newest, for a sparkline. */
  trend: number[];
}

export interface Dashboard {
  hasData: boolean;
  lastScanAt: Date | null;
  providers: ProviderMetric[];
  /** Brand vs competitor mention counts across the window. */
  shareOfModel: { brand: number; competitors: { name: string; count: number }[] };
  /** Competitors named in answers where the brand was absent. */
  gaps: { name: string; count: number }[];
}

export async function getDashboard(tenantId: string, windowDays = 90): Promise<Dashboard> {
  const gte = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const runs = await prisma.run.findMany({
    where: { tenantId, completedAt: { gte } },
    include: { result: true },
    orderBy: { completedAt: "asc" },
  });

  if (runs.length === 0) {
    return { hasData: false, lastScanAt: null, providers: [], shareOfModel: { brand: 0, competitors: [] }, gaps: [] };
  }

  const byProvider = new Map<Provider, typeof runs>();
  let lastScanAt: Date | null = null;
  for (const r of runs) {
    const p = r.provider as Provider;
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p)!.push(r);
    if (r.completedAt && (!lastScanAt || r.completedAt > lastScanAt)) lastScanAt = r.completedAt;
  }

  const providers: ProviderMetric[] = [];
  for (const [provider, prRuns] of byProvider) {
    const withResult = prRuns.filter((r) => r.result);
    const mentioned = withResult.filter((r) => r.result!.brandMentioned);
    const positions = mentioned
      .map((r) => r.result!.position)
      .filter((p): p is number => p != null);

    // Majority sentiment among mentions.
    const sent = new Map<Sentiment, number>();
    for (const r of mentioned) {
      const s = r.result!.sentiment as Sentiment;
      if (s !== "UNKNOWN") sent.set(s, (sent.get(s) ?? 0) + 1);
    }
    const sentiment = [...sent.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "UNKNOWN";

    // Per-batch mention rate trend.
    const byBatch = new Map<string, { m: number; t: number }>();
    for (const r of withResult) {
      const b = byBatch.get(r.batchId) ?? { m: 0, t: 0 };
      b.t++;
      if (r.result!.brandMentioned) b.m++;
      byBatch.set(r.batchId, b);
    }
    const trend = [...byBatch.values()].map((b) => (b.t ? b.m / b.t : 0));

    providers.push({
      provider,
      totalRuns: withResult.length,
      mentionRate: withResult.length ? mentioned.length / withResult.length : 0,
      avgPosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
      sentiment,
      trend,
    });
  }
  providers.sort((a, b) => a.provider.localeCompare(b.provider));

  // Share of model + gaps from the competitorMentions JSON.
  let brandCount = 0;
  const compCount = new Map<string, number>();
  const gapCount = new Map<string, number>();
  for (const r of runs) {
    if (!r.result) continue;
    const brandHere = r.result.brandMentioned;
    if (brandHere) brandCount++;
    const cms = (r.result.competitorMentions as unknown as CompetitorMentionJson[]) ?? [];
    for (const cm of cms) {
      if (!cm.mentioned) continue;
      compCount.set(cm.name, (compCount.get(cm.name) ?? 0) + 1);
      if (!brandHere) gapCount.set(cm.name, (gapCount.get(cm.name) ?? 0) + 1);
    }
  }

  return {
    hasData: true,
    lastScanAt,
    providers,
    shareOfModel: {
      brand: brandCount,
      competitors: [...compCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    },
    gaps: [...gapCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}
