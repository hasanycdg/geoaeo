import test from "node:test";
import assert from "node:assert/strict";
import { scoreCompetitors, selectTopCompetitors } from "./competitors";
import type { DeepScanAnswerData } from "./types";

test("scoreCompetitors excludes own brand and selects top 2 competitors", () => {
  const answers: DeepScanAnswerData[] = [
    {
      engine: "OPENAI",
      prompt: "best protein powder for runners",
      promptIntent: "best_for",
      answerText: "",
      citations: [{ url: "https://alpha.example/product" }],
      detectedBrands: [
        { name: "Own Brand", domain: "own.example" },
        { name: "Alpha Fuel", domain: "alpha.example" },
        { name: "Beta Labs", domain: "beta.example" },
      ],
      ownBrandMentioned: true,
      ownBrandPosition: 1,
      sentiment: "POSITIVE",
    },
    {
      engine: "PERPLEXITY",
      prompt: "affordable protein powder",
      promptIntent: "affordable",
      answerText: "",
      citations: [{ url: "https://alpha.example/guide" }],
      detectedBrands: [
        { name: "Alpha Fuel", domain: "alpha.example" },
        { name: "Gamma Nutrition", domain: "gamma.example" },
      ],
      ownBrandMentioned: false,
      ownBrandPosition: null,
      sentiment: "NEUTRAL",
    },
    {
      engine: "ANTHROPIC",
      prompt: "premium collagen peptides",
      promptIntent: "premium",
      answerText: "",
      citations: [{ url: "https://beta.example/reviews" }],
      detectedBrands: [
        { name: "Beta Labs", domain: "beta.example" },
        { name: "Gamma Nutrition", domain: "gamma.example" },
      ],
      ownBrandMentioned: false,
      ownBrandPosition: null,
      sentiment: "NEUTRAL",
    },
  ];

  const detected = scoreCompetitors(answers, ["Own Brand"], ["protein powder", "collagen"]);
  const result = selectTopCompetitors(detected);

  assert.equal(detected.some((competitor) => competitor.name === "Own Brand"), false);
  assert.equal(result.selected_top_competitors.length, 2);
  assert.deepEqual(result.selected_top_competitors.map((competitor) => competitor.name), ["Alpha Fuel", "Beta Labs"]);
  assert.equal(detected[0]?.selectedForResearch, true);
  assert.equal(detected[1]?.selectedForResearch, true);
  assert.equal(detected[2]?.selectedForResearch, false);
  assert.equal(detected[0]?.relevantPromptCount >= detected[1]?.relevantPromptCount, true);
});
