// Smoke test: runs a mock scan across all 4 providers, no API keys needed.
// Run: npx tsx scripts/smoke-scan.ts
import { ALL_PROVIDERS } from "@geo/core/providers";
import { runScan } from "@geo/core/scan";

async function main() {
  for (const provider of ALL_PROVIDERS) {
    const result = await runScan({
      provider,
      prompt: "best vegan protein powder",
      brand: { name: "NorthPeak", aliases: ["North Peak"] },
      competitors: [{ name: "VeganVit" }, { name: "PureForm" }],
      ownDomains: ["northpeak.com"],
      repetitions: 3,
    });
    console.log(
      `${provider.padEnd(11)} mentionRate=${(result.mentionRate * 100).toFixed(0)}% ` +
        `pos=${result.avgPosition ?? "-"} sentiment=${result.sentiment} ` +
        `runs=${result.successfulRuns}/${result.repetitions} gaps=[${result.gaps.join(",")}]`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
