// LIVE adapter verification. For every provider with an API key set in .env,
// issues ONE real grounded query and prints the parsed text + citations so you
// can confirm the adapter parsing matches the real provider response.
// Providers without a key are skipped. Run: npx tsx scripts/smoke-live.ts
import "dotenv/config";
import { ALL_PROVIDERS, getAdapter } from "@geo/core/providers";

const PROMPT = process.argv[2] || "best vegan protein powder";

async function main() {
  console.log(`Prompt: "${PROMPT}"\n`);
  for (const provider of ALL_PROVIDERS) {
    const adapter = getAdapter(provider);
    if (!adapter.isConfigured()) {
      console.log(`— ${provider}: skipped (no API key set)\n`);
      continue;
    }
    try {
      const t0 = performance.now();
      const res = await adapter.query(PROMPT, {
        locale: "en-US",
        country: "US",
        signal: AbortSignal.timeout(90_000),
      });
      const ms = Math.round(performance.now() - t0);
      console.log(`✓ ${provider} (${res.modelId}, ${ms}ms)`);
      console.log(`  text: ${res.text.slice(0, 200).replace(/\s+/g, " ")}…`);
      console.log(`  citations: ${res.citations.length}`);
      res.citations.slice(0, 3).forEach((c) => console.log(`    - ${c.url}${c.title ? ` (${c.title})` : ""}`));
      console.log(`  tokens: in=${res.usage?.promptTokens ?? "?"} out=${res.usage?.completionTokens ?? "?"}\n`);
      if (!res.text) console.warn(`  ⚠ empty text — check adapter parsing for ${provider}`);
      if (res.citations.length === 0) console.warn(`  ⚠ no citations parsed — verify grounding is active for ${provider}\n`);
    } catch (err) {
      console.error(`✗ ${provider} FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
