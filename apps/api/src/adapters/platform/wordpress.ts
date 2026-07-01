// WordpressRestAdapter — PlatformPort backed by the WordPress REST API,
// authorized with an Application Password (Basic auth) issued to the plugin.
// Products come from WooCommerce (/wc/v3/products) when present; otherwise the
// adapter falls back to standard posts so llms.txt still has content.
import type { Tenant } from "@geo/db";
import type { CatalogItem, PlatformPort, StoreProfile } from "@geo/core/ports";

export interface WordpressCredential {
  /** WP username the application password belongs to. */
  username: string;
  /** The application password (spaces allowed; sent as-is in Basic auth). */
  appPassword: string;
}

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  description: string;
  short_description: string;
  categories?: { name: string }[];
  tags?: { name: string }[];
}

interface WpPost {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
}

export class WordpressRestAdapter implements PlatformPort {
  readonly platform = "WORDPRESS" as const;
  private readonly base: string;

  constructor(
    tenant: Tenant,
    private readonly cred: WordpressCredential,
  ) {
    this.base = tenant.externalId.replace(/\/$/, "");
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.cred.username}:${this.cred.appPassword}`).toString("base64");
    return `Basic ${token}`;
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: this.authHeader(), "User-Agent": "GEO-Monitor/1.0" },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async getStoreProfile(tenant: Tenant): Promise<StoreProfile> {
    const info = await this.get<{ name?: string; description?: string; url?: string }>("/wp-json");
    return {
      name: info?.name ?? tenant.externalId,
      description: info?.description ?? null,
      primaryUrl: info?.url ?? this.base,
    };
  }

  async listProducts(): Promise<CatalogItem[]> {
    // Prefer WooCommerce products.
    const woo = await this.get<WooProduct[]>("/wp-json/wc/v3/products?per_page=100&status=publish");
    if (woo && woo.length) {
      return woo.map((p) => ({
        externalId: String(p.id),
        title: p.name,
        handle: p.slug,
        description: p.description || p.short_description || null,
        url: p.permalink,
        productType: p.categories?.[0]?.name ?? null,
        tags: (p.tags ?? []).map((t) => t.name),
      }));
    }
    // Fallback: standard posts.
    const posts = await this.get<WpPost[]>("/wp-json/wp/v2/posts?per_page=100&status=publish");
    return (posts ?? []).map((p) => ({
      externalId: String(p.id),
      title: p.title.rendered,
      handle: p.slug,
      description: p.excerpt.rendered.replace(/<[^>]*>/g, " ").trim() || null,
      url: p.link,
      productType: null,
      tags: [],
    }));
  }

  async getRobotsTxt(): Promise<string | null> {
    return this.fetchUrl(`${this.base}/robots.txt`);
  }

  async fetchUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "GEO-Monitor/1.0" } });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  /** Push llms.txt to the plugin, which writes it to the site root. */
  async publishLlmsTxt(_tenant: Tenant, body: string): Promise<void> {
    await fetch(`${this.base}/wp-json/geo-monitor/v1/llms-txt`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
        "User-Agent": "GEO-Monitor/1.0",
      },
      body: JSON.stringify({ content: body }),
    });
  }
}
