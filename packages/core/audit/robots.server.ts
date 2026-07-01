// robots.txt audit: detect AI crawlers that are blocked from the storefront.
// Blocking these is a common, silent, fatal mistake — if GPTBot/PerplexityBot/
// Google-Extended can't crawl you, you simply can't appear in those answers.
// Pure parser (testable) + a fetch wrapper.

export interface AiCrawler {
  bot: string;
  who: string;
}

// Current AI crawler user-agents (verify periodically — vendors add new ones).
export const AI_CRAWLERS: AiCrawler[] = [
  { bot: "GPTBot", who: "OpenAI — ChatGPT index/training" },
  { bot: "OAI-SearchBot", who: "OpenAI — ChatGPT Search" },
  { bot: "ChatGPT-User", who: "OpenAI — ChatGPT live browsing" },
  { bot: "PerplexityBot", who: "Perplexity — index" },
  { bot: "Perplexity-User", who: "Perplexity — live fetch" },
  { bot: "Google-Extended", who: "Google — Gemini & AI Overviews" },
  { bot: "ClaudeBot", who: "Anthropic — Claude index" },
  { bot: "Claude-User", who: "Anthropic — Claude live browsing" },
  { bot: "anthropic-ai", who: "Anthropic — legacy crawler" },
  { bot: "Amazonbot", who: "Amazon AI" },
  { bot: "Applebot-Extended", who: "Apple AI" },
  { bot: "meta-externalagent", who: "Meta AI" },
  { bot: "Bytespider", who: "ByteDance / TikTok AI" },
  { bot: "CCBot", who: "Common Crawl — feeds many LLMs" },
];

interface RobotsGroup {
  agents: string[];
  disallow: string[];
  allow: string[];
}

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share the next rule block.
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === "disallow" || field === "allow")) {
      (field === "disallow" ? current.disallow : current.allow).push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Pick the group governing `bot` — its own group, else the wildcard group. */
function groupFor(groups: RobotsGroup[], bot: string): RobotsGroup | null {
  const lc = bot.toLowerCase();
  const specific = groups.find((g) => g.agents.includes(lc));
  if (specific) return specific;
  return groups.find((g) => g.agents.includes("*")) ?? null;
}

/** Blocked from the site root: a `Disallow: /` with no overriding `Allow: /`. */
export function isBotBlocked(groups: RobotsGroup[], bot: string): boolean {
  const g = groupFor(groups, bot);
  if (!g) return false;
  const blocksRoot = g.disallow.some((d) => d === "/" || d === "/*");
  const allowsRoot = g.allow.some((a) => a === "/" || a === "");
  return blocksRoot && !allowsRoot;
}

export interface RobotsAudit {
  reachable: boolean;
  blocked: AiCrawler[];
  error?: string;
}

export async function auditRobots(domain: string): Promise<RobotsAudit> {
  const url = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/robots.txt`;
  try {
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) return { reachable: false, blocked: [], error: `HTTP ${resp.status}` };
    const groups = parseRobots(await resp.text());
    const blocked = AI_CRAWLERS.filter((c) => isBotBlocked(groups, c.bot));
    return { reachable: true, blocked };
  } catch (err) {
    return { reachable: false, blocked: [], error: err instanceof Error ? err.message : String(err) };
  }
}
