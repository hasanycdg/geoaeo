// End-to-end pipeline test against the real (docker) Postgres, mock providers.
// Seeds a tenant, runs a full scan, verifies persistence + dashboard aggregation.
// Run: npx tsx scripts/smoke-pipeline.ts
import "dotenv/config";
import { prisma } from "@geo/db";
import { runTenantScan } from "@geo/core/scan";
import { getDashboard } from "@geo/core/models";

async function main() {
  const externalId = "smoke-test.myshopify.com";
  const tenant = await prisma.tenant.upsert({
    where: { platform_externalId: { platform: "SHOPIFY", externalId } },
    update: { brandName: "NorthPeak", brandAliases: ["North Peak"], plan: "STARTER", usageQueriesThisPeriod: 0, usagePeriodStart: new Date() },
    create: { platform: "SHOPIFY", externalId, brandName: "NorthPeak", brandAliases: ["North Peak"], plan: "STARTER" },
  });
  await prisma.trackedPrompt.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.competitor.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.trackedPrompt.create({ data: { tenantId: tenant.id, text: "best vegan protein powder" } });
  await prisma.trackedPrompt.create({ data: { tenantId: tenant.id, text: "top creatine supplement" } });
  await prisma.competitor.create({ data: { tenantId: tenant.id, name: "VeganVit" } });
  await prisma.competitor.create({ data: { tenantId: tenant.id, name: "PureForm" } });

  const outcome = await runTenantScan(tenant.id);
  console.log("scan outcome:", outcome);

  const runCount = await prisma.run.count({ where: { tenantId: tenant.id } });
  const resultCount = await prisma.result.count({ where: { run: { tenantId: tenant.id } } });
  const fresh = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  console.log(`persisted: ${runCount} runs, ${resultCount} results, usage=${fresh.usageQueriesThisPeriod}`);

  const dash = await getDashboard(tenant.id);
  console.log("providers:", dash.providers.map((p) => `${p.provider}=${Math.round(p.mentionRate * 100)}%`).join("  "));
  console.log("shareOfModel:", JSON.stringify(dash.shareOfModel));
  console.log("gaps:", JSON.stringify(dash.gaps));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
