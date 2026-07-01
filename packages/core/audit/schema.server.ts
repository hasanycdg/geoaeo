// JSON-LD / structured-data audit. LLMs lean heavily on structured data to
// understand products. Missing Product/Offer/Review/AggregateRating markup is
// a concrete, fixable reason a store underperforms in AI answers.
// Pure extractor (testable) + a fetch wrapper.

// Important types for an e-commerce product page, in priority order.
export const IMPORTANT_TYPES = ["Product", "Offer", "AggregateRating", "Review"] as const;
export const BONUS_TYPES = ["FAQPage", "BreadcrumbList", "Organization"] as const;

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Recursively collect every @type string from a JSON-LD value. */
function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);
    for (const v of Object.values(obj)) collectTypes(v, out);
  }
}

export function extractJsonLdTypes(html: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = JSONLD_RE.exec(html)) !== null) {
    try {
      collectTypes(JSON.parse(m[1].trim()), found);
    } catch {
      // Malformed JSON-LD block — skip; we report what parses.
    }
  }
  return [...found];
}

export interface SchemaAudit {
  reachable: boolean;
  found: string[];
  missingImportant: string[];
  error?: string;
}

export function auditSchemaHtml(html: string): Omit<SchemaAudit, "reachable" | "error"> {
  const found = extractJsonLdTypes(html);
  const lc = new Set(found.map((t) => t.toLowerCase()));
  const missingImportant = IMPORTANT_TYPES.filter((t) => !lc.has(t.toLowerCase()));
  return { found, missingImportant };
}

export async function auditSchema(url: string): Promise<SchemaAudit> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "GEO-Monitor-Audit/1.0" },
    });
    if (!resp.ok) return { reachable: false, found: [], missingImportant: [], error: `HTTP ${resp.status}` };
    return { reachable: true, ...auditSchemaHtml(await resp.text()) };
  } catch (err) {
    return {
      reachable: false,
      found: [],
      missingImportant: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
