import test from "node:test";
import assert from "node:assert/strict";
import type { Plan } from "../config/plans";
import { canConsumeDeepScanCredits, remainingDeepScanCredits } from "./quota.server";

type CreditTenant = { plan: Plan; deepScanCreditsUsedThisPeriod: number };

test("deep scan credits respect plan allowance and current usage", () => {
  const starterTenant: CreditTenant = { plan: "STARTER", deepScanCreditsUsedThisPeriod: 0 };
  const freeTenant: CreditTenant = { plan: "FREE", deepScanCreditsUsedThisPeriod: 0 };
  const exhaustedGrowthTenant: CreditTenant = { plan: "GROWTH", deepScanCreditsUsedThisPeriod: 75 };

  assert.equal(remainingDeepScanCredits(starterTenant), 25);
  assert.equal(canConsumeDeepScanCredits(starterTenant, 25), true);
  // Free has no Deep Scan allowance in production → cannot consume.
  assert.equal(canConsumeDeepScanCredits(freeTenant, 25), false);
  assert.equal(remainingDeepScanCredits(freeTenant), 0);
  assert.equal(canConsumeDeepScanCredits(exhaustedGrowthTenant, 25), false);
});
