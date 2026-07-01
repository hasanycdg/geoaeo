// BillingPort — the one abstraction that lets the SAME plan/quota logic sit on
// top of Shopify Managed Billing (Shopify tenants) and Stripe (WordPress tenants).
//
// The core decides WHAT a tenant is entitled to (see packages/core/config/plans);
// the BillingPort only knows how to (a) start a checkout, (b) read the current
// paid state, and (c) translate a provider webhook into a plan change.
import type { Plan, Tenant } from "../domain/tenant";

export interface CheckoutSession {
  /** URL to redirect the merchant to in order to confirm/pay for the plan. */
  url: string;
  /** Provider-side reference for the pending change, if any (e.g. Stripe session id). */
  ref?: string;
}

/** Normalized result of interpreting a provider billing webhook. */
export interface BillingSyncResult {
  /** Which tenant this event concerns, by platform-native external id. */
  tenantExternalId: string;
  /** The plan the tenant should now be on. */
  plan: Plan;
  /** New opaque billing reference to persist on the tenant (subscription id/GID). */
  billingRef: string | null;
  /** Stripe customer id, when the provider supplies one. */
  billingCustomerId?: string | null;
}

export interface BillingPort {
  readonly platform: Tenant["platform"];

  /**
   * Begin an upgrade/downgrade to `plan`. `returnUrl` is where the provider sends
   * the merchant back after confirmation. FREE never calls this (no charge).
   */
  createCheckout(tenant: Tenant, plan: Plan, returnUrl: string): Promise<CheckoutSession>;

  /**
   * Authoritatively read the tenant's current plan from the provider. Used to
   * reconcile on app load (Shopify) or when a webhook was missed (Stripe).
   */
  getActivePlan(tenant: Tenant): Promise<Plan>;

  /**
   * Verify + parse a raw provider webhook request. Throws on signature failure.
   * Returns null for events the core doesn't care about.
   */
  handleWebhook(request: Request): Promise<BillingSyncResult | null>;

  /** Cancel the tenant's paid subscription, reverting to FREE. */
  cancel(tenant: Tenant): Promise<void>;
}
