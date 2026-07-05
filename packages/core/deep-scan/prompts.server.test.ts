import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAndLimit } from "./prompts.server";
import type { GeneratedPrompt } from "./types";

test("dedupeAndLimit removes duplicates, sorts by priority and caps prompt count", () => {
  const prompts: GeneratedPrompt[] = Array.from({ length: 30 }, (_, index) => ({
    text: `Best collagen powder ${index}`,
    intent: "best_for",
    priority: index,
    reason: `reason-${index}`,
  }));
  prompts.push({
    text: "Best collagen powder 1",
    intent: "comparison",
    priority: 120,
    reason: "duplicate",
  });
  prompts.push({
    text: "best collagen powder 1!!!",
    intent: "comparison",
    priority: -4,
    reason: "duplicate punctuation",
  });

  const selected = dedupeAndLimit(prompts, 25);

  assert.equal(selected.length, 25);
  assert.equal(new Set(selected.map((prompt) => prompt.text.toLowerCase())).size, 25);
  assert.equal(selected[0]?.priority, 29);
  assert.equal(selected[selected.length - 1]?.priority, 5);
});
