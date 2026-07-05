import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  Banner,
  List,
  Divider,
  ProgressBar,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";

const PHASES = [
  "SHOP_SNAPSHOT",
  "PROMPT_DISCOVERY",
  "AI_VISIBILITY_SCAN",
  "COMPETITOR_DETECTION",
  "COMPETITOR_RESEARCH",
  "GAP_ANALYSIS",
  "RECOMMENDATION_GENERATION",
  "COMPLETED",
];
const PHASE_LABEL: Record<string, string> = {
  SHOP_SNAPSHOT: "Shop snapshot",
  PROMPT_DISCOVERY: "Buyer prompts",
  AI_VISIBILITY_SCAN: "AI visibility scan",
  COMPETITOR_DETECTION: "Competitor detection",
  COMPETITOR_RESEARCH: "Competitor research",
  GAP_ANALYSIS: "Gap analysis",
  RECOMMENDATION_GENERATION: "Recommendations",
  COMPLETED: "Completed",
};

type Sev = "low" | "medium" | "high";
interface GapFinding {
  title: string; category: string; severity: Sev; impact: Sev; effort: Sev;
  evidence: { shop: string; competitors: string[] }; recommendation: string; auto_fix_possible: boolean;
}
interface Recommendation {
  title: string; impact: Sev; effort: Sev; why_it_matters: string; steps: string[]; auto_fix_available: boolean;
}
interface Bundle {
  executiveSummary: string; visibilitySummary: string;
  topCompetitors: { name: string; domain: string | null }[];
  whyOutperforming: string[]; topMissingAssets: string[];
  priorityFixes: Recommendation[];
  actionPlan30Day: { week: string; focus: string; actions: string[] }[];
  contentIdeas: string[];
}
interface DetectedCompetitor {
  name: string; domain: string | null; mentionCount: number; avgPosition: number | null;
  engines: string[]; selectedForResearch: boolean; relevantPromptCount: number;
}
interface ResearchRow {
  competitorName: string;
  competitorDomain: string | null;
  mentionCount: number;
  avgPosition: number | null;
  researchedPages: { url: string; kind: string; ok: boolean }[] | null;
  schemaAudit: { product: boolean; offer: boolean; aggregateRating: boolean; review: boolean; faqPage: boolean } | null;
  contentPatterns: { hasFaqContent: boolean; hasBuyerGuide: boolean; hasComparisonPage: boolean; hasReviewSignals: boolean } | null;
}
interface DeepScanListItem {
  id: string;
  status: string;
  currentPhase: string;
  createdAt: string;
  completedAt: string | null;
  creditCost: number;
  progress: { currentStep: number; totalSteps: number; percent: number };
}
interface AnswersSummary {
  totalAnswers: number;
  promptCount: number;
  expectedEngines: string[];
  failedEngines: string[];
  ownBrandMentionedAnswers: number;
  competitorPresentWithoutOwnBrand: number;
  avgOwnBrandPosition: number | null;
  visibilityScore: number;
}
interface DeepScan {
  id: string; status: string; currentPhase: string; creditCost: number;
  createdAt: string; completedAt: string | null; errorMessage: string | null;
  generatedPrompts: { text: string; intent: string }[] | null;
  detectedCompetitors: DetectedCompetitor[] | null;
  gapFindings: GapFinding[] | null;
  recommendations: Bundle | null;
  research: ResearchRow[] | null;
  costEstimate: { estimatedUsd: number; groundedCalls: number } | null;
  progress?: { currentStep: number; totalSteps: number; percent: number };
  _count?: { answers: number };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const list = await apiGet(session.shop, "/api/v1/deep-scans");
  const latestId = list.scans?.[0]?.id;
  const latestResp = latestId ? await apiGet(session.shop, `/api/v1/deep-scans/${latestId}`) : null;
  return json({
    scans: (list.scans ?? []) as DeepScanListItem[],
    remaining: (list.remaining ?? 0) as number,
    cost: (list.cost ?? 25) as number,
    plan: (list.plan ?? "FREE") as string,
    latest: (latestResp?.scan ?? null) as DeepScan | null,
    answersSummary: (latestResp?.answersSummary ?? null) as AnswersSummary | null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const res = await apiPost(session.shop, "/api/v1/deep-scans/run");
    return json({ ok: true, id: res.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/\{.*\}$/);
    let friendly = "Couldn't start Deep Scan.";
    if (m) {
      try { friendly = (JSON.parse(m[0]) as { message?: string }).message ?? friendly; } catch { /* keep default */ }
    }
    return json({ ok: false, error: friendly });
  }
};

const SEV_TONE: Record<Sev, "critical" | "warning" | "info"> = { high: "critical", medium: "warning", low: "info" };

export default function DeepScanPage() {
  const { scans, remaining, cost, plan, latest, answersSummary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== "idle";
  const running = latest && (latest.status === "RUNNING" || latest.status === "PENDING");

  // Poll while a scan is in progress.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(t);
  }, [running, revalidator]);

  // After a successful run, refresh to pick up the new scan.
  useEffect(() => {
    if (fetcher.data && "ok" in fetcher.data && fetcher.data.ok) revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  const rec = latest?.recommendations ?? null;
  const gaps = latest?.gapFindings ?? [];
  const detected = latest?.detectedCompetitors ?? [];
  const promptGroups = groupPrompts(latest?.generatedPrompts ?? []);
  const actionError =
    fetcher.data && "ok" in fetcher.data && !fetcher.data.ok && "error" in fetcher.data ? fetcher.data.error : null;
  const currentIdx = latest ? PHASES.indexOf(latest.currentPhase) : -1;
  const progressPct = latest?.progress?.percent ?? Math.max(5, (Math.max(0, currentIdx) / (PHASES.length - 1)) * 100);

  return (
    <Page>
      <TitleBar title="Deep Scan" />
      <BlockStack gap="500">
        {/* Intro / run */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Deep Scan</Text>
                  <Badge tone="magic">Premium</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  A deeper workflow: builds a shop snapshot, generates buyer prompts, runs an AI visibility scan,
                  detects competitors from the answers, researches the top 2, and produces gap findings + a fix plan.
                </Text>
              </BlockStack>
              <BlockStack gap="100" inlineAlign="end">
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={remaining < cost || !!running}
                  onClick={() => fetcher.submit({}, { method: "post" })}
                >
                  {running ? "Scan running…" : `Run Deep Scan (${cost} credits)`}
                </Button>
                <Text as="span" tone="subdued" variant="bodySm">{remaining} credits left · {plan} plan</Text>
              </BlockStack>
            </InlineStack>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
              <MiniStat label="Buyer prompts" value="up to 25" />
              <MiniStat label="AI engines" value="your plan's" />
              <MiniStat label="Competitors researched" value="top 2" />
              <MiniStat label="Pages / competitor" value="up to 5" />
            </InlineGrid>
          </BlockStack>
        </Card>

        {actionError && (
          <Banner tone="warning" title="Deep Scan unavailable">
            <Text as="p">{actionError}</Text>
          </Banner>
        )}

        {!latest && (
          <Card>
            <EmptyState heading="No Deep Scan yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Run your first Deep Scan to discover buyer prompts, detect competitors and get a prioritized fix plan.</p>
            </EmptyState>
          </Card>
        )}

        {scans.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">Recent Deep Scans</Text>
                <Text as="span" tone="subdued" variant="bodySm">{scans.length} total</Text>
              </InlineStack>
              {scans.slice(0, 5).map((scan) => (
                <BlockStack key={scan.id} gap="100">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={statusTone(scan.status)}>{scan.status.toLowerCase()}</Badge>
                      <Text as="span">{new Date(scan.createdAt).toLocaleString()}</Text>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {PHASE_LABEL[scan.currentPhase] ?? scan.currentPhase} · {scan.progress.percent}%
                    </Text>
                  </InlineStack>
                  <ProgressBar progress={scan.progress.percent} size="small" tone="primary" />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        )}

        {/* Progress */}
        {latest && latest.status !== "COMPLETED" && latest.status !== "FAILED" && (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Scan in progress</Text>
              <ProgressBar progress={progressPct} tone="primary" />
              <BlockStack gap="150">
                {PHASES.slice(0, -1).map((p, i) => (
                  <InlineStack key={p} gap="200" blockAlign="center">
                    <Badge tone={i < currentIdx ? "success" : i === currentIdx ? "attention" : undefined}>
                      {i < currentIdx ? "✓" : i === currentIdx ? "…" : String(i + 1)}
                    </Badge>
                    <Text as="span" tone={i <= currentIdx ? undefined : "subdued"}>{PHASE_LABEL[p]}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {latest?.status === "FAILED" && (
          <Banner tone="critical" title="Deep Scan failed">
            <Text as="p">{latest.errorMessage ?? "Unknown error."} (failed at {PHASE_LABEL[latest.currentPhase] ?? latest.currentPhase})</Text>
          </Banner>
        )}

        {/* Results */}
        {latest?.status === "COMPLETED" && rec && (
          <>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Executive summary</Text>
                  <Badge tone={answersSummary && answersSummary.visibilityScore >= 60 ? "success" : answersSummary && answersSummary.visibilityScore >= 30 ? "warning" : "critical"}>
                    {`Visibility score ${answersSummary?.visibilityScore ?? 0}`}
                  </Badge>
                </InlineStack>
                <Text as="p">{rec.executiveSummary}</Text>
                <Text as="p" tone="subdued">{rec.visibilitySummary}</Text>
                {latest.costEstimate && (
                  <Text as="span" tone="subdued" variant="bodySm">
                    {latest._count?.answers ?? 0} AI answers analyzed · ~${latest.costEstimate.estimatedUsd} est. cost
                  </Text>
                )}
              </BlockStack>
            </Card>

            {answersSummary && (
              <InlineGrid columns={{ xs: 1, md: 2, lg: 4 }} gap="300">
                <MiniStat label="AI visibility score" value={`${answersSummary.visibilityScore}%`} />
                <MiniStat label="Buyer prompts used" value={String(answersSummary.promptCount)} />
                <MiniStat label="AI answers stored" value={String(answersSummary.totalAnswers)} />
                <MiniStat
                  label="Missed competitor answers"
                  value={String(answersSummary.competitorPresentWithoutOwnBrand)}
                />
              </InlineGrid>
            )}

            {answersSummary && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">AI answers summary</Text>
                  <InlineStack gap="200" wrap>
                    {answersSummary.expectedEngines.map((engine) => (
                      <Badge key={engine} tone={answersSummary.failedEngines.includes(engine) ? "critical" : "success"}>
                        {answersSummary.failedEngines.includes(engine) ? `${engine.toLowerCase()} failed/partial` : `${engine.toLowerCase()} ok`}
                      </Badge>
                    ))}
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Own brand mentioned in {answersSummary.ownBrandMentionedAnswers} of {answersSummary.totalAnswers} stored
                    answers{answersSummary.avgOwnBrandPosition != null ? ` · avg own-brand position ${answersSummary.avgOwnBrandPosition}` : ""}.
                  </Text>
                </BlockStack>
              </Card>
            )}

            {promptGroups.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Generated buyer prompts</Text>
                  {promptGroups.map(([intent, prompts]) => (
                    <BlockStack key={intent} gap="150">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge>{intent.replace(/_/g, " ")}</Badge>
                        <Text as="span" tone="subdued" variant="bodySm">{prompts.length} prompt(s)</Text>
                      </InlineStack>
                      <List type="bullet">
                        {prompts.slice(0, 5).map((prompt) => <List.Item key={prompt.text}>{prompt.text}</List.Item>)}
                      </List>
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            {rec.topCompetitors.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Top competitors researched</Text>
                  <InlineStack gap="200" wrap>
                    {rec.topCompetitors.map((c) => (
                      <Badge key={c.name} tone="info">{c.domain ? `${c.name} · ${c.domain}` : c.name}</Badge>
                    ))}
                  </InlineStack>
                  {rec.whyOutperforming.length > 0 && (
                    <List type="bullet">{rec.whyOutperforming.map((w, i) => <List.Item key={i}>{w}</List.Item>)}</List>
                  )}
                </BlockStack>
              </Card>
            )}

            {latest.research && latest.research.length > 0 && (
              <InlineGrid columns={{ xs: 1, lg: 2 }} gap="300">
                {latest.research.map((row) => (
                  <Card key={`${row.competitorName}-${row.competitorDomain ?? "unknown"}`}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">{row.competitorName}</Text>
                        <Badge tone="info">{row.competitorDomain ?? "domain unresolved"}</Badge>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        Mentioned {row.mentionCount}×{row.avgPosition != null ? ` · avg position ${row.avgPosition}` : ""}
                      </Text>
                      <InlineStack gap="150" wrap>
                        {row.schemaAudit?.product && <Badge>Product schema</Badge>}
                        {row.schemaAudit?.offer && <Badge>Offer schema</Badge>}
                        {row.schemaAudit?.aggregateRating && <Badge>AggregateRating</Badge>}
                        {row.schemaAudit?.faqPage && <Badge>FAQPage</Badge>}
                        {row.contentPatterns?.hasBuyerGuide && <Badge tone="success">Buyer guide</Badge>}
                        {row.contentPatterns?.hasComparisonPage && <Badge tone="success">Comparison page</Badge>}
                        {row.contentPatterns?.hasReviewSignals && <Badge tone="success">Review signals</Badge>}
                      </InlineStack>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {row.researchedPages?.filter((page) => page.ok).length ?? 0} / {row.researchedPages?.length ?? 0} pages inspected
                      </Text>
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            )}

            {gaps.length > 0 && (
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Gap findings</Text>
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="300">
                  {gaps.map((g, i) => (
                    <Card key={i}>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{g.title}</Text>
                        <InlineStack gap="150" wrap>
                          <Badge>{g.category}</Badge>
                          <Badge tone={SEV_TONE[g.severity]}>{`Severity: ${g.severity}`}</Badge>
                          <Badge>{`Impact: ${g.impact}`}</Badge>
                          <Badge>{`Effort: ${g.effort}`}</Badge>
                          {g.auto_fix_possible && <Badge tone="success">Auto-fixable</Badge>}
                        </InlineStack>
                        <Text as="p" tone="subdued">{g.evidence.shop}</Text>
                        {g.evidence.competitors.length > 0 && (
                          <List type="bullet">{g.evidence.competitors.map((e, j) => <List.Item key={j}>{e}</List.Item>)}</List>
                        )}
                        <Text as="p"><Text as="span" fontWeight="semibold">Fix: </Text>{g.recommendation}</Text>
                      </BlockStack>
                    </Card>
                  ))}
                </InlineGrid>
              </BlockStack>
            )}

            {rec.priorityFixes.length > 0 && (
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Priority recommendations</Text>
                {rec.priorityFixes.map((r, i) => (
                  <Card key={i}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center" gap="200">
                        <Text as="h3" variant="headingSm">{r.title}</Text>
                        <InlineStack gap="150" wrap>
                          <Badge tone={r.impact === "high" ? "success" : undefined}>{`Impact: ${r.impact}`}</Badge>
                          <Badge tone={r.effort === "high" ? "critical" : r.effort === "medium" ? "warning" : "success"}>{`Effort: ${r.effort}`}</Badge>
                          {r.auto_fix_available && <Badge tone="success">Auto-fix</Badge>}
                        </InlineStack>
                      </InlineStack>
                      <Text as="p">{r.why_it_matters}</Text>
                      {r.steps.length > 0 && <List type="number">{r.steps.map((s, j) => <List.Item key={j}>{s}</List.Item>)}</List>}
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            )}

            {rec.actionPlan30Day.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">30-day action plan</Text>
                  {rec.actionPlan30Day.map((ph, i) => (
                    <BlockStack key={i} gap="150">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="info">{ph.week}</Badge>
                        <Text as="span" variant="headingSm">{ph.focus}</Text>
                      </InlineStack>
                      {ph.actions.length > 0 && <List type="bullet">{ph.actions.map((a, j) => <List.Item key={j}>{a}</List.Item>)}</List>}
                      {i < rec.actionPlan30Day.length - 1 && <Divider />}
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            {detected.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">All detected competitors</Text>
                  {detected.slice(0, 12).map((c) => (
                    <InlineStack key={c.name} align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span">{c.name}</Text>
                        {c.selectedForResearch && <Badge tone="magic">Researched</Badge>}
                      </InlineStack>
                      <Text as="span" tone="subdued">{c.mentionCount}× · {c.engines.length} engine(s){c.avgPosition != null ? ` · avg pos ${c.avgPosition}` : ""}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="050">
        <Text as="span" variant="headingSm">{value}</Text>
        <Text as="span" tone="subdued" variant="bodySm">{label}</Text>
      </BlockStack>
    </Box>
  );
}

function groupPrompts(prompts: { text: string; intent: string }[]) {
  const groups = new Map<string, { text: string; intent: string }[]>();
  for (const prompt of prompts) {
    const bucket = groups.get(prompt.intent) ?? [];
    bucket.push(prompt);
    groups.set(prompt.intent, bucket);
  }
  return [...groups.entries()];
}

function statusTone(status: string): "success" | "warning" | "critical" | "info" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "critical";
  if (status === "RUNNING") return "warning";
  return "info";
}
