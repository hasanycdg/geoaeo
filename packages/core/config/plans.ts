// Plan limits live in CODE, not the DB — change tiers without a migration.
// The Shop row stores only the chosen `plan` + live usage counters.
// MVP ships FREE + STARTER (see `isMvp`); GROWTH/PRO are defined for forward
// compatibility but not yet offered in billing.
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
}

const ALL: Provider[] = ["PERPLEXITY", "OPENAI", "ANTHROPIC", "GEMINI"];

export const PLANS: Record<Plan, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceUsd: 0,
    isMvp: true,
    maxPrompts: 1,
    maxCompetitors: 1,
    providers: ["OPENAI"], // FREE trial: ChatGPT only (matches the WP version + landing copy)
    frequency: "WEEKLY",
    repetitions: 3,
    monthlyQueryQuota: 20, // ~$0.50/mo max — pure acquisition cost; hard-capped
    actionLayer: true, // the robots/schema check is a key install hook — keep on Free
    productLevel: false,
    exportEnabled: false,
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceUsd: 29,
    isMvp: true,
    maxPrompts: 6, // 6 × 4 engines × 3 runs × ~4.33 weekly ≈ 312 calls
    maxCompetitors: 3,
    providers: ALL,
    frequency: "WEEKLY",
    repetitions: 3,
    monthlyQueryQuota: 360, // $9.00 max COGS = 31% of $29
    actionLayer: true,
    productLevel: false,
    exportEnabled: false,
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    priceUsd: 59,
    isMvp: false,
    maxPrompts: 12, // ≈ 624 calls
    maxCompetitors: 5,
    providers: ALL,
    frequency: "WEEKLY", // daily would 7× the cost → margin risk
    repetitions: 3,
    monthlyQueryQuota: 720, // $18.00 max COGS = 31% of $59
    actionLayer: true,
    productLevel: false,
    exportEnabled: true,
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceUsd: 149,
    isMvp: false,
    maxPrompts: 30, // ≈ 1560 calls
    maxCompetitors: 10,
    providers: ALL,
    frequency: "WEEKLY", // daily would 7× the cost → margin risk
    repetitions: 3,
    monthlyQueryQuota: 1800, // $45.00 max COGS = 30% of $149
    actionLayer: true,
    productLevel: true,
    exportEnabled: true,
  },
};

export const MVP_PLANS = Object.values(PLANS).filter((p) => p.isMvp);

export function planConfig(plan: Plan): PlanConfig {
  return PLANS[plan];
}
