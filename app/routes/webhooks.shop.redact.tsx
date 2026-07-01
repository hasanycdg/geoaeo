// GDPR mandatory webhook: shop/redact.
// Sent ~48h after uninstall. Erase all of the app's data for this shop.
// Deleting the Shop row cascades to prompts, competitors, runs, results,
// recommendations and alerts (onDelete: Cascade). Also clear any sessions.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopifyTenant } from "../geo/provision.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}: erasing all shop data.`);
  // Deleting the Tenant cascades to prompts, competitors, runs, results,
  // recommendations, alerts and the credential. Also clear Shopify sessions.
  await deleteShopifyTenant(shop);
  await db.session.deleteMany({ where: { shop } });
  return new Response();
};
