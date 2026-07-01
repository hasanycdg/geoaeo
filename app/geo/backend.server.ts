// Server-side client the Remix loaders/actions use to call the shared GEO API
// as a trusted first party. The Shopify app has already authenticated the
// merchant via OAuth, so it authenticates to the API with the internal secret
// plus the shop domain (which resolves the SHOPIFY tenant).
const BASE = process.env.GEO_API_URL ?? "http://localhost:3000";

function headers(shop: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Geo-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
    "X-Geo-Shop": shop,
  };
}

async function parse(res: Response) {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`GEO API ${res.status}: ${body ? JSON.stringify(body) : res.statusText}`);
  }
  return body;
}

export async function apiGet(shop: string, path: string) {
  return parse(await fetch(`${BASE}${path}`, { headers: headers(shop) }));
}

/** For endpoints that return text/plain (e.g. the cached llms.txt). */
export async function apiGetText(shop: string, path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(shop) });
  return res.ok ? res.text() : "";
}

export async function apiPost(shop: string, path: string, body?: unknown) {
  return parse(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: headers(shop),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiPatch(shop: string, path: string, body?: unknown) {
  return parse(
    await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: headers(shop),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiDelete(shop: string, path: string) {
  return parse(await fetch(`${BASE}${path}`, { method: "DELETE", headers: headers(shop) }));
}
