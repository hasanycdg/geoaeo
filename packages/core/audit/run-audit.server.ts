// Runs both audits and turns findings into actionable Recommendation rows.
// Replaces prior OPEN robots/schema recommendations so the to-do list reflects
// the current state; leaves DONE/DISMISSED history intact.
import type { Prisma } from "@geo/db";
import { prisma } from "@geo/db";
import { auditRobots } from "./robots.server";
import { auditSchema } from "./schema.server";

export interface AuditSummary {
  robotsBlocked: number;
  robotsReachable: boolean;
  schemaMissing: string[];
  schemaReachable: boolean;
}

export async function runAudit(
  tenantId: string,
  domain: string,
  productUrl?: string,
): Promise<AuditSummary> {
  const [robots, schema] = await Promise.all([
    auditRobots(domain),
    auditSchema(productUrl || `https://${domain}`),
  ]);

  await prisma.recommendation.deleteMany({
    where: { tenantId, type: { in: ["ROBOTS_TXT", "SCHEMA"] }, status: "OPEN" },
  });

  const recs: Prisma.RecommendationCreateManyInput[] = [];

  if (robots.reachable && robots.blocked.length > 0) {
    recs.push({
      tenantId,
      type: "ROBOTS_TXT",
      severity: 1, // critical — silently kills AI visibility
      title: `${robots.blocked.length} AI crawler(s) blocked in robots.txt`,
      detail:
        `These AI crawlers are disallowed and cannot read your store: ` +
        `${robots.blocked.map((b) => b.bot).join(", ")}. ` +
        `Edit your theme's robots.txt.liquid to allow them, or remove the ` +
        `Disallow rules for these user-agents. Blocked crawlers means you ` +
        `cannot appear in those AI answers at all.`,
      data: { blocked: robots.blocked } as unknown as Prisma.InputJsonValue,
    });
  } else if (!robots.reachable) {
    recs.push({
      tenantId,
      type: "ROBOTS_TXT",
      severity: 3,
      title: "Couldn't check robots.txt",
      detail: `We couldn't fetch your robots.txt (${robots.error ?? "unknown"}). Set your store domain in Setup so we can audit it.`,
      data: { error: robots.error } as unknown as Prisma.InputJsonValue,
    });
  }

  if (schema.reachable && schema.missingImportant.length > 0) {
    recs.push({
      tenantId,
      type: "SCHEMA",
      severity: 2,
      title: `Missing structured data: ${schema.missingImportant.join(", ")}`,
      detail:
        `Your product page is missing JSON-LD for: ${schema.missingImportant.join(", ")}. ` +
        `AI assistants rely on this markup to understand and recommend products. ` +
        `Add Product, Offer, AggregateRating and Review structured data via your ` +
        `theme or a structured-data app.`,
      data: { found: schema.found, missing: schema.missingImportant } as unknown as Prisma.InputJsonValue,
    });
  } else if (!schema.reachable) {
    recs.push({
      tenantId,
      type: "SCHEMA",
      severity: 3,
      title: "Couldn't check structured data",
      detail: `We couldn't fetch a product page (${schema.error ?? "unknown"}).`,
      data: { error: schema.error } as unknown as Prisma.InputJsonValue,
    });
  }

  if (recs.length) await prisma.recommendation.createMany({ data: recs });

  return {
    robotsBlocked: robots.blocked.length,
    robotsReachable: robots.reachable,
    schemaMissing: schema.missingImportant,
    schemaReachable: schema.reachable,
  };
}
