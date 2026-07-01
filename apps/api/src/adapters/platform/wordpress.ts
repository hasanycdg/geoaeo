// WordpressPushAdapter — PlatformPort for WordPress in the PUSH model.
//
// The plugin runs inside WordPress (full local access) and pushes the store
// profile + catalog to the backend (POST /api/v1/wp/sync), cached on the Tenant.
// This adapter reads that cache instead of calling the WP REST API, so it works
// even on hosts that block /wp-json externally (managed WP, security plugins).
//
// Only genuinely public resources (robots.txt, a product page's HTML for the
// schema audit) are still fetched directly — those are reachable everywhere.
import type { Tenant } from "@geo/db";
import type { CatalogItem, PlatformPort, StoreProfile } from "@geo/core/ports";

interface CachedStoreProfile {
  name?: string;
  description?: string | null;
  primaryUrl?: string;
}

export class WordpressRestAdapter implements PlatformPort {
  readonly platform = "WORDPRESS" as const;
  private readonly base: string;

  constructor(private readonly tenant: Tenant) {
    this.base = tenant.externalId.replace(/\/$/, "");
  }

  async getStoreProfile(tenant: Tenant): Promise<StoreProfile> {
    const p = (tenant.storeProfile as CachedStoreProfile | null) ?? {};
    return {
      name: p.name ?? tenant.brandName ?? tenant.externalId,
      description: p.description ?? null,
      primaryUrl: p.primaryUrl ?? this.base,
    };
  }

  async listProducts(tenant: Tenant): Promise<CatalogItem[]> {
    const catalog = tenant.catalog as CatalogItem[] | null;
    return Array.isArray(catalog) ? catalog : [];
  }

  async getRobotsTxt(): Promise<string | null> {
    return this.fetchUrl(`${this.base}/robots.txt`);
  }

  /** Public page fetch (schema/JSON-LD audit). Public URLs are reachable even
   *  when /wp-json is locked down, so this stays a direct fetch. */
  async fetchUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          // Browser-like UA so hardened hosts / WAFs don't 403 the request.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        redirect: "follow",
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  // No publishLlmsTxt: the plugin PULLS the generated llms.txt from the backend
  // (GET /api/v1/content/llms-txt) and serves it, so the backend never pushes.
}
