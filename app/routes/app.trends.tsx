import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Box, ProgressBar, EmptyState } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet } from "../geo/backend.server";

interface Point {
  date: string | null;
  mentionRate: number;
  byProvider: Record<string, number>;
}
interface LeaderRow {
  name: string;
  count: number;
  isBrand: boolean;
}
interface CompSeries {
  name: string;
  values: number[];
}

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Claude",
  OPENAI: "ChatGPT",
  GEMINI: "Gemini",
  PERPLEXITY: "Perplexity",
};
const PROVIDER_COLOR: Record<string, string> = {
  OPENAI: "#10a37f",
  ANTHROPIC: "#d97757",
  GEMINI: "#4285f4",
  PERPLEXITY: "#20808d",
};
const OVERALL_COLOR = "#5c6ac4";
const COMP_COLORS = ["#e07a5f", "#3d5a80", "#81b29a", "#9b5de5", "#e9c46a"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const res = await apiGet(session.shop, "/api/v1/trends");
  return json({
    points: (res.points ?? []) as Point[],
    leaderboard: (res.leaderboard ?? []) as LeaderRow[],
    competitorSeries: (res.competitorSeries ?? []) as CompSeries[],
  });
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

interface Series {
  label: string;
  color: string;
  values: number[];
  width: number;
  dots?: boolean;
}

function LineChart({ dates, series }: { dates: (string | null)[]; series: Series[] }) {
  const W = 680, H = 240, padL = 40, padR = 16, padT = 14, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = dates.length;
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + (1 - Math.max(0, Math.min(1, v))) * innerH;
  const toLine = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend" style={{ maxWidth: W }}>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="var(--p-color-border-disabled)" strokeWidth="1" />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--p-color-text-subdued)">
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.label}>
          <polyline points={toLine(s.values)} fill="none" stroke={s.color} strokeWidth={s.width} strokeOpacity={s.width >= 3 ? 1 : 0.7} />
          {s.dots && s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color} />)}
        </g>
      ))}
      <text x={padL} y={H - 8} fontSize="10" fill="var(--p-color-text-subdued)">{fmtDate(dates[0])}</text>
      <text x={W - padR} y={H - 8} textAnchor="end" fontSize="10" fill="var(--p-color-text-subdued)">{fmtDate(dates[n - 1])}</text>
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <InlineStack gap="150" blockAlign="center">
      <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: "inline-block" }} />
      <Text as="span" variant="bodySm">{label}</Text>
    </InlineStack>
  );
}

export default function Trends() {
  const { points, leaderboard, competitorSeries } = useLoaderData<typeof loader>();
  const providers = Array.from(new Set(points.flatMap((p) => Object.keys(p.byProvider))));
  const dates = points.map((p) => p.date);
  const latest = points[points.length - 1];
  const first = points[0];
  const delta = latest && first ? Math.round((latest.mentionRate - first.mentionRate) * 100) : 0;
  const maxCount = Math.max(1, ...leaderboard.map((r) => r.count));

  const engineSeries: Series[] = [
    { label: "Overall", color: OVERALL_COLOR, values: points.map((p) => p.mentionRate), width: 3, dots: true },
    ...providers.map((prov) => ({
      label: PROVIDER_LABEL[prov] ?? prov,
      color: PROVIDER_COLOR[prov] ?? "#999",
      values: points.map((p) => p.byProvider[prov] ?? 0),
      width: 1.5,
    })),
  ];
  const compChartSeries: Series[] = [
    { label: "You", color: OVERALL_COLOR, values: points.map((p) => p.mentionRate), width: 3, dots: true },
    ...competitorSeries.map((s, i) => ({
      label: s.name,
      color: COMP_COLORS[i % COMP_COLORS.length],
      values: s.values,
      width: 1.5,
    })),
  ];

  if (points.length === 0) {
    return (
      <Page>
        <TitleBar title="Trends" />
        <Card>
          <EmptyState heading="No scans yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
            <p>Run a few scans (Dashboard → Scan now) to build visibility and competitor trends over time.</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Trends" />
      <BlockStack gap="500">
        {/* Overall visibility over time */}
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="150">
              <Text as="h2" variant="headingMd">Visibility over time</Text>
              <Text as="p" tone="subdued">Brand mention rate across every scan, overall and per AI engine.</Text>
            </BlockStack>
            {points.length < 2 ? (
              <Text as="p" tone="subdued">Trends appear after at least two scans.</Text>
            ) : (
              <>
                <InlineStack gap="300" blockAlign="center">
                  <Text as="span" variant="heading2xl">{Math.round(latest.mentionRate * 100)}%</Text>
                  <Text as="span" tone={delta >= 0 ? "success" : "critical"}>
                    {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} pts since {fmtDate(first.date)}
                  </Text>
                </InlineStack>
                <Box padding="200"><LineChart dates={dates} series={engineSeries} /></Box>
                <InlineStack gap="400" wrap>
                  <LegendDot color={OVERALL_COLOR} label="Overall" />
                  {providers.map((p) => <LegendDot key={p} color={PROVIDER_COLOR[p] ?? "#999"} label={PROVIDER_LABEL[p] ?? p} />)}
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Card>

        {/* Share of voice leaderboard */}
        {leaderboard.length > 1 && (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="150">
                <Text as="h2" variant="headingMd">Share of voice</Text>
                <Text as="p" tone="subdued">Who gets named most across all AI answers — you vs. the competitors that keep showing up.</Text>
              </BlockStack>
              {leaderboard.map((r) => (
                <BlockStack key={r.name} gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" fontWeight={r.isBrand ? "bold" : "regular"}>{r.name}</Text>
                    <Text as="span" tone="subdued">{r.count}</Text>
                  </InlineStack>
                  <ProgressBar progress={(r.count / maxCount) * 100} size="small" tone={r.isBrand ? "primary" : "highlight"} />
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        )}

        {/* Competitor appearance over time */}
        {competitorSeries.length > 0 && points.length >= 2 && (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="150">
                <Text as="h2" variant="headingMd">Competitor appearance over time</Text>
                <Text as="p" tone="subdued">How often each top competitor shows up per scan — spot who's gaining ground on you.</Text>
              </BlockStack>
              <Box padding="200"><LineChart dates={dates} series={compChartSeries} /></Box>
              <InlineStack gap="400" wrap>
                <LegendDot color={OVERALL_COLOR} label="You" />
                {competitorSeries.map((s, i) => <LegendDot key={s.name} color={COMP_COLORS[i % COMP_COLORS.length]} label={s.name} />)}
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
