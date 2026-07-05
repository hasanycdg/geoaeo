// Backend endpoint for the product-details Admin UI extension. The extension
// sends a Shopify id token (auth.idToken()); authenticate.admin validates it and
// resolves the shop. We reuse the GEO API's product-copy generator (OpenAI).
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { apiPost } from "../geo/backend.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // `cors` adds the headers admin UI extensions need (their origin differs from
  // the app URL); authenticate.admin also short-circuits the OPTIONS preflight.
  const { session, cors } = await authenticate.admin(request);
  const { productId } = (await request.json()) as { productId?: string };
  if (!productId) return cors(json({ error: "missing_product_id" }, { status: 400 }));

  const result = await apiPost(session.shop, "/api/v1/content/product-copy", { productId });
  return cors(json(result));
};
