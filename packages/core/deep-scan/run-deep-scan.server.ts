// Deep Scan orchestrator. Runs the phases in order, persists each phase result
// (so a re-run resumes instead of redoing expensive steps), and is resilient:
// a failing phase marks the scan FAILED with a message and never leaves it stuck.
// Platform access is INJECTED (core stays platform-blind).
import { prisma, type Tenant } from "@geo/db";
import type { PlatformPort } from "../ports";
import { planConfig } from "../config/plans";
import { hostOf } from "./brands";
import { buildShopSnapshot } from "./snapshot.server";
import { generateBuyerPrompts } from "./prompts.server";
import { runVisibilityScan } from "./visibility.server";
import { scoreCompetitors, selectTopCompetitors } from "./competitors";
import { researchCompetitor } from "./research.server";
import { analyzeGaps } from "./gaps";
import { generateRecommendations } from "./recommendations.server";
import type {
  ShopSnapshot,
  GeneratedPrompt,
  DeepScanAnswerData,
  DetectedCompetitor,
  CompetitorResearch,
  CostEstimate,
} from "./types";

export interface DeepScanDeps {
  resolvePlatform: (tenant: Tenant) => Promise<PlatformPort>;
}

const domainOf = (t: Tenant) =>
  t.primaryDomain || (t.externalId.includes("://") ? new URL(t.externalId).host : t.externalId);

function log(id: string, msg: string) {
  console.log(`[deep-scan ${id}] ${msg}`);
}

export async function runDeepScan(deepScanId: string, deps: DeepScanDeps): Promise<void> {
  const scan = await prisma.deepScan.findUnique({ where: { id: deepScanId }, include: { tenant: true } });
  if (!scan) return;
  const tenant = scan.tenant;
  const domain = domainOf(tenant);
  log(deepScanId, `started for ${tenant.brandName ?? tenant.externalId}`);

  await prisma.deepScan.update({
    where: { id: deepScanId },
    data: { status: "RUNNING", startedAt: scan.startedAt ?? new Date() },
  });

  const setPhase = (phase: string) =>
    prisma.deepScan.update({ where: { id: deepScanId }, data: { currentPhase: phase } });

  const cost: CostEstimate = { groundedCalls: 0, analysisCalls: 0, synthesisCalls: 0, competitorPagesFetched: 0, estimatedUsd: 0 };

  try {
    // 1) SHOP_SNAPSHOT ------------------------------------------------------
    await setPhase("SHOP_SNAPSHOT");
    log(deepScanId, "phase SHOP_SNAPSHOT");
    const platform = await deps.resolvePlatform(tenant);
    let snapshot = scan.shopSnapshot as unknown as ShopSnapshot | null;
    if (!snapshot) {
      snapshot = await buildShopSnapshot(platform, tenant, domain);
      await prisma.deepScan.update({ where: { id: deepScanId }, data: { shopSnapshot: snapshot as unknown as object } });
    }
    log(deepScanId, `snapshot: ${snapshot.productCount} products, ${snapshot.categories.length} categories`);

    // 2) PROMPT_DISCOVERY ---------------------------------------------------
    await setPhase("PROMPT_DISCOVERY");
    log(deepScanId, "phase PROMPT_DISCOVERY");
    let prompts = scan.generatedPrompts as unknown as GeneratedPrompt[] | null;
    if (!prompts) {
      prompts = await generateBuyerPrompts(snapshot);
      await prisma.deepScan.update({ where: { id: deepScanId }, data: { generatedPrompts: prompts as unknown as object } });
    }
    log(deepScanId, `generated ${prompts.length} prompts`);

    // 3) AI_VISIBILITY_SCAN -------------------------------------------------
    await setPhase("AI_VISIBILITY_SCAN");
    log(deepScanId, "phase AI_VISIBILITY_SCAN");
    const brand = { name: snapshot.brandName, aliases: snapshot.aliases };
    const ownDomains = [snapshot.primaryDomain];
    const engines = planConfig(tenant.plan).providers;
    let failedEngines: string[] = [];
    const existingAnswers = await prisma.deepScanAnswer.count({ where: { deepScanId } });
    if (existingAnswers === 0) {
      const vis = await runVisibilityScan({ deepScanId, prompts, brand, ownDomains, engines });
      failedEngines = vis.failedEngines;
      cost.groundedCalls += vis.groundedCalls;
      cost.analysisCalls += vis.analysisCalls;
    }
    // Single source of truth for downstream phases (resumable).
    const answerRows = await prisma.deepScanAnswer.findMany({ where: { deepScanId } });
    const answers: DeepScanAnswerData[] = answerRows.map((r) => ({
      engine: r.engine,
      prompt: r.prompt,
      promptIntent: r.promptIntent,
      answerText: r.answerText,
      citations: (r.citations as unknown as { url: string; title?: string }[]) ?? [],
      detectedBrands: (r.detectedBrands as unknown as { name: string; domain: string | null }[]) ?? [],
      ownBrandMentioned: r.ownBrandMentioned,
      ownBrandPosition: r.ownBrandPosition,
      sentiment: r.sentiment,
    }));
    log(deepScanId, `visibility: ${answers.length} answers${failedEngines.length ? `, failed engines: ${failedEngines.join(",")}` : ""}`);

    // 4) COMPETITOR_DETECTION ----------------------------------------------
    await setPhase("COMPETITOR_DETECTION");
    log(deepScanId, "phase COMPETITOR_DETECTION");
    const ownTerms = [snapshot.brandName, ...snapshot.aliases];
    const detected: DetectedCompetitor[] = scoreCompetitors(answers, ownTerms, snapshot.categories);
    const detection = selectTopCompetitors(detected);
    await prisma.deepScan.update({
      where: { id: deepScanId },
      data: {
        detectedCompetitors: detection.all_detected as unknown as object,
        selectedCompetitors: detection.selected_top_competitors as unknown as object,
      },
    });
    log(deepScanId, `detected ${detected.length} competitors, selected top ${detection.selected_top_competitors.length}: ${detection.selected_top_competitors.map((c) => c.name).join(", ")}`);

    // 5) COMPETITOR_RESEARCH (top 2 only) -----------------------------------
    await setPhase("COMPETITOR_RESEARCH");
    log(deepScanId, "phase COMPETITOR_RESEARCH");
    const top = detected.filter((c) => c.selectedForResearch);
    const research: CompetitorResearch[] = [];
    // fresh research rows each run
    await prisma.deepScanCompetitorResearch.deleteMany({ where: { deepScanId } });
    for (const comp of top) {
      try {
        const externalSources = answers
          .flatMap((a) => a.citations.map((c) => c.url))
          .filter((u) => comp.domain && hostOf(u) === comp.domain);
        const r = await researchCompetitor({ competitor: comp, externalSources, snapshot });
        cost.competitorPagesFetched += r.researchedPages.filter((p) => p.ok).length;
        research.push(r);
        await prisma.deepScanCompetitorResearch.create({
          data: {
            deepScanId,
            competitorName: r.name,
            competitorDomain: r.domain,
            mentionCount: r.mentionCount,
            avgPosition: r.avgPosition,
            engines: r.engines as unknown as object,
            researchedPages: r.researchedPages as unknown as object,
            schemaAudit: r.schemaAudit as unknown as object,
            contentPatterns: r.contentPatterns as unknown as object,
            externalSources: r.externalSources as unknown as object,
            comparisonToShop: r.comparisonToShop as unknown as object,
          },
        });
        log(deepScanId, `researched ${r.name}: resolved=${r.resolved}, pages=${r.researchedPages.length}`);
      } catch (err) {
        log(deepScanId, `competitor ${comp.name} research failed: ${(err as Error).message}`);
      }
    }

    // 6) GAP_ANALYSIS -------------------------------------------------------
    await setPhase("GAP_ANALYSIS");
    log(deepScanId, "phase GAP_ANALYSIS");
    const gaps = analyzeGaps(snapshot, research);
    await prisma.deepScan.update({ where: { id: deepScanId }, data: { gapFindings: gaps as unknown as object } });
    log(deepScanId, `gap findings: ${gaps.length}`);

    // 7) RECOMMENDATION_GENERATION -----------------------------------------
    await setPhase("RECOMMENDATION_GENERATION");
    log(deepScanId, "phase RECOMMENDATION_GENERATION");
    const mentioned = answers.filter((a) => a.ownBrandMentioned).length;
    const brandAbsentCompetitorPresent = answers.filter((a) => !a.ownBrandMentioned && a.detectedBrands.length > 0).length;
    const vis = {
      overallMentionRate: answers.length ? mentioned / answers.length : 0,
      promptsScanned: prompts.length,
      answersCount: answers.length,
      brandAbsentCompetitorPresent,
      failedEngines,
    };
    const bundle = await generateRecommendations(snapshot, gaps, research, vis);
    if (bundle.priorityFixes.length) cost.synthesisCalls += 1;
    // Rough cost: grounded ~$0.02, analysis ~$0.0002, synthesis ~$0.01, pages free.
    cost.estimatedUsd = Number((cost.groundedCalls * 0.02 + cost.analysisCalls * 0.0002 + cost.synthesisCalls * 0.01).toFixed(3));
    await prisma.deepScan.update({
      where: { id: deepScanId },
      data: { recommendations: bundle as unknown as object, costEstimate: cost as unknown as object },
    });

    // 8) COMPLETED ----------------------------------------------------------
    await prisma.deepScan.update({
      where: { id: deepScanId },
      data: { status: "COMPLETED", currentPhase: "COMPLETED", completedAt: new Date() },
    });
    log(deepScanId, `completed. estimated cost ~$${cost.estimatedUsd}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(deepScanId, `FAILED: ${message}`);
    await prisma.deepScan.update({
      where: { id: deepScanId },
      data: { status: "FAILED", failedAt: new Date(), errorMessage: message },
    });
  }
}
