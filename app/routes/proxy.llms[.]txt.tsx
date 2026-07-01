// Serves /apps/geo/llms.txt on the storefront via Shopify App Proxy.
// Public request (no admin session) — authenticated by the proxy HMAC. Serves
// the cached llms.txt from the shared backend; generates+caches on first miss.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { apiGetText, apiPost } from "../geo/backend.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response("Not found", { status: 404 });

  let content = await apiGetText(session.shop, "/api/v1/content/llms-txt");
  if (!content.trim()) {
    // First hit: ask the backend to generate + cache using the offline token.
    await apiPost(session.shop, "/api/v1/content/llms-txt").catch(() => {});
    content = await apiGetText(session.shop, "/api/v1/content/llms-txt");
  }

  return new Response(content.trim() ? content : `# ${session.shop}\n\n> llms.txt not generated yet.\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
