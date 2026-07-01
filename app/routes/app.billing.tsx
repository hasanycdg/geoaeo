import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Badge,
  Button,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";
import { PLANS } from "@geo/core/config/plans";

const isTest = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Backend reconciles our stored plan with the Shopify subscription state.
  const { plan } = await apiGet(session.shop, "/api/v1/billing/plan");
  return json({ currentPlan: plan as string, free: PLANS.FREE, starter: PLANS.STARTER });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/billing`;

  if (intent === "upgrade") {
    // Backend creates the AppSubscription and returns Shopify's confirmation URL;
    // we navigate the top frame to it (embedded apps can't 302 the iframe).
    const { url } = await apiPost(session.shop, "/api/v1/billing/checkout", { plan: "STARTER", returnUrl });
    return json({ url });
  }
  if (intent === "cancel") {
    await apiPost(session.shop, "/api/v1/billing/cancel");
    return json({ ok: true });
  }
  return json({ error: "unknown" }, { status: 400 });
};

function planFeatures(p: typeof PLANS.FREE) {
  return [
    `${p.maxPrompts} tracked prompts`,
    `${p.providers.length} AI model${p.providers.length > 1 ? "s" : ""} (${p.providers.length === 4 ? "all" : "Perplexity"})`,
    `${p.maxCompetitors} competitor${p.maxCompetitors > 1 ? "s" : ""}`,
    `${p.frequency === "WEEKLY" ? "Weekly" : "Daily"} scans`,
    "robots.txt + schema audit",
  ];
}

export default function Billing() {
  const { currentPlan, free, starter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (data && "url" in data && data.url) {
      // Top-frame navigation to Shopify's subscription approval screen.
      window.open(data.url as string, "_top");
    }
  }, [fetcher.data]);

  return (
    <Page>
      <TitleBar title="Plan & billing" />
      <BlockStack gap="500">
        <Text as="p" tone="subdued">
          Billed securely through Shopify — charges appear on your Shopify invoice. {isTest ? "(Test mode: no real charge.)" : ""}
        </Text>
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Free</Text>
                {currentPlan === "FREE" && <Badge tone="success">Current</Badge>}
              </InlineStack>
              <Text as="p" variant="heading2xl">$0</Text>
              <List>{planFeatures(free).map((f) => <List.Item key={f}>{f}</List.Item>)}</List>
              {currentPlan === "STARTER" && (
                <Button loading={busy} onClick={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}>
                  Downgrade to Free
                </Button>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Starter</Text>
                {currentPlan === "STARTER" && <Badge tone="success">Current</Badge>}
              </InlineStack>
              <Text as="p" variant="heading2xl">${starter.priceUsd}<Text as="span" variant="bodySm" tone="subdued">/mo</Text></Text>
              <List>{planFeatures(starter).map((f) => <List.Item key={f}>{f}</List.Item>)}</List>
              {currentPlan === "FREE" && (
                <Button variant="primary" loading={busy} onClick={() => fetcher.submit({ intent: "upgrade" }, { method: "post" })}>
                  Upgrade to Starter
                </Button>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
