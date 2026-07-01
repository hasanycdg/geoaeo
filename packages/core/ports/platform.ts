// PlatformPort — how the core reads store data and writes back to a storefront,
// abstracted over Shopify vs WordPress. Implementations live in apps/api/adapters/platform.
//
// The core calls ONLY this interface for catalog/site access. No adapter here
// may leak an SDK type into the core — inputs/outputs are plain domain shapes.
import type { Tenant } from "../domain/tenant";

/** A catalog entry, normalized across Shopify products and WooCommerce/WP items. */
export interface CatalogItem {
  /** Platform-native id: Shopify product GID, or WP post/product id as string. */
  externalId: string;
  title: string;
  handle: string | null;
  description: string | null;
  url: string;
  /** Category/type used to group the catalog (Shopify productType, WP category). */
  productType: string | null;
  tags: string[];
}

/** Store-level identity, used to head the generated llms.txt. */
export interface StoreProfile {
  name: string;
  description: string | null;
  primaryUrl: string;
}

export interface PlatformPort {
  readonly platform: Tenant["platform"];

  /** Store name/description/URL for the llms.txt header. */
  getStoreProfile(tenant: Tenant): Promise<StoreProfile>;

  /** Pull the tenant's product catalog (used for llms.txt + product-mention matching). */
  listProducts(tenant: Tenant): Promise<CatalogItem[]>;

  /** Fetch the live robots.txt of the tenant's storefront (Action-Layer audit). */
  getRobotsTxt(tenant: Tenant): Promise<string | null>;

  /**
   * Fetch a storefront URL's raw HTML (schema/JSON-LD audit).
   * Returns null when the resource is unreachable.
   */
  fetchUrl(url: string): Promise<string | null>;

  /**
   * Publish a generated llms.txt. Optional: Shopify serves it via app proxy,
   * WordPress writes a physical file / virtual route. Undefined ⇒ unsupported.
   */
  publishLlmsTxt?(tenant: Tenant, body: string): Promise<void>;
}
