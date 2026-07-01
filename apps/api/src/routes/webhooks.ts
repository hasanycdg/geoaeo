// Billing webhooks. NOT tenant-authenticated — each adapter verifies the
// provider's signature, then we write the resulting plan back to the tenant.
import { Hono } from "hono";
import { prisma } from "@geo/db";
import type { Platform } from "@geo/db";
import { StripeBillingAdapter } from "../adapters/billing/stripe";
import { ShopifyBillingAdapter } from "../adapters/billing/shopify";

const webhooks = new Hono();

async function applySync(platform: Platform, result: Awaited<ReturnType<StripeBillingAdapter["handleWebhook"]>>) {
  if (!result) return;
  await prisma.tenant.updateMany({
    where: { platform, externalId: result.tenantExternalId },
    data: {
      plan: result.plan,
      billingRef: result.billingRef,
      ...(result.billingCustomerId !== undefined ? { billingCustomerId: result.billingCustomerId } : {}),
    },
  });
}

webhooks.post("/stripe", async (c) => {
  try {
    const result = await new StripeBillingAdapter().handleWebhook(c.req.raw);
    await applySync("WORDPRESS", result);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "webhook_error" }, 400);
  }
});

webhooks.post("/shopify/billing", async (c) => {
  try {
    // handleWebhook only needs the API secret for HMAC; the access token is unused here.
    const result = await new ShopifyBillingAdapter("").handleWebhook(c.req.raw);
    await applySync("SHOPIFY", result);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "webhook_error" }, 400);
  }
});

export default webhooks;
