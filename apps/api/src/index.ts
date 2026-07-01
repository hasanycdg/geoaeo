// The single backend for all platforms. Mounts the versioned public API and the
// billing webhooks. WordPress plugins and the Shopify app are clients of this.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import v1 from "./routes/v1";
import v2 from "./routes/v2";
import webhooks from "./routes/webhooks";
import onboard from "./routes/onboard";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "geo-api" }));
// Onboarding is mounted BEFORE v1 so it isn't caught by v1's tenant-auth middleware.
app.route("/api/onboard", onboard);
app.route("/api/v1", v1);
app.route("/api/v2", v2);
app.route("/webhooks", webhooks);

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`[api] geo-api listening on :${port}`);

export default app;
