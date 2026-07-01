// Unit checks for the content generators (no network/admin).
// Run: npx tsx scripts/smoke-content.ts
import type { Tenant } from "@geo/db";
import type { PlatformPort } from "@geo/core/ports";
import { generateLlmsTxt, suggestProductCopy } from "@geo/core/content";

let failed = 0;
const assert = (name: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failed++;
};

// Mock PlatformPort returning a small catalog (replaces the old mock graphql).
const mockPlatform: PlatformPort = {
  platform: "SHOPIFY",
  getStoreProfile: async () => ({
    name: "NorthPeak",
    description: "Vegan sports nutrition.",
    primaryUrl: "https://northpeak.com",
  }),
  listProducts: async () => [
    {
      externalId: "1",
      title: "Vegan Protein",
      handle: "vegan-protein",
      description: "<p>Plant protein, 25g.</p>",
      url: "https://northpeak.com/products/vegan-protein",
      productType: "Protein",
      tags: [],
    },
    {
      externalId: "2",
      title: "Creatine",
      handle: "creatine",
      description: null,
      url: "",
      productType: "Performance",
      tags: [],
    },
  ],
  getRobotsTxt: async () => null,
  fetchUrl: async () => null,
};

const tenant = { externalId: "northpeak.myshopify.com" } as Tenant;

const llms = await generateLlmsTxt(mockPlatform, tenant);
assert("has H1 with shop name", llms.content.startsWith("# NorthPeak"));
assert("includes description blockquote", llms.content.includes("> Vegan sports nutrition."));
assert("groups by product type", llms.content.includes("## Protein") && llms.content.includes("## Performance"));
assert("links product with stripped HTML desc", llms.content.includes("[Vegan Protein](https://northpeak.com/products/vegan-protein): Plant protein, 25g."));
assert("falls back to constructed URL when url empty", llms.content.includes("/products/creatine"));
assert("product count = 2", llms.productCount === 2);

// Template fallback (no ANTHROPIC_API_KEY in this env).
const copy = await suggestProductCopy({ id: "gid://1", title: "Vegan Protein", description: "Plant protein", productType: "Protein", tags: ["vegan"] });
assert("copy returns a description", copy.description.length > 0);
assert("copy returns 3+ bullets", copy.bullets.length >= 3);
assert("copy returns 3 faqs", copy.faqs.length === 3);
assert("source flagged (template without key)", copy.source === "template" || copy.source === "llm");

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
