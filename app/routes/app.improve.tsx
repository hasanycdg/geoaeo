import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiGet, apiPost, apiPatch } from "../geo/backend.server";
import type { Recommendation } from "@geo/db";

const SEV_TONE: Record<number, "critical" | "warning" | "info"> = { 1: "critical", 2: "warning", 3: "info" };
const SEV_LABEL: Record<number, string> = { 1: "Critical", 2: "Important", 3: "Info" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [info, recs] = await Promise.all([
    apiGet(session.shop, "/api/v1/tenant"),
    apiGet(session.shop, "/api/v1/recommendations"),
  ]);
  return json({
    recommendations: recs.recommendations as Recommendation[],
    domain: info.tenant.primaryDomain || info.tenant.externalId,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "run-audit") {
    const summary = await apiPost(session.shop, "/api/v1/audit");
    return json({ ok: true, summary });
  }

  if (intent === "set-status") {
    await apiPatch(session.shop, `/api/v1/recommendations/${encodeURIComponent(String(form.get("id")))}`, {
      status: String(form.get("status")),
    });
    return json({ ok: true });
  }

  return json({ error: "unknown" }, { status: 400 });
};

export default function Improve() {
  const { recommendations, domain } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "ok" in fetcher.data && "summary" in fetcher.data) {
      shopify.toast.show("Audit complete");
    }
  }, [fetcher.data, shopify]);

  const open = recommendations.filter((r) => r.status === "OPEN");
  const done = recommendations.filter((r) => r.status === "DONE");

  return (
    <Page>
      <TitleBar title="AI Readiness" />
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h1" variant="headingLg">AI Readiness</Text>
          <Text as="p" tone="subdued">
            Technical checks that decide whether AI engines can read and recommend your store — with concrete fixes.
          </Text>
        </BlockStack>

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Technical AI-readiness audit</Text>
              <Text as="p" tone="subdued">Checks {domain} for blocked AI crawlers and missing product structured data.</Text>
            </BlockStack>
            <Button variant="primary" loading={busy} onClick={() => fetcher.submit({ intent: "run-audit" }, { method: "post" })}>
              Run audit
            </Button>
          </InlineStack>
        </Card>

        {recommendations.length === 0 ? (
          <Card>
            <EmptyState heading="No audit yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>Run the audit to find concrete, fixable issues that hurt your AI visibility.</p>
            </EmptyState>
          </Card>
        ) : (
          <>
            {open.length === 0 && (
              <Banner tone="success">No open issues — your store is AI-readable. 🎉</Banner>
            )}
            {open.map((r) => (
              <Card key={r.id}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={SEV_TONE[r.severity]}>{SEV_LABEL[r.severity]}</Badge>
                      <Text as="h3" variant="headingSm">{r.title}</Text>
                    </InlineStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => fetcher.submit({ intent: "set-status", id: r.id, status: "DONE" }, { method: "post" })}>Mark done</Button>
                      <Button variant="plain" tone="critical" onClick={() => fetcher.submit({ intent: "set-status", id: r.id, status: "DISMISSED" }, { method: "post" })}>Dismiss</Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p">{r.detail}</Text>
                </BlockStack>
              </Card>
            ))}
            {done.length > 0 && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">Done</Text>
                  {done.map((r) => (
                    <InlineStack key={r.id} align="space-between">
                      <Text as="span" tone="subdued">{r.title}</Text>
                      <Button variant="plain" onClick={() => fetcher.submit({ intent: "set-status", id: r.id, status: "OPEN" }, { method: "post" })}>Reopen</Button>
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
