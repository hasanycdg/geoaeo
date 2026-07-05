// Site-level AI-readiness checks beyond robots.txt + product schema:
//   - homepage meta description + Open Graph tags (AI/social previews)
//   - sitemap.xml reachable (helps crawlers discover the catalog)
// Pure HTML parser (testable) + a fetch wrapper. Never throws.

const UA = { "user-agent": "GEO-Monitor-Audit/1.0" };

export interface WebAudit {
  reachable: boolean;
  hasMetaDescription: boolean;
  hasOpenGraph: boolean;
  sitemapReachable: boolean;
  error?: string;
}

/** Detect a non-empty meta description + any Open Graph tag in homepage HTML. */
export function auditHomepageHtml(html: string): { hasMetaDescription: boolean; hasOpenGraph: boolean } {
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const hasMetaDescription = !!desc && desc[1].trim().length > 0;
  const hasOpenGraph = /<meta[^>]+property=["']og:(title|description|image)["']/i.test(html);
  return { hasMetaDescription, hasOpenGraph };
}

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: UA });
    return r.ok;
  } catch {
    return false;
  }
}

export async function auditWeb(domain: string): Promise<WebAudit> {
  const base = domain.includes("://") ? domain.replace(/\/$/, "") : `https://${domain}`;
  try {
    const resp = await fetch(base, { redirect: "follow", headers: UA });
    if (!resp.ok) {
      return { reachable: false, hasMetaDescription: false, hasOpenGraph: false, sitemapReachable: false, error: `HTTP ${resp.status}` };
    }
    const html = await resp.text();
    const { hasMetaDescription, hasOpenGraph } = auditHomepageHtml(html);
    const sitemapReachable = await reachable(`${base}/sitemap.xml`);
    return { reachable: true, hasMetaDescription, hasOpenGraph, sitemapReachable };
  } catch (err) {
    return {
      reachable: false,
      hasMetaDescription: false,
      hasOpenGraph: false,
      sitemapReachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
