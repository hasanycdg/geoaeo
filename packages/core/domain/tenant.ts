// Platform-neutral tenant identity. Replaces the Shopify-specific `Shop` concept
// throughout the core. A tenant is "one installed site" regardless of whether it
// runs on Shopify, WordPress, or a future platform.
//
// The core NEVER imports @prisma/client for this — persistence maps the DB row
// onto this shape at the edge (in packages/db), so core logic stays free of the
// ORM and of any platform SDK.

export type Platform = "SHOPIFY" | "WORDPRESS";

export type Plan = "FREE" | "STARTER" | "GROWTH" | "PRO";

export interface Tenant {
  id: string;
  platform: Platform;
  /**
   * Stable external identity within the platform:
   *  - SHOPIFY:   the myshopify domain, e.g. "foo.myshopify.com"
   *  - WORDPRESS: the site URL, e.g. "https://shop.example.com"
   */
  externalId: string;

  plan: Plan;

  /**
   * Opaque billing reference, interpreted only by the matching BillingPort:
   *  - SHOPIFY:   AppSubscription GID ("gid://shopify/AppSubscription/123")
   *  - WORDPRESS: Stripe subscription id ("sub_...")
   */
  billingRef: string | null;
  /** Stripe customer id ("cus_..."). Null on platforms with managed billing (Shopify). */
  billingCustomerId: string | null;

  // Brand identity used to detect the tenant's brand in LLM answers.
  brandName: string | null;
  brandAliases: string[];
  primaryDomain: string | null;

  // Defaults applied to newly tracked prompts.
  defaultLocale: string;
  defaultCountry: string;

  // Usage accounting for quota throttling.
  usageQueriesThisPeriod: number;
  usagePeriodStart: Date;
}
