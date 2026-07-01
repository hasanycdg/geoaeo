// Composition root for the adapter layer. Given a tenant, resolve the correct
// PlatformPort + BillingPort for its platform, loading credentials from the DB.
// The rest of apps/api programs against the ports, never the concrete adapters.
import type { Tenant } from "@geo/db";
import { prisma } from "@geo/db";
import type { BillingPort, PlatformPort } from "@geo/core/ports";
import { ShopifyAdminAdapter } from "./platform/shopify";
import { WordpressRestAdapter } from "./platform/wordpress";
import { ShopifyBillingAdapter } from "./billing/shopify";
import { StripeBillingAdapter } from "./billing/stripe";

export interface Adapters {
  platform: PlatformPort;
  billing: BillingPort;
}

async function loadSecret(tenantId: string): Promise<string> {
  const cred = await prisma.tenantCredential.findUnique({ where: { tenantId } });
  if (!cred) throw new Error(`No credential stored for tenant ${tenantId}`);
  return cred.secret;
}

/** Resolve the adapter pair for a tenant. Credentials are loaded per call. */
export async function adaptersFor(tenant: Tenant): Promise<Adapters> {
  switch (tenant.platform) {
    case "SHOPIFY": {
      const token = await loadSecret(tenant.id);
      return {
        platform: new ShopifyAdminAdapter(token),
        billing: new ShopifyBillingAdapter(token),
      };
    }
    case "WORDPRESS": {
      // Push model: the adapter reads catalog/profile cached on the tenant (pushed
      // by the plugin), so no stored WP credential is needed here.
      return {
        platform: new WordpressRestAdapter(tenant),
        billing: new StripeBillingAdapter(),
      };
    }
    default: {
      const _exhaustive: never = tenant.platform;
      throw new Error(`Unsupported platform: ${_exhaustive}`);
    }
  }
}

/** Billing-only resolver for webhook routes (no tenant loaded yet). */
export function billingForPlatform(platform: Tenant["platform"], accessToken?: string): BillingPort {
  if (platform === "SHOPIFY") {
    if (!accessToken) throw new Error("Shopify billing webhook requires an access token");
    return new ShopifyBillingAdapter(accessToken);
  }
  return new StripeBillingAdapter();
}
