// Unit checks for the audit parsers (no network). Run: npx tsx scripts/smoke-audit.ts
import { parseRobots, isBotBlocked } from "@geo/core/audit";
import { extractJsonLdTypes, auditSchemaHtml } from "@geo/core/audit";

let failed = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failed++;
}

// robots.txt: GPTBot blocked, Perplexity allowed, wildcard allows root.
const robots = `
User-agent: GPTBot
Disallow: /

User-agent: PerplexityBot
Disallow: /checkout

User-agent: *
Disallow: /admin
`;
const g = parseRobots(robots);
assert("GPTBot blocked from root", isBotBlocked(g, "GPTBot") === true);
assert("PerplexityBot not blocked (only /checkout)", isBotBlocked(g, "PerplexityBot") === false);
assert("ClaudeBot falls through to wildcard, not blocked", isBotBlocked(g, "ClaudeBot") === false);

// Wildcard blocks everything.
const blockAll = parseRobots("User-agent: *\nDisallow: /");
assert("wildcard Disallow:/ blocks GPTBot", isBotBlocked(blockAll, "GPTBot") === true);
assert("wildcard Disallow:/ blocks Google-Extended", isBotBlocked(blockAll, "Google-Extended") === true);

// JSON-LD extraction (incl. @graph + arrays).
const html = `
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"X",
 "offers":{"@type":"Offer","price":"9.99"}}
</script>
<script type="application/ld+json">
{"@graph":[{"@type":"BreadcrumbList"},{"@type":"Organization"}]}
</script>`;
const types = extractJsonLdTypes(html);
assert("extracts Product", types.includes("Product"));
assert("extracts nested Offer", types.includes("Offer"));
assert("extracts @graph BreadcrumbList", types.includes("BreadcrumbList"));

const audit = auditSchemaHtml(html);
assert("flags missing AggregateRating", audit.missingImportant.includes("AggregateRating"));
assert("flags missing Review", audit.missingImportant.includes("Review"));
assert("does NOT flag Product (present)", !audit.missingImportant.includes("Product"));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
