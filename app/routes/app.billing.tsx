import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Box,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost } from "../geo/backend.server";
import { PLANS, ORDERED_PLANS, planFeatureList, type PlanConfig } from "@geo/core/config/plans";

const isTest = process.env.NODE_ENV !== "production";
const POPULAR: PlanConfig["id"] = "GROWTH";
const RANK: Record<string, number> = { FREE: 0, STARTER: 1, GROWTH: 2, PRO: 3 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Backend reconciles our stored plan with the Shopify subscription state.
  const { plan } = await apiGet(session.shop, "/api/v1/billing/plan");
  return json({ currentPlan: plan as string, plans: ORDERED_PLANS.map((id) => PLANS[id]) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/billing`;

  if (intent === "upgrade") {
    const plan = String(form.get("plan")); // STARTER | GROWTH | PRO
    try {
      const { url } = await apiPost(session.shop, "/api/v1/billing/checkout", { plan, returnUrl, interval: "monthly" });
      return json({ url });
    } catch (e) {
      return json({ error: billingError(e) });
    }
  }
  if (intent === "cancel") {
    try {
      await apiPost(session.shop, "/api/v1/billing/cancel");
      return json({ ok: true });
    } catch (e) {
      return json({ error: billingError(e) });
    }
  }
  return json({ error: "unknown" });
};

function billingError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/public distribution|Billing API/i.test(msg)) {
    return "Billing isn't available yet: Shopify enables charges once this app is published (public distribution). Everything else works in development — this is expected.";
  }
  return "Couldn't start checkout. Please try again.";
}

export default function BillingRoute() {
  const { currentPlan, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (data && "url" in data && data.url) window.open(data.url as string, "_top");
  }, [fetcher.data]);

  return (
    <Page>
      <TitleBar title="Plan & billing" />
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">Choose your plan</Text>
          <Text as="p" tone="subdued">
            Billed securely through Shopify — charges appear on your Shopify invoice.
            {isTest ? " (Test mode: no real charge.)" : ""}
          </Text>
        </BlockStack>

        {fetcher.data && "error" in fetcher.data && fetcher.data.error ? (
          <Banner tone="warning" title="Billing unavailable in development">
            <Text as="p">{fetcher.data.error}</Text>
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          {plans.map((p) => {
            const isCurrent = currentPlan === p.id;
            const popular = p.id === POPULAR;
            const isUpgrade = RANK[p.id] > (RANK[currentPlan] ?? 0);
            return (
              <Box
                key={p.id}
                background={popular ? "bg-surface-selected" : "bg-surface"}
                borderColor={isCurrent ? "border-emphasis" : "border"}
                borderWidth="025"
                borderRadius="300"
                padding="400"
                minHeight="100%"
              >
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">{p.name}</Text>
                    {isCurrent ? <Badge tone="success">Current</Badge> : popular ? <Badge tone="magic">Popular</Badge> : null}
                  </InlineStack>

                  <Text as="p" variant="heading2xl">
                    ${p.priceUsd}
                    {p.priceUsd > 0 ? <Text as="span" variant="bodySm" tone="subdued"> / mo</Text> : null}
                  </Text>

                  <Divider />

                  <BlockStack gap="150">
                    {planFeatureList(p).map((f) => (
                      <InlineStack key={f} gap="150" blockAlign="start" wrap={false}>
                        <Text as="span" tone="success">✓</Text>
                        <Text as="span">{f}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>

                  <Box>
                    {isCurrent ? (
                      <Button disabled fullWidth>Current plan</Button>
                    ) : p.id === "FREE" ? (
                      <Button fullWidth loading={busy} onClick={() => fetcher.submit({ intent: "cancel" }, { method: "post" })}>
                        Downgrade to Free
                      </Button>
                    ) : (
                      <Button
                        fullWidth
                        variant={popular ? "primary" : "secondary"}
                        loading={busy}
                        onClick={() => fetcher.submit({ intent: "upgrade", plan: p.id }, { method: "post" })}
                      >
                        {isUpgrade ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                      </Button>
                    )}
                  </Box>
                </BlockStack>
              </Box>
            );
          })}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
