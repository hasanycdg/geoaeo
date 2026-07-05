import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Text,
  Badge,
  Banner,
  FormLayout,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { apiDelete, apiGet, apiPost } from "../geo/backend.server";
import type { TenantWithConfig } from "@geo/core/models";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const info = await apiGet(session.shop, "/api/v1/tenant");
  return json({ shop: info.tenant as TenantWithConfig, plan: info.limits });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const shop = session.shop;

  try {
    switch (intent) {
      case "save-brand": {
        const brandName = String(form.get("brandName") || "").trim();
        const brandAliases = String(form.get("brandAliases") || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const primaryDomain = String(form.get("primaryDomain") || "").trim();
        await apiPost(shop, "/api/v1/tenant", { brandName, brandAliases, primaryDomain });
        return json({ ok: true });
      }
      case "add-prompt": {
        const text = String(form.get("text") || "").trim();
        if (!text) return json({ error: "Prompt text is required." }, { status: 400 });
        await apiPost(shop, "/api/v1/prompts", {
          text,
          locale: String(form.get("locale") || "en-US"),
          country: String(form.get("country") || "US"),
        });
        return json({ ok: true });
      }
      case "delete-prompt": {
        await apiDelete(shop, `/api/v1/prompts/${encodeURIComponent(String(form.get("id")))}`);
        return json({ ok: true });
      }
      case "add-competitor": {
        const name = String(form.get("name") || "").trim();
        if (!name) return json({ error: "Competitor name is required." }, { status: 400 });
        await apiPost(shop, "/api/v1/competitors", {
          name,
          aliases: String(form.get("aliases") || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        });
        return json({ ok: true });
      }
      case "delete-competitor": {
        await apiDelete(shop, `/api/v1/competitors/${encodeURIComponent(String(form.get("id")))}`);
        return json({ ok: true });
      }
      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Request failed" }, { status: 400 });
  }
};

export default function SettingsRoute() {
  const { shop, plan } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [brandName, setBrandName] = useState(shop.brandName ?? "");
  const [brandAliases, setBrandAliases] = useState(shop.brandAliases.join(", "));
  const [primaryDomain, setPrimaryDomain] = useState(shop.primaryDomain ?? "");
  const [promptText, setPromptText] = useState("");
  const [competitorName, setCompetitorName] = useState("");

  const post = (data: Record<string, string>) => submit(data, { method: "post" });

  return (
    <Page>
      <TitleBar title="Setup" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Your brand</Text>
            <Text as="p" tone="subdued">
              We detect this name in AI answers. Add alternate spellings so we don't miss mentions.
            </Text>
            <FormLayout>
              <TextField label="Brand name" autoComplete="off" value={brandName} onChange={setBrandName} />
              <TextField
                label="Aliases (comma-separated)"
                autoComplete="off"
                value={brandAliases}
                onChange={setBrandAliases}
                helpText="e.g. North Peak, NorthPeak Nutrition"
              />
              <TextField
                label="Your store domain"
                autoComplete="off"
                value={primaryDomain}
                onChange={setPrimaryDomain}
                helpText="Used to tell your own citations from third-party ones."
              />
              <Button
                variant="primary"
                loading={busy}
                onClick={() => post({ intent: "save-brand", brandName, brandAliases, primaryDomain })}
              >
                Save brand
              </Button>
            </FormLayout>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Tracked prompts</Text>
              <Badge>{`${shop.prompts.length} / ${plan.maxPrompts}`}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">
              The questions buyers ask AI assistants, e.g. "best vegan protein powder".
            </Text>
            <BlockStack gap="200">
              {shop.prompts.map((p) => (
                <InlineStack key={p.id} align="space-between" blockAlign="center">
                  <Text as="span">{p.text} <Text as="span" tone="subdued">({p.locale})</Text></Text>
                  <Button
                    tone="critical"
                    variant="plain"
                    onClick={() => post({ intent: "delete-prompt", id: p.id })}
                  >
                    Remove
                  </Button>
                </InlineStack>
              ))}
              {shop.prompts.length === 0 && <Text as="p" tone="subdued">No prompts yet.</Text>}
            </BlockStack>
            <Divider />
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Add a prompt"
                  labelHidden
                  autoComplete="off"
                  placeholder="best vegan protein powder"
                  value={promptText}
                  onChange={setPromptText}
                  disabled={shop.prompts.length >= plan.maxPrompts}
                />
              </div>
              <Button
                loading={busy}
                disabled={!promptText.trim() || shop.prompts.length >= plan.maxPrompts}
                onClick={() => {
                  post({ intent: "add-prompt", text: promptText });
                  setPromptText("");
                }}
              >
                Add
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Competitors</Text>
              <Badge>{`${shop.competitors.length} / ${plan.maxCompetitors}`}</Badge>
            </InlineStack>
            <BlockStack gap="200">
              {shop.competitors.map((c) => (
                <InlineStack key={c.id} align="space-between" blockAlign="center">
                  <Text as="span">{c.name}</Text>
                  <Button
                    tone="critical"
                    variant="plain"
                    onClick={() => post({ intent: "delete-competitor", id: c.id })}
                  >
                    Remove
                  </Button>
                </InlineStack>
              ))}
              {shop.competitors.length === 0 && <Text as="p" tone="subdued">No competitors yet.</Text>}
            </BlockStack>
            <Divider />
            <InlineStack gap="200" blockAlign="end">
              <div style={{ flex: 1 }}>
                <TextField
                  label="Add a competitor"
                  labelHidden
                  autoComplete="off"
                  placeholder="VeganVit"
                  value={competitorName}
                  onChange={setCompetitorName}
                  disabled={shop.competitors.length >= plan.maxCompetitors}
                />
              </div>
              <Button
                loading={busy}
                disabled={!competitorName.trim() || shop.competitors.length >= plan.maxCompetitors}
                onClick={() => {
                  post({ intent: "add-competitor", name: competitorName });
                  setCompetitorName("");
                }}
              >
                Add
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Banner tone="info">
          We measure AI visibility through provider APIs with web search enabled. Results are a close
          approximation of what shoppers see in ChatGPT, Claude, Gemini and Perplexity — not an exact
          mirror. AI answers are non-deterministic, so we query each prompt {plan.repetitions}× and report rates.
        </Banner>
      </BlockStack>
    </Page>
  );
}
