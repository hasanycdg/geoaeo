// GDPR mandatory webhook: customers/redact.
// We hold no customer-identifiable data, so there is nothing to erase.
// Acknowledge with 200.
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}: no customer data stored — nothing to redact.`);
  return new Response();
};
