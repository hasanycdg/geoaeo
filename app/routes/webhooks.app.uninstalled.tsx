import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopifyTenant } from "../geo/provision.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Remove the tenant + credential in the shared DB. The Tenant row cascades to
  // prompts, competitors, runs, results, recommendations and alerts.
  // shop/redact (sent ~48h later) is the GDPR backstop if this is missed.
  await deleteShopifyTenant(shop);

  return new Response();
};
