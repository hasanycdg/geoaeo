// ShopifyAdminAdapter — PlatformPort backed by the Admin GraphQL API, authorized
// with the tenant's stored OFFLINE access token. Because it uses the offline
// token (not a live session), the worker and the headless API can both call it.
import type { Tenant } from "@geo/db";
import type { CatalogItem, PlatformPort, StoreProfile } from "@geo/core/ports";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl: string | null;
  description: string | null;
  productType: string | null;
  tags: string[];
}

const CATALOG_QUERY = `#graphql
  query LlmsTxtData {
    shop { name description primaryDomain { url } }
    products(first: 100, query: "status:active", sortKey: BEST_SELLING) {
      edges { node { id title handle onlineStoreUrl description productType tags } }
    }
  }`;

export class ShopifyAdminAdapter implements PlatformPort {
  readonly platform = "SHOPIFY" as const;

  /** @param accessToken offline Admin API token from TenantCredential.secret */
  constructor(private readonly accessToken: string) {}

  private async graphql<T>(shopDomain: string, query: string): Promise<T> {
    const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    return body.data as T;
  }

  private async fetchCatalog(tenant: Tenant) {
    return this.graphql<{
      shop?: { name?: string; description?: string; primaryDomain?: { url?: string } };
      products?: { edges?: { node: ShopifyProductNode }[] };
    }>(tenant.externalId, CATALOG_QUERY);
  }

  async getStoreProfile(tenant: Tenant): Promise<StoreProfile> {
    const data = await this.fetchCatalog(tenant);
    return {
      name: data.shop?.name ?? tenant.externalId,
      description: data.shop?.description ?? null,
      primaryUrl: data.shop?.primaryDomain?.url ?? `https://${tenant.externalId}`,
    };
  }

  async listProducts(tenant: Tenant): Promise<CatalogItem[]> {
    const data = await this.fetchCatalog(tenant);
    const base = (data.shop?.primaryDomain?.url ?? `https://${tenant.externalId}`).replace(/\/$/, "");
    return (data.products?.edges ?? []).map(({ node }) => ({
      externalId: node.id,
      title: node.title,
      handle: node.handle,
      description: node.description,
      url: node.onlineStoreUrl ?? `${base}/products/${node.handle}`,
      productType: node.productType,
      tags: node.tags ?? [],
    }));
  }

  async getRobotsTxt(tenant: Tenant): Promise<string | null> {
    return this.fetchUrl(`https://${tenant.externalId}/robots.txt`);
  }

  async fetchUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "GEO-Monitor/1.0" } });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  // Shopify serves llms.txt live through the app proxy (apps/shopify-app), which
  // reads Tenant.llmsTxt. Nothing to push from here.
}
