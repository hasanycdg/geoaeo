// StripeBillingAdapter — BillingPort for WordPress tenants. Uses Stripe
// Checkout for upgrades and the webhook for authoritative plan sync.
//
// Plan ⇄ price mapping lives in env so prices can change without a deploy:
//   STRIPE_PRICE_STARTER / _GROWTH / _PRO  (price_… ids)
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
import Stripe from "stripe";
import type { Plan, Tenant } from "@geo/db";
import type { BillingPort, BillingSyncResult, CheckoutSession } from "@geo/core/ports";

function priceForPlan(plan: Plan): string {
  const map: Record<Plan, string | undefined> = {
    FREE: undefined,
    STARTER: process.env.STRIPE_PRICE_STARTER,
    GROWTH: process.env.STRIPE_PRICE_GROWTH,
    PRO: process.env.STRIPE_PRICE_PRO,
  };
  const price = map[plan];
  if (!price) throw new Error(`No Stripe price configured for plan ${plan}`);
  return price;
}

function planForPrice(priceId: string | undefined): Plan {
  switch (priceId) {
    case process.env.STRIPE_PRICE_STARTER:
      return "STARTER";
    case process.env.STRIPE_PRICE_GROWTH:
      return "GROWTH";
    case process.env.STRIPE_PRICE_PRO:
      return "PRO";
    default:
      return "FREE";
  }
}

export class StripeBillingAdapter implements BillingPort {
  readonly platform = "WORDPRESS" as const;
  private readonly stripe: Stripe;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    this.stripe = new Stripe(key);
  }

  async createCheckout(tenant: Tenant, plan: Plan, returnUrl: string): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceForPlan(plan), quantity: 1 }],
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
      client_reference_id: tenant.externalId,
      customer: tenant.billingCustomerId ?? undefined,
      metadata: { tenantId: tenant.id, tenantExternalId: tenant.externalId },
      subscription_data: { metadata: { tenantExternalId: tenant.externalId } },
    });
    return { url: session.url ?? "", ref: session.id };
  }

  async getActivePlan(tenant: Tenant): Promise<Plan> {
    if (!tenant.billingRef) return "FREE";
    try {
      const sub = await this.stripe.subscriptions.retrieve(tenant.billingRef);
      if (sub.status !== "active" && sub.status !== "trialing") return "FREE";
      return planForPrice(sub.items.data[0]?.price.id);
    } catch {
      return "FREE";
    }
  }

  async handleWebhook(request: Request): Promise<BillingSyncResult | null> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    const sig = request.headers.get("stripe-signature");
    if (!sig) throw new Error("Missing stripe-signature header");
    const raw = await request.text();

    const event = await this.stripe.webhooks.constructEventAsync(raw, sig, secret);

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const externalId = sub.metadata?.tenantExternalId;
        if (!externalId) return null;
        const active = sub.status === "active" || sub.status === "trialing";
        return {
          tenantExternalId: externalId,
          plan: active ? planForPrice(sub.items.data[0]?.price.id) : "FREE",
          billingRef: active ? sub.id : null,
          billingCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        };
      }
      default:
        return null;
    }
  }

  async cancel(tenant: Tenant): Promise<void> {
    if (tenant.billingRef) await this.stripe.subscriptions.cancel(tenant.billingRef);
  }
}
