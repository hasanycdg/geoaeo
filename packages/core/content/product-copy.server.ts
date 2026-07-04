// Product copy suggestions: rewrite product descriptions for conversational /
// long-tail AI queries (natural language a shopper would ask an assistant),
// not keyword-stuffed SEO. Uses the cheap analysis model; falls back to a
// deterministic template when no API key is configured.
//
// Platform-agnostic: product selection/detail is supplied by the PlatformPort
// (as CatalogItem); this module only turns a product into rewritten copy.
import { openaiJson } from "../providers/analysis-llm.server";
import type { CatalogItem } from "../ports";

export interface ProductDetail {
  id: string;
  title: string;
  description: string;
  productType: string;
  tags: string[];
}

export interface CopySuggestion {
  description: string;
  bullets: string[];
  faqs: { question: string; answer: string }[];
  source: "llm" | "template";
}

/** Normalize a PlatformPort CatalogItem into the copy-generation input. */
export function toProductDetail(item: CatalogItem): ProductDetail {
  return {
    id: item.externalId,
    title: item.title,
    description: item.description ?? "",
    productType: item.productType ?? "",
    tags: item.tags ?? [],
  };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    faqs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
      },
    },
  },
  required: ["description", "bullets", "faqs"],
} as const;

export async function suggestProductCopy(product: ProductDetail): Promise<CopySuggestion> {
  const parsed = await openaiJson<Omit<CopySuggestion, "source">>({
    schemaName: "product_copy",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
    system:
      "You rewrite e-commerce product copy so AI assistants (ChatGPT, Claude, " +
      "Gemini, Perplexity) can confidently recommend it for natural, " +
      "conversational shopper questions. Write in plain natural language a " +
      "person would say — NOT keyword-stuffed SEO. Answer the questions a " +
      "buyer would actually ask. Be specific and concrete; never invent facts " +
      "not implied by the input. Return strict JSON: a rewritten `description` " +
      "(2-4 sentences), 3-5 scannable `bullets`, and 3 `faqs`.",
    user:
      `Title: ${product.title}\n` +
      `Type: ${product.productType || "(none)"}\n` +
      `Tags: ${product.tags.join(", ") || "(none)"}\n\n` +
      `Current description:\n"""${product.description.replace(/<[^>]*>/g, " ").slice(0, 3000)}"""`,
  });
  return parsed ? { ...parsed, source: "llm" } : templateSuggestion(product);
}

function templateSuggestion(product: ProductDetail): CopySuggestion {
  const t = product.title;
  const kind = product.productType || "product";
  return {
    description:
      `${t} is a ${kind.toLowerCase()} designed for everyday use. ` +
      `Here's what it is, who it's for, and why shoppers choose it — written in plain language. ` +
      `(Add an API key to generate AI-written suggestions tailored to this product.)`,
    bullets: [
      `What ${t} is and what it's best for`,
      `Key features in plain language`,
      `Who it's a good fit for`,
    ],
    faqs: [
      { question: `What is ${t}?`, answer: `A ${kind.toLowerCase()} — describe its main benefit in one sentence.` },
      { question: `Who is ${t} for?`, answer: `Describe the ideal customer and use case.` },
      { question: `How does ${t} compare to alternatives?`, answer: `Note one concrete differentiator.` },
    ],
    source: "template",
  };
}
