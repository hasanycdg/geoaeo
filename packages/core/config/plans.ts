// Plan limits live in CODE, not the DB — change tiers without a migration.
// The Shop row stores only the chosen `plan` + live usage counters.
// This is the SINGLE SOURCE for pricing shown on BOTH Shopify and WordPress:
// the /api/v1/plans endpoint and the Shopify billing UI both render from here.
import type { Provider } from "../providers/types";

export type Plan = "FREE" | "STARTER" | "GROWTH" | "PRO";
export type Frequency = "WEEKLY" | "DAILY";

export interface PlanConfig {
  id: Plan;
  name: string;
  priceUsd: number;
  isMvp: boolean;
  maxPrompts: number;
  maxCompetitors: number;
  providers: Provider[];
  frequency: Frequency;
  /** N repetitions per (prompt × provider × scheduled run). */
  repetitions: number;
  /** Hard cap on grounded API calls per billing period. Throttle, never crash. */
  monthlyQueryQuota: number;
  // Feature flags (Action-Layer / e-commerce differentiators).
  actionLayer: boolean; // robots.txt + schema audit
  productLevel: boolean; // SKU-level tracking
  exportEnabled: boolean;
  /** Deep Scan credit allowance per billing period (0 = not available on this plan). */
  deepScanCreditsPerPeriod: number;
  /** AI product-copy generations allowed per billing period (abuse guard + tiering). */
  productCopyPerPeriod: number;
}

/** Credits one Deep Scan consumes. Configurable via env without a deploy. */
export const DEEP_SCAN_CREDIT_COST = Number(process.env.DEEP_SCAN_CREDIT_COST?.trim() || "25");

// Deep Scan is not part of Free in production. Set FREE_DEEP_SCAN_CREDITS=25 in
// dev to test the full Deep Scan on a Free tenant.
const FREE_DEEP_SCAN_CREDITS = Number(process.env.FREE_DEEP_SCAN_CREDITS?.trim() || "0");

const ALL: Provider[] = ["PERPLEXITY", "OPENAI", "ANTHROPIC", "GEMINI"];
// Starter gets the important + cheap engines; Claude (mid-cost) starts at Growth.
const STARTER_ENGINES: Provider[] = ["OPENAI", "PERPLEXITY", "GEMINI"];

export const PLANS: Record<Plan, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceUsd: 0,
    isMvp: true,
    maxPrompts: 1,
    maxCompetitors: 1,
    providers: ["OPENAI"], // ChatGPT only — the engine that matters most as a hook
    frequency: "WEEKLY",
    repetitions: 1,
    monthlyQueryQuota: 20,
    actionLayer: true, // robots/schema audit stays free — key install hook
    productLevel: false,
    exportEnabled: false,
    deepScanCreditsPerPeriod: FREE_DEEP_SCAN_CREDITS,
    productCopyPerPeriod: 5,
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceUsd: 29,
    isMvp: true,
    maxPrompts: 6,
    maxCompetitors: 3,
    providers: STARTER_ENGINES, // 3 engines: ChatGPT, Perplexity, Gemini
    frequency: "WEEKLY",
    repetitions: 3,
    monthlyQueryQuota: 360,
    actionLayer: true,
    productLevel: false,
    exportEnabled: false,
    deepScanCreditsPerPeriod: 25, // 1 Deep Scan / period
    productCopyPerPeriod: 50,
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    priceUsd: 59,
    isMvp: false,
    maxPrompts: 12,
    maxCompetitors: 5,
    providers: ALL, // all 4 engines
    frequency: "WEEKLY",
    repetitions: 3,
    monthlyQueryQuota: 720,
    actionLayer: true,
    productLevel: false,
    exportEnabled: true,
    deepScanCreditsPerPeriod: 75, // 3 Deep Scans / period
    productCopyPerPeriod: 200,
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceUsd: 149,
    isMvp: false,
    maxPrompts: 30,
    maxCompetitors: 10,
    providers: ALL, // all 4 engines
    frequency: "WEEKLY",
    repetitions: 3,
    monthlyQueryQuota: 1800,
    actionLayer: true,
    productLevel: true,
    exportEnabled: true,
    deepScanCreditsPerPeriod: 200, // 8 Deep Scans / period
    productCopyPerPeriod: 1000,
  },
};

export const MVP_PLANS = Object.values(PLANS).filter((p) => p.isMvp);
export const ORDERED_PLANS: Plan[] = ["FREE", "STARTER", "GROWTH", "PRO"];

export function planConfig(plan: Plan): PlanConfig {
  return PLANS[plan];
}

const ENGINE_LABEL: Record<Provider, string> = {
  OPENAI: "ChatGPT",
  ANTHROPIC: "Claude",
  GEMINI: "Gemini",
  PERPLEXITY: "Perplexity",
};

export function engineLabels(p: PlanConfig): string[] {
  return p.providers.map((e) => ENGINE_LABEL[e]);
}

/**
 * The human-readable feature list shown on the pricing pages. ONE source for
 * both Shopify (billing UI) and WordPress (via /api/v1/plans) so they never drift.
 */
export function planFeatureList(p: PlanConfig): string[] {
  const deepScans = Math.floor(p.deepScanCreditsPerPeriod / DEEP_SCAN_CREDIT_COST);
  return [
    `${p.maxPrompts} tracked prompt${p.maxPrompts > 1 ? "s" : ""}`,
    `${p.providers.length} AI engine${p.providers.length > 1 ? "s" : ""}: ${engineLabels(p).join(", ")}`,
    `${p.maxCompetitors} competitor${p.maxCompetitors > 1 ? "s" : ""}`,
    `${p.frequency === "WEEKLY" ? "Weekly" : "Daily"} scans (${p.repetitions}× each)`,
    `${p.monthlyQueryQuota.toLocaleString()} AI queries / month`,
    deepScans > 0 ? `${deepScans} Deep Scan${deepScans > 1 ? "s" : ""} / month` : "Deep Scan — not included",
    `${p.productCopyPerPeriod.toLocaleString()} AI product texts / month`,
    "robots.txt + schema + FAQ audit",
    "Deep Analysis report",
    ...(p.exportEnabled ? ["CSV export"] : []),
    ...(p.productLevel ? ["SKU-level product tracking"] : []),
  ];
}

/** Compact plan catalog for the pricing pages (Shopify UI + WordPress via API). */
export function planCatalog() {
  return ORDERED_PLANS.map((id) => {
    const p = PLANS[id];
    return {
      id: p.id,
      name: p.name,
      priceUsd: p.priceUsd,
      features: planFeatureList(p),
      deepScansPerMonth: Math.floor(p.deepScanCreditsPerPeriod / DEEP_SCAN_CREDIT_COST),
      engines: engineLabels(p),
      popular: p.id === "GROWTH",
    };
  });
}
