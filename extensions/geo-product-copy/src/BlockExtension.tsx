// Admin UI extension: a card on the native product-details page with a button
// that generates an AI-optimized (GEO) product description via the app backend
// (OpenAI) and applies it back to the product via the direct Admin GraphQL API.
//
// Read path: needs read_products. Write path (Apply): needs write_products.
import { useState } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Button,
  Text,
  TextArea,
  Banner,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.product-details.block.render";

export default reactExtension(TARGET, () => <GeoCopyBlock />);

interface Suggestion {
  description?: string;
  bullets?: string[];
  faqs?: { question: string; answer: string }[];
}

function GeoCopyBlock() {
  const { data, query, auth } = useApi(TARGET);
  const selected = (data as { selected?: { id?: string }[] }).selected ?? [];
  const productId = selected[0]?.id ?? "";

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [extras, setExtras] = useState("");

  async function generate() {
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const token = await auth.idToken();
      const res = await fetch("/api/geo-product-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) throw new Error(`Backend error ${res.status}`);
      const json = (await res.json()) as { suggestion?: Suggestion };
      const s = json.suggestion ?? {};
      setDescription(s.description ?? "");
      const bullets = (s.bullets ?? []).map((b) => `• ${b}`).join("\n");
      const faqs = (s.faqs ?? []).map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
      setExtras([bullets, faqs].filter(Boolean).join("\n\n"));
      setStatus("Generated — review/edit, then Apply.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setError(null);
    setStatus(null);
    setApplying(true);
    try {
      const res = await query<{ productUpdate?: { userErrors?: { message: string }[] } }>(
        `mutation GeoUpdateDescription($id: ID!, $desc: String!) {
          productUpdate(input: { id: $id, descriptionHtml: $desc }) {
            product { id }
            userErrors { field message }
          }
        }`,
        { variables: { id: productId, desc: description } },
      );
      const userErrors = res.data?.productUpdate?.userErrors ?? [];
      if (res.errors?.length) throw new Error(res.errors[0].message);
      if (userErrors.length) throw new Error(userErrors[0].message);
      setStatus("Applied to product ✔ — reload the page to see it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <AdminBlock title="GEO — AI product copy">
      <BlockStack gap>
        <Text>
          Generate an AI-optimized, conversational description so assistants like ChatGPT can
          confidently recommend this product.
        </Text>

        {error && (
          <Banner tone="critical" title="Something went wrong">
            <Text>{error}</Text>
          </Banner>
        )}
        {status && (
          <Banner tone="success">
            <Text>{status}</Text>
          </Banner>
        )}

        <InlineStack gap>
          <Button onClick={generate} disabled={loading || !productId}>
            {loading ? "Generating…" : "Generate AI description"}
          </Button>
          {description ? (
            <Button variant="primary" onClick={apply} disabled={applying}>
              {applying ? "Applying…" : "Apply to product"}
            </Button>
          ) : null}
        </InlineStack>

        {description ? (
          <TextArea label="Optimized description" value={description} onChange={setDescription} rows={6} />
        ) : null}
        {extras ? (
          <TextArea
            label="Bullets & FAQ (paste where you like)"
            value={extras}
            onChange={setExtras}
            rows={8}
          />
        ) : null}
      </BlockStack>
    </AdminBlock>
  );
}
