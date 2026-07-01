// GDPR mandatory webhook: customers/data_request.
// GEO Monitor stores NO customer-identifiable data — only shop-level config
// (brand, prompts, competitors) and AI answer measurements. There is no
// customer PII to return. We acknowledge with 200 and log for audit.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}: no customer data stored — nothing to return.`);
  return new Response();
};
