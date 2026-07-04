// Rules-first brand extraction from an AI answer — NO LLM (cost control).
// AI answers reliably **bold** the brand/product names they recommend and cite
// source domains; we harvest both. Returns brands in order of first appearance
// so the caller can derive a position rank cheaply.
import type { DetectedBrand } from "./types";

export function normalizeBrand(s: string): string {
  return s
    .replace(/\*/g, "")
    .replace(/[^\p{L}\p{N}&.\- ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Extract candidate competitor brands from one answer, in appearance order. */
export function extractBrandsFromAnswer(
  text: string,
  citations: { url: string }[],
  ownTerms: string[],
  ownDomains: string[] = [],
): DetectedBrand[] {
  const own = new Set(ownTerms.map((t) => t.toLowerCase()).filter(Boolean));
  const ownSlugs = new Set([...ownTerms, ...ownDomains].map(slug).filter(Boolean));
  const domains = citations.map((c) => hostOf(c.url)).filter((d): d is string => !!d);

  const ordered: DetectedBrand[] = [];
  const seen = new Set<string>();

  // Bolded names, in order of appearance.
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) {
    const name = normalizeBrand(m[1]);
    if (!name) continue;
    const words = name.split(" ").length;
    if (words > 4) continue; // long phrases aren't brand names
    const key = name.toLowerCase();
    if (own.has(key) || ownSlugs.has(slug(name)) || seen.has(key)) continue;
    seen.add(key);
    const s = slug(name).slice(0, Math.max(4, slug(name).length));
    const domain = domains.find((d) => slug(d).includes(s)) ?? null;
    ordered.push({ name, domain });
  }

  // Cited domains with no bold match → domain-only brands.
  for (const d of domains) {
    const root = d.split(".")[0];
    if (!root || ownSlugs.has(slug(d)) || ownSlugs.has(slug(root)) || own.has(root)) continue;
    if (ordered.some((b) => b.domain === d || slug(b.name) === slug(root))) continue;
    const key = root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push({ name: root, domain: d });
  }

  return ordered;
}
