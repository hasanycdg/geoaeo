import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Select,
  Badge,
  Banner,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";
import type { CopySuggestion } from "@geo/core/content";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [info, prod] = await Promise.all([
    apiGet(session.shop, "/api/v1/tenant"),
    apiGet(session.shop, "/api/v1/content/products"),
  ]);
  const domain = info.tenant.primaryDomain || info.tenant.externalId;
  return json({
    products: prod.products as { id: string; title: string }[],
    llmsTxt: info.tenant.llmsTxt as string | null,
    llmsTxtGeneratedAt: info.tenant.llmsTxtGeneratedAt as string | null,
    proxyPath: `https://${domain}/apps/geo/llms.txt`,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "gen-llms") {
    const { content, productCount } = await apiPost(session.shop, "/api/v1/content/llms-txt");
    return json({ kind: "llms", content, productCount });
  }
  if (intent === "suggest-copy") {
    const res = await apiPost(session.shop, "/api/v1/content/product-copy", {
      productId: String(form.get("productId")),
    });
    return json({ kind: "copy", productTitle: res.productTitle, suggestion: res.suggestion as CopySuggestion });
  }
  return json({ error: "unknown" }, { status: 400 });
};

export default function Content() {
  const { products, llmsTxt, llmsTxtGeneratedAt, proxyPath } = useLoaderData<typeof loader>();
  return (
    <Page>
      <TitleBar title="AI content" />
      <BlockStack gap="500">
        <LlmsTxtCard initial={llmsTxt} generatedAt={llmsTxtGeneratedAt} proxyPath={proxyPath} />
        <ProductCopyCard products={products} />
      </BlockStack>
    </Page>
  );
}

function LlmsTxtCard({
  initial,
  generatedAt,
  proxyPath,
}: {
  initial: string | null;
  generatedAt: string | null;
  proxyPath: string;
}) {
  const fetcher = useFetcher<{ kind?: string; content?: string; productCount?: number }>();
  const busy = fetcher.state !== "idle";
  const content = (fetcher.data?.kind === "llms" ? fetcher.data.content : null) ?? initial ?? "";

  const copy = () => navigator.clipboard.writeText(content);
  const download = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "llms.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">llms.txt</Text>
            <Text as="p" tone="subdued">A machine-readable map of your catalog for AI assistants.</Text>
          </BlockStack>
          <Button variant="primary" loading={busy} onClick={() => fetcher.submit({ intent: "gen-llms" }, { method: "post" })}>
            {content ? "Regenerate" : "Generate"}
          </Button>
        </InlineStack>

        {generatedAt && !fetcher.data && (
          <Text as="span" tone="subdued">Last generated {new Date(generatedAt).toLocaleString()}</Text>
        )}
        {fetcher.data?.kind === "llms" && (
          <Banner tone="success">Generated from {fetcher.data.productCount} products.</Banner>
        )}

        {content && (
          <>
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 280, overflow: "auto" }}>{content}</pre>
            </Box>
            <InlineStack gap="200">
              <Button onClick={copy}>Copy</Button>
              <Button onClick={download}>Download llms.txt</Button>
            </InlineStack>
            <Banner tone="info">
              Once the app is deployed, this is served live at <code>{proxyPath}</code> (via Shopify App Proxy) and stays in sync when you regenerate. You can also host the downloaded file yourself.
            </Banner>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

function ProductCopyCard({ products }: { products: { id: string; title: string }[] }) {
  const fetcher = useFetcher<{ kind?: string; productTitle?: string; suggestion?: CopySuggestion }>();
  const busy = fetcher.state !== "idle";
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const suggestion = fetcher.data?.kind === "copy" ? fetcher.data.suggestion : undefined;

  if (products.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">Product descriptions for AI</Text>
          <Text as="p" tone="subdued">No products found in your store yet.</Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Product descriptions for AI</Text>
          <Text as="p" tone="subdued">Rewrites a product description in natural language for conversational AI queries — not keyword stuffing.</Text>
        </BlockStack>
        <InlineStack gap="200" blockAlign="end">
          <div style={{ flex: 1 }}>
            <Select label="Product" labelHidden options={products.map((p) => ({ label: p.title, value: p.id }))} value={productId} onChange={setProductId} />
          </div>
          <Button variant="primary" loading={busy} onClick={() => fetcher.submit({ intent: "suggest-copy", productId }, { method: "post" })}>
            Generate suggestions
          </Button>
        </InlineStack>

        {suggestion && (
          <BlockStack gap="300">
            {suggestion.source === "template" && (
              <Banner tone="warning">Add ANTHROPIC_API_KEY to generate AI-written copy. Showing a template scaffold.</Banner>
            )}
            <Section title="Description" onCopy={() => navigator.clipboard.writeText(suggestion.description)}>
              <Text as="p">{suggestion.description}</Text>
            </Section>
            <Section title="Highlights" onCopy={() => navigator.clipboard.writeText(suggestion.bullets.map((b) => `• ${b}`).join("\n"))}>
              <List>{suggestion.bullets.map((b, i) => <List.Item key={i}>{b}</List.Item>)}</List>
            </Section>
            <Section title="FAQ" onCopy={() => navigator.clipboard.writeText(suggestion.faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n"))}>
              <BlockStack gap="200">
                {suggestion.faqs.map((f, i) => (
                  <BlockStack key={i} gap="050">
                    <Text as="span" fontWeight="bold">{f.question}</Text>
                    <Text as="span">{f.answer}</Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Section>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function Section({ title, onCopy, children }: { title: string; onCopy: () => void; children: React.ReactNode }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">{title}</Text>
          <Button variant="plain" onClick={onCopy}>Copy</Button>
        </InlineStack>
        {children}
      </BlockStack>
    </Box>
  );
}
