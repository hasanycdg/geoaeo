// ShopifyBillingAdapter — BillingPort for Shopify tenants using Shopify Managed
// Billing via the Admin GraphQL API + the tenant's OFFLINE token. Subscription
// `name` is set to the Plan id so we can map it back without extra storage.
import crypto from "node:crypto";
import type { Plan, Tenant } from "@geo/db";
import type { BillingPort, BillingSyncResult, CheckoutSession } from "@geo/core/ports";
import { planConfig } from "@geo/core/config/plans";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const PLAN_NAMES: Plan[] = ["STARTER", "GROWTH", "PRO"];

function planForName(name: string | undefined): Plan {
  return (PLAN_NAMES as string[]).includes(name ?? "") ? (name as Plan) : "FREE";
}

export class ShopifyBillingAdapter implements BillingPort {
  readonly platform = "SHOPIFY" as const;

  constructor(private readonly accessToken: string) {}

  private async graphql<T>(shop: string, query: string, variables?: unknown): Promise<T> {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify Billing API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (body.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    return body.data as T;
  }

  async createCheckout(tenant: Tenant, plan: Plan, returnUrl: string): Promise<CheckoutSession> {
    const cfg = planConfig(plan);
    const isTest = process.env.SHOPIFY_BILLING_TEST === "true";
    const mutation = `#graphql
      mutation Create($name: String!, $returnUrl: URL!, $amount: Decimal!, $test: Boolean!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          lineItems: [{
            plan: { appRecurringPricingDetails: { price: { amount: $amount, currencyCode: USD }, interval: EVERY_30_DAYS } }
          }]
        ) {
          confirmationUrl
          appSubscription { id }
          userErrors { field message }
        }
      }`;
    const data = await this.graphql<{
      appSubscriptionCreate: {
        confirmationUrl: string | null;
        appSubscription: { id: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(tenant.externalId, mutation, {
      name: plan,
      returnUrl,
      amount: cfg.priceUsd.toFixed(2),
      test: isTest,
    });
    const r = data.appSubscriptionCreate;
    if (r.userErrors.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
    return { url: r.confirmationUrl ?? "", ref: r.appSubscription?.id };
  }

  async getActivePlan(tenant: Tenant): Promise<Plan> {
    const data = await this.graphql<{
      currentAppInstallation: { activeSubscriptions: { name: string; status: string }[] };
    }>(tenant.externalId, `#graphql
      query { currentAppInstallation { activeSubscriptions { name status } } }`);
    const active = data.currentAppInstallation.activeSubscriptions.find((s) => s.status === "ACTIVE");
    return planForName(active?.name);
  }

  async handleWebhook(request: Request): Promise<BillingSyncResult | null> {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) throw new Error("SHOPIFY_API_SECRET is not set");
    const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
    const shop = request.headers.get("x-shopify-shop-domain") ?? "";
    const raw = await request.text();

    const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))) {
      throw new Error("Invalid Shopify webhook HMAC");
    }

    const payload = JSON.parse(raw) as { app_subscription?: { name?: string; status?: string; admin_graphql_api_id?: string } };
    const sub = payload.app_subscription;
    if (!sub || !shop) return null;
    const active = sub.status === "ACTIVE";
    return {
      tenantExternalId: shop,
      plan: active ? planForName(sub.name) : "FREE",
      billingRef: active ? sub.admin_graphql_api_id ?? null : null,
    };
  }

  async cancel(tenant: Tenant): Promise<void> {
    if (!tenant.billingRef) return;
    await this.graphql(tenant.externalId, `#graphql
      mutation Cancel($id: ID!) {
        appSubscriptionCancel(id: $id) { userErrors { message } }
      }`, { id: tenant.billingRef });
  }
}
