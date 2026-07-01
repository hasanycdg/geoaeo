// Public API v2. Demonstrates the versioning contract: v2 calls the SAME core
// functions as v1 and differs ONLY in request/response mapping at the edge.
// v1 stays alive unchanged; clients migrate when ready.
import { Hono } from "hono";
import { getDashboard } from "@geo/core/models";
import { requireTenant, tenantOf } from "../tenant";

const v2 = new Hono();
v2.use("*", requireTenant);

// v2 change vs v1: mention rates are expressed as 0–100 "visibility scores",
// and providers are keyed by name instead of an array. Core is untouched.
v2.get("/dashboard", async (c) => {
  const t = tenantOf(c);
  const d = await getDashboard(t.id, Number(c.req.query("windowDays") ?? 90));
  return c.json({
    hasData: d.hasData,
    lastScanAt: d.lastScanAt,
    engines: Object.fromEntries(
      d.providers.map((p) => [
        p.provider.toLowerCase(),
        {
          visibilityScore: Math.round(p.mentionRate * 100),
          avgPosition: p.avgPosition,
          sentiment: p.sentiment,
          trend: p.trend.map((x) => Math.round(x * 100)),
        },
      ]),
    ),
    shareOfModel: d.shareOfModel,
    gaps: d.gaps,
  });
});

export default v2;
