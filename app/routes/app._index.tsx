import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Badge,
  Button,
  EmptyState,
  Banner,
  ProgressBar,
  Box,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";
import type { Dashboard } from "@geo/core/models";

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Claude",
  OPENAI: "ChatGPT",
  GEMINI: "Gemini",
  PERPLEXITY: "Perplexity",
};

const SENTIMENT_TONE: Record<string, "success" | "critical" | "warning" | "info"> = {
  POSITIVE: "success",
  NEGATIVE: "critical",
  MIXED: "warning",
  NEUTRAL: "info",
  UNKNOWN: "info",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [info, dashboard] = await Promise.all([
    apiGet(session.shop, "/api/v1/tenant"),
    apiGet(session.shop, "/api/v1/dashboard"),
  ]);
  return json({
    onboarded: info.onboarded as boolean,
    dashboard: dashboard as Dashboard,
    plan: info.limits,
    remaining: info.usage.remaining as number,
    usage: info.usage.used as number,
    lastScanError: info.tenant.lastScanError as string | null,
    lastScanCompletedAt: info.tenant.lastScanCompletedAt as string | null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const info = await apiGet(session.shop, "/api/v1/tenant");
  if (!info.onboarded) return json({ error: "Add a brand name and at least one prompt first." }, { status: 400 });
  await apiPost(session.shop, "/api/v1/scan");
  return json({ ok: true });
};

export default function Dashboard() {
  const { onboarded, dashboard, plan, remaining, usage, lastScanError, lastScanCompletedAt } =
    useLoaderData<typeof loader>();
  const STALE_MS = 8 * 24 * 60 * 60 * 1000; // weekly cadence + grace
  const scansStale =
    onboarded && (!lastScanCompletedAt || Date.now() - new Date(lastScanCompletedAt).getTime() > STALE_MS);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const scanning = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "ok" in fetcher.data) {
      shopify.toast.show("Scan queued — results appear in a few minutes");
    }
  }, [fetcher.data, shopify]);

  if (!onboarded) {
    return (
      <Page>
        <TitleBar title="GEO Monitor" />
        <Card>
          <EmptyState
            heading="See how visible your brand is in AI answers"
            action={{ content: "Set up tracking", url: "/app/settings" }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Add your brand name and the prompts buyers ask AI assistants. We'll start measuring your visibility across ChatGPT, Claude, Gemini and Perplexity.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const quotaPct = plan.monthlyQueryQuota ? Math.min(100, (usage / plan.monthlyQueryQuota) * 100) : 0;
  const overall = dashboard.providers.length
    ? Math.round((dashboard.providers.reduce((a, p) => a + p.mentionRate, 0) / dashboard.providers.length) * 100)
    : 0;

  return (
    <Page>
      <TitleBar title="GEO Monitor" />
      <BlockStack gap="500">
        <Box background={scoreSurface(overall)} borderRadius="300" padding="500">
          <InlineGrid columns={{ xs: "1fr", md: "auto 1fr" }} gap="500">
            <Box background="bg-surface" borderRadius="300" padding="400" minWidth="170px">
              <BlockStack gap="100" inlineAlign="center">
                <Text as="p" variant="heading3xl">{dashboard.hasData ? `${overall}%` : "—"}</Text>
                <Text as="span" tone="subdued" variant="bodySm">AI mention rate</Text>
                <Badge tone="info">{`${plan.name} plan`}</Badge>
              </BlockStack>
            </Box>
            <BlockStack gap="300">
              <BlockStack gap="150">
                <Text as="h2" variant="headingLg">How visible is your brand in AI answers?</Text>
                <Text as="p" tone="subdued">
                  Measured across ChatGPT, Claude, Gemini &amp; Perplexity for your tracked buyer questions.
                  {dashboard.lastScanAt
                    ? ` Last scan ${new Date(dashboard.lastScanAt).toLocaleDateString()}.`
                    : " No scans yet."}
                </Text>
              </BlockStack>
              <InlineStack gap="300" blockAlign="center">
                <Button variant="primary" loading={scanning} disabled={remaining < plan.repetitions}
                  onClick={() => fetcher.submit({}, { method: "post" })}>
                  Scan now
                </Button>
                <Link to="/app/deep">Open deep analysis</Link>
              </InlineStack>
              <Box>
                <Text as="span" tone="subdued" variant="bodySm">Quota · {usage} / {plan.monthlyQueryQuota} queries this period</Text>
                <ProgressBar progress={quotaPct} size="small" />
              </Box>
            </BlockStack>
          </InlineGrid>
        </Box>

        {remaining < plan.repetitions && (
          <Banner tone="warning">This period's query quota is used up. Scans resume next period, or upgrade your plan.</Banner>
        )}
        {scansStale && (
          <Banner tone="warning">
            No recent scans. Ensure the background worker is running (`npm run worker`), or click "Scan now".
          </Banner>
        )}
        {lastScanError && (
          <Banner tone="critical">Last scan reported a provider error: {lastScanError}</Banner>
        )}

        {!dashboard.hasData ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">No results yet</Text>
              <Text as="p" tone="subdued">
                Your first weekly scan runs automatically, or click &quot;Scan now&quot; to start immediately.
                (Results require the background worker to be running.)
              </Text>
            </BlockStack>
          </Card>
        ) : (
          <>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Visibility by AI engine</Text>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                {dashboard.providers.map((p) => (
                  <Card key={p.provider}>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">{PROVIDER_LABEL[p.provider] ?? p.provider}</Text>
                      <Text as="p" variant="heading2xl">{Math.round(p.mentionRate * 100)}%</Text>
                      <Text as="span" tone="subdued">mention rate · {p.totalRuns} runs</Text>
                      <InlineStack gap="200" wrap>
                        <Badge tone={SENTIMENT_TONE[p.sentiment]}>{p.sentiment.toLowerCase()}</Badge>
                        {p.avgPosition != null && <Badge>{`avg pos ${p.avgPosition.toFixed(1)}`}</Badge>}
                      </InlineStack>
                      <Sparkline values={p.trend} />
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            </BlockStack>

            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Share of model</Text>
                  <Text as="p" tone="subdued">How often you appear vs. your competitors across all answers.</Text>
                  <ShareBar label="You" count={dashboard.shareOfModel.brand} max={shareMax(dashboard)} highlight />
                  {dashboard.shareOfModel.competitors.map((c) => (
                    <ShareBar key={c.name} label={c.name} count={c.count} max={shareMax(dashboard)} />
                  ))}
                </BlockStack>
              </Card>

              {dashboard.gaps.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Where you're missing</Text>
                    <Text as="p" tone="subdued">Competitors named in answers where your brand was not mentioned.</Text>
                    {dashboard.gaps.map((g) => (
                      <InlineStack key={g.name} align="space-between">
                        <Text as="span">{g.name}</Text>
                        <Badge tone="critical">{`${g.count}×`}</Badge>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </Card>
              )}
            </InlineGrid>
          </>
        )}

        <InlineStack align="end"><Link to="/app/settings">Manage prompts &amp; competitors</Link></InlineStack>
      </BlockStack>
    </Page>
  );
}

const scoreSurface = (s: number): "bg-surface-success" | "bg-surface-caution" | "bg-surface-critical" =>
  s >= 60 ? "bg-surface-success" : s >= 25 ? "bg-surface-caution" : "bg-surface-critical";

function shareMax(d: { shareOfModel: { brand: number; competitors: { count: number }[] } }) {
  return Math.max(1, d.shareOfModel.brand, ...d.shareOfModel.competitors.map((c) => c.count));
}

function ShareBar({ label, count, max, highlight }: { label: string; count: number; max: number; highlight?: boolean }) {
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text as="span" fontWeight={highlight ? "bold" : "regular"}>{label}</Text>
        <Text as="span" tone="subdued">{count}</Text>
      </InlineStack>
      <ProgressBar progress={(count / max) * 100} size="small" tone={highlight ? "primary" : "highlight"} />
    </BlockStack>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <Box minHeight="24px" />;
  const w = 120, h = 24;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - v * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="trend">
      <polyline points={pts} fill="none" stroke="var(--p-color-bg-fill-brand)" strokeWidth="2" />
    </svg>
  );
}
