import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";

// Billing plan key — must match a Plan in app/config/plans.ts.
// FREE has no charge, so only the paid tier is declared here.
export const STARTER_PLAN = "STARTER" as const;
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { provisionShopifyTenant } from "./geo/provision.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    // shopify-api v13 uses the lineItems shape for recurring subscriptions.
    [STARTER_PLAN]: {
      lineItems: [
        {
          amount: 29,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  hooks: {
    // Provision the shared tenant + persist the offline token so the headless
    // API and worker can call Admin GraphQL for this shop without a session.
    afterAuth: async ({ session }) => {
      await shopify.registerWebhooks({ session });
      if (!session.isOnline && session.accessToken) {
        await provisionShopifyTenant(session.shop, session.accessToken);
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
