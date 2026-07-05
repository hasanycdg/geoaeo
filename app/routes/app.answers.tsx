import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Box,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  List,
  EmptyState,
  Link as PolarisLink,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet } from "../geo/backend.server";

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

interface Answer {
  provider: string;
  brandMentioned: boolean;
  sentiment: string;
  position: number | null;
  competitors: string[];
  citations: { url: string; title?: string }[];
  answer: string;
  completedAt: string | null;
}
interface PromptGroup {
  promptId: string;
  prompt: string;
  answers: Answer[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [info, ans] = await Promise.all([
    apiGet(session.shop, "/api/v1/tenant"),
    apiGet(session.shop, "/api/v1/answers"),
  ]);
  return json({
    prompts: (ans.prompts ?? []) as PromptGroup[],
    brand: [info.tenant.brandName, ...(info.tenant.brandAliases ?? [])].filter(Boolean) as string[],
  });
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- inline rendering: brand/competitor highlight -> bold -> markdown links ---
function highlightNodes(text: string, terms: string[], brandSet: Set<string>, kb: string): ReactNode[] {
  if (!terms.length || !text) return [text];
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return text.split(re).map((p, i) => {
    const low = p.toLowerCase();
    if (brandSet.has(low))
      return <mark key={`${kb}-${i}`} style={{ background: "#c6f0d0", borderRadius: 3, padding: "0 2px" }}>{p}</mark>;
    if (terms.some((t) => t.toLowerCase() === low))
      return <mark key={`${kb}-${i}`} style={{ background: "#ffe9a8", borderRadius: 3, padding: "0 2px" }}>{p}</mark>;
    return <span key={`${kb}-${i}`}>{p}</span>;
  });
}

function renderBold(text: string, terms: string[], brandSet: Set<string>, kb: string): ReactNode[] {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <Text as="span" key={`${kb}-b${i}`} fontWeight="bold">
        {highlightNodes(part, terms, brandSet, `${kb}-b${i}`)}
      </Text>
    ) : (
      <span key={`${kb}-n${i}`}>{highlightNodes(part, terms, brandSet, `${kb}-n${i}`)}</span>
    ),
  );
}

function renderInline(text: string, terms: string[], brandSet: Set<string>, kb: string): ReactNode[] {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderBold(text.slice(last, m.index), terms, brandSet, `${kb}-t${k}`));
    nodes.push(
      <PolarisLink key={`${kb}-l${k}`} url={m[2]} target="_blank">
        {m[1]}
      </PolarisLink>,
    );
    last = m.index + m[0].length;
    k++;
  }
  if (last < text.length) nodes.push(...renderBold(text.slice(last), terms, brandSet, `${kb}-e${k}`));
  return nodes;
}

// Turn one AI answer (markdown-ish) into structured blocks: intro + bullet list,
// split into sections on "---".
function AnswerBody({ text, brand, competitors }: { text: string; brand: string[]; competitors: string[] }) {
  const terms = [...brand, ...competitors].filter(Boolean);
  const brandSet = new Set(brand.map((b) => b.toLowerCase()));
  const sections = text.replace(/\r/g, "").split(/\s*---\s*/).map((s) => s.trim()).filter(Boolean);

  return (
    <BlockStack gap="300">
      {sections.map((sec, si) => {
        if (sec.includes("•") || /(^|\n)\s*[-*]\s+/.test(sec)) {
          const rawItems = sec.split(/•|\n\s*[-*]\s+/).map((s) => s.trim());
          const intro = rawItems[0] && !sec.trimStart().startsWith("•") ? rawItems.shift() : undefined;
          const items = rawItems.filter(Boolean);
          return (
            <BlockStack key={si} gap="200">
              {intro && <Text as="p">{renderInline(intro, terms, brandSet, `s${si}-i`)}</Text>}
              <List type="bullet">
                {items.map((it, i) => (
                  <List.Item key={i}>{renderInline(it, terms, brandSet, `s${si}-${i}`)}</List.Item>
                ))}
              </List>
            </BlockStack>
          );
        }
        return (
          <BlockStack key={si} gap="200">
            {sec.split(/\n{2,}/).map((p, i) => (
              <Text as="p" key={i}>{renderInline(p.trim(), terms, brandSet, `s${si}-p${i}`)}</Text>
            ))}
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export default function Answers() {
  const { prompts, brand } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="AI answers" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="150">
            <Text as="h2" variant="headingMd">What AI actually says about you</Text>
            <Text as="p" tone="subdued">
              The real answers from each engine for your tracked prompts, saved from every scan.{" "}
              <mark style={{ background: "#c6f0d0", borderRadius: 3, padding: "0 2px" }}>Your brand</mark> and{" "}
              <mark style={{ background: "#ffe9a8", borderRadius: 3, padding: "0 2px" }}>competitors</mark> are highlighted.
            </Text>
          </BlockStack>
        </Card>

        {prompts.length === 0 ? (
          <Card>
            <EmptyState heading="No answers captured yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Run a scan (Dashboard → Scan now) to capture what ChatGPT, Claude, Gemini and Perplexity answer.</p>
            </EmptyState>
          </Card>
        ) : (
          prompts.map((pg) => (
            <Card key={pg.promptId}>
              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">“{pg.prompt}”</Text>
                {pg.answers.map((a, i) => (
                  <BlockStack key={a.provider} gap="200">
                    {i > 0 && <Divider />}
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingSm">{PROVIDER_LABEL[a.provider] ?? a.provider}</Text>
                        {a.completedAt && <Text as="span" tone="subdued" variant="bodySm">· {fmtDate(a.completedAt)}</Text>}
                      </InlineStack>
                      <InlineStack gap="150" wrap>
                        <Badge tone={a.brandMentioned ? "success" : "critical"}>
                          {a.brandMentioned ? "Mentioned" : "Not mentioned"}
                        </Badge>
                        {a.brandMentioned && a.position != null && <Badge>{`Position ${a.position}`}</Badge>}
                        <Badge tone={SENTIMENT_TONE[a.sentiment] ?? "info"}>{a.sentiment.toLowerCase()}</Badge>
                      </InlineStack>
                    </InlineStack>

                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <AnswerBody text={a.answer} brand={brand} competitors={a.competitors} />
                    </Box>

                    {a.competitors.length > 0 && (
                      <Text as="p" tone="subdued">Competitors named: {a.competitors.join(", ")}</Text>
                    )}
                    {a.citations.length > 0 && (
                      <InlineStack gap="300" wrap>
                        {a.citations.slice(0, 6).map((c, j) => (
                          <PolarisLink key={j} url={c.url} target="_blank">
                            {c.title || safeHost(c.url)}
                          </PolarisLink>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          ))
        )}
      </BlockStack>
    </Page>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
