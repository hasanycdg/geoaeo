import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
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
  EmptyState,
  List,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";

interface HistoryItem {
  id: string;
  createdAt: string;
  visibilityScore: number;
  verdict: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const res = await apiGet(session.shop, "/api/v1/deep-report/history");
    return json({ history: (res.reports ?? []) as HistoryItem[] });
  } catch {
    return json({ history: [] as HistoryItem[] });
  }
};

type Priority = "HIGH" | "MEDIUM" | "LOW";
interface DeepRecommendation {
  title: string;
  rationale: string;
  category: string;
  impact: Priority;
  effort: Priority;
}
interface RoadmapPhase {
  phase: string;
  goal: string;
  actions: string[];
}
interface CompetitorAnalysis {
  name: string;
  whyTheyWin: string;
  whatToLearn: string;
}
interface ProductAnalysis {
  product: string;
  issues: string[];
  optimizedDescription: string;
  faqs: { question: string; answer: string }[];
  schemaTip: string;
}
interface DeepReport {
  visibilityScore: number;
  verdict: string;
  summary: string;
  whyNotVisible: string[];
  strengths: string[];
  recommendations: DeepRecommendation[];
  roadmap: RoadmapPhase[];
  competitorAnalysis: CompetitorAnalysis[];
  productAnalysis: ProductAnalysis[];
  suggestedPrompts: string[];
  source: "llm" | "fallback";
  generatedAt: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "generate");

  if (intent === "add-prompts") {
    const prompts = JSON.parse(String(form.get("prompts") || "[]")) as string[];
    let added = 0;
    for (const text of prompts) {
      try {
        await apiPost(session.shop, "/api/v1/prompts", { text });
        added++;
      } catch {
        /* skip limit/dupe errors, keep going */
      }
    }
    return json({ added });
  }

  if (intent === "open") {
    const id = String(form.get("id"));
    const report = (await apiGet(session.shop, `/api/v1/deep-report/${encodeURIComponent(id)}`)) as DeepReport;
    return json({ report });
  }

  const report = (await apiPost(session.shop, "/api/v1/deep-report")) as DeepReport;
  return json({ report });
};

const IMPACT_TONE: Record<Priority, "success" | "info" | undefined> = { HIGH: "success", MEDIUM: "info", LOW: undefined };
const EFFORT_TONE: Record<Priority, "critical" | "warning" | "success"> = { HIGH: "critical", MEDIUM: "warning", LOW: "success" };

const scoreTone = (s: number): "success" | "warning" | "critical" => (s >= 60 ? "success" : s >= 25 ? "warning" : "critical");
const progressTone = (s: number): "success" | "primary" | "critical" => (s >= 60 ? "success" : s >= 25 ? "primary" : "critical");
const scoreLabel = (s: number): string => (s >= 60 ? "Strong" : s >= 25 ? "Needs work" : "Critical");
const scoreSurface = (s: number): "bg-surface-success" | "bg-surface-caution" | "bg-surface-critical" =>
  s >= 60 ? "bg-surface-success" : s >= 25 ? "bg-surface-caution" : "bg-surface-critical";

export default function DeepAnalysis() {
  const reportFetcher = useFetcher<typeof action>();
  const promptFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const { history } = useLoaderData<typeof loader>();

  const busy = reportFetcher.state !== "idle";
  const report = reportFetcher.data && "report" in reportFetcher.data ? reportFetcher.data.report : null;
  const fmtDate = (iso: string) => new Date(iso).toLocaleString();

  useEffect(() => {
    if (promptFetcher.data && "added" in promptFetcher.data) {
      shopify.toast.show(`${promptFetcher.data.added} prompt(s) added — run a scan to measure them`);
    }
  }, [promptFetcher.data, shopify]);

  return (
    <Page>
      <TitleBar title="Action Plan" />
      <BlockStack gap="500">
        <style>{`@media print { .geo-no-print { display: none !important; } .Polaris-Page { padding: 0 !important; } }`}</style>

        <div className="geo-no-print">
          <BlockStack gap="500">
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Action Plan — AI visibility deep analysis
                  </Text>
                  <Text as="p" tone="subdued">
                    Reads your live catalog, your last scan and your competitors — then delivers a scored
                    strategy: why AI assistants recommend you or not, a 30/60/90 roadmap, competitor teardown,
                    per-product rewrites and buyer prompts to track.
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  {report && <Button onClick={() => window.print()}>Download PDF</Button>}
                  <Button variant="primary" loading={busy} onClick={() => reportFetcher.submit({}, { method: "post" })}>
                    {report ? "Regenerate" : "Generate report"}
                  </Button>
                </InlineStack>
              </InlineStack>
            </Card>

            {history.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Saved reports</Text>
                  {history.map((h) => (
                    <InlineStack key={h.id} align="space-between" blockAlign="center" gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={scoreTone(h.visibilityScore)}>{`${h.visibilityScore}/100`}</Badge>
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="medium">{fmtDate(h.createdAt)}</Text>
                          <Text as="span" tone="subdued">{h.verdict}</Text>
                        </BlockStack>
                      </InlineStack>
                      <Button
                        variant="plain"
                        loading={busy}
                        onClick={() => reportFetcher.submit({ intent: "open", id: h.id }, { method: "post" })}
                      >
                        Open
                      </Button>
                    </InlineStack>
                  ))}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </div>

        {busy && (
          <Card>
            <BlockStack gap="200">
              <Text as="p">Analyzing catalog, scan answers and competitors… this can take ~20–40s.</Text>
              <ProgressBar progress={70} tone="primary" size="small" />
            </BlockStack>
          </Card>
        )}

        {!report && !busy && history.length === 0 && (
          <Card>
            <EmptyState heading="No analysis yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Generate a report to see your visibility score and exactly what to fix first.</p>
            </EmptyState>
          </Card>
        )}

        {report && (
          <>
            {report.source === "fallback" && (
              <Banner tone="warning">Data-only summary — no OpenAI key on the backend. Add OPENAI_API_KEY for the full analysis.</Banner>
            )}

            {/* Scorecard hero */}
            <Box background={scoreSurface(report.visibilityScore)} borderRadius="300" padding="500">
              <InlineGrid columns={{ xs: "1fr", md: "auto 1fr" }} gap="500">
                <Box background="bg-surface" borderRadius="300" padding="400" minWidth="150px">
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" variant="heading3xl">{`${report.visibilityScore}`}</Text>
                    <Text as="span" tone="subdued" variant="bodySm">/ 100 visibility</Text>
                    <Badge tone={scoreTone(report.visibilityScore)}>{scoreLabel(report.visibilityScore)}</Badge>
                  </BlockStack>
                </Box>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">{report.verdict}</Text>
                  <ProgressBar progress={report.visibilityScore} tone={progressTone(report.visibilityScore)} />
                  <Text as="p">{report.summary}</Text>
                </BlockStack>
              </InlineGrid>
            </Box>

            {/* Why + strengths */}
            {(report.whyNotVisible.length > 0 || report.strengths.length > 0) && (
              <Card>
                <BlockStack gap="400">
                  {report.whyNotVisible.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Why you&apos;re not winning AI answers</Text>
                      <List type="bullet">{report.whyNotVisible.map((w, i) => <List.Item key={i}>{w}</List.Item>)}</List>
                    </BlockStack>
                  )}
                  {report.strengths.length > 0 && (
                    <>
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">What&apos;s working</Text>
                        <List type="bullet">{report.strengths.map((s, i) => <List.Item key={i}>{s}</List.Item>)}</List>
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Recommendations */}
            {report.recommendations.length > 0 && (
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recommended actions</Text>
                <InlineGrid columns={{ xs: 1, lg: 2 }} gap="300">
                  {report.recommendations.map((r, i) => (
                    <Card key={i}>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{r.title}</Text>
                        <InlineStack gap="150" wrap>
                          <Badge>{r.category}</Badge>
                          <Badge tone={IMPACT_TONE[r.impact]}>{`Impact: ${r.impact}`}</Badge>
                          <Badge tone={EFFORT_TONE[r.effort]}>{`Effort: ${r.effort}`}</Badge>
                        </InlineStack>
                        <Text as="p">{r.rationale}</Text>
                      </BlockStack>
                    </Card>
                  ))}
                </InlineGrid>
              </BlockStack>
            )}

            {/* Roadmap */}
            {report.roadmap.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Roadmap</Text>
                  {report.roadmap.map((ph, i) => (
                    <BlockStack key={i} gap="150">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone="info">{ph.phase}</Badge>
                        <Text as="span" variant="headingSm">{ph.goal}</Text>
                      </InlineStack>
                      <List type="bullet">{ph.actions.map((a, j) => <List.Item key={j}>{a}</List.Item>)}</List>
                      {i < report.roadmap.length - 1 && <Divider />}
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            {/* Competitor deep-dive */}
            {report.competitorAnalysis.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Competitor deep-dive</Text>
                  {report.competitorAnalysis.map((c, i) => (
                    <BlockStack key={i} gap="150">
                      <Text as="h3" variant="headingSm">{c.name}</Text>
                      <Text as="p"><Text as="span" fontWeight="semibold">Why they win: </Text>{c.whyTheyWin}</Text>
                      <Text as="p" tone="subdued"><Text as="span" fontWeight="semibold">What to learn: </Text>{c.whatToLearn}</Text>
                      {i < report.competitorAnalysis.length - 1 && <Divider />}
                    </BlockStack>
                  ))}
                </BlockStack>
              </Card>
            )}

            {/* Per-product analysis with ready-to-paste copy */}
            {report.productAnalysis.length > 0 && (
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Product optimizations</Text>
                {report.productAnalysis.map((p, i) => (
                  <Card key={i}>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">{p.product}</Text>
                      {p.issues.length > 0 && (
                        <List type="bullet">{p.issues.map((iss, j) => <List.Item key={j}>{iss}</List.Item>)}</List>
                      )}
                      <BlockStack gap="100">
                        <Text as="span" variant="headingXs">Optimized description (ready to paste)</Text>
                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                          <Text as="p">{p.optimizedDescription}</Text>
                        </Box>
                      </BlockStack>
                      {p.faqs.length > 0 && (
                        <BlockStack gap="100">
                          <Text as="span" variant="headingXs">FAQ</Text>
                          {p.faqs.map((f, j) => (
                            <BlockStack key={j} gap="050">
                              <Text as="span" fontWeight="semibold">{f.question}</Text>
                              <Text as="p" tone="subdued">{f.answer}</Text>
                            </BlockStack>
                          ))}
                        </BlockStack>
                      )}
                      {p.schemaTip && (
                        <Text as="p" tone="subdued"><Text as="span" fontWeight="semibold">Structured data: </Text>{p.schemaTip}</Text>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            )}

            {/* Suggested prompts */}
            {report.suggestedPrompts.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Buyer prompts to track</Text>
                    <Button
                      loading={promptFetcher.state !== "idle"}
                      onClick={() =>
                        promptFetcher.submit(
                          { intent: "add-prompts", prompts: JSON.stringify(report.suggestedPrompts) },
                          { method: "post" },
                        )
                      }
                    >
                      Add all as tracked prompts
                    </Button>
                  </InlineStack>
                  <List type="bullet">{report.suggestedPrompts.map((p, i) => <List.Item key={i}>{p}</List.Item>)}</List>
                </BlockStack>
              </Card>
            )}

            <Text as="p" tone="subdued" alignment="center">
              Generated {new Date(report.generatedAt).toLocaleString()} · {report.source === "llm" ? "AI analysis" : "data-only"}
            </Text>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
