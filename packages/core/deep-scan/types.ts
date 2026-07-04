// Deep Scan — shared types. Deep Scan is a separate, credit-gated workflow from
// regular scans (existing tracked prompts) and Deep Analysis (report over
// existing data). It discovers buyer prompts, runs a visibility scan, detects
// competitors, researches ONLY the top 2, finds gaps and generates recommendations.

export const DEEP_SCAN_PHASES = [
  "SHOP_SNAPSHOT",
  "PROMPT_DISCOVERY",
  "AI_VISIBILITY_SCAN",
  "COMPETITOR_DETECTION",
  "COMPETITOR_RESEARCH",
  "GAP_ANALYSIS",
  "RECOMMENDATION_GENERATION",
  "COMPLETED",
] as const;
export type DeepScanPhase = (typeof DEEP_SCAN_PHASES)[number];

// Hard v1 limits (cost control).
export const MAX_PROMPTS = 25;
export const MAX_CANDIDATE_PROMPTS = 50;
export const TOP_COMPETITORS = 2;
export const MAX_PAGES_PER_COMPETITOR = 5;
export const RESEARCH_CACHE_DAYS = 14;

export interface ShopSnapshot {
  brandName: string;
  aliases: string[];
  primaryDomain: string;
  productCount: number;
  categories: string[];
  topProducts: { title: string; summary: string; productType: string | null }[];
  signals: {
    schemaFound: string[];
    schemaMissingImportant: string[];
    hasFaqSchema: boolean;
    llmsTxt: boolean;
    sitemap: boolean;
    robotsReachable: boolean;
    blockedAiCrawlers: string[];
    metaDescription: boolean;
    openGraph: boolean;
  };
  contentHash: string;
}

export interface GeneratedPrompt {
  text: string;
  intent: string;
  priority: number; // 0..100
  reason: string;
}

export interface DetectedBrand {
  name: string;
  domain: string | null;
}

export interface DeepScanAnswerData {
  engine: string;
  prompt: string;
  promptIntent: string | null;
  answerText: string;
  citations: { url: string; title?: string }[];
  detectedBrands: DetectedBrand[];
  ownBrandMentioned: boolean;
  ownBrandPosition: number | null;
  sentiment: string;
}

export interface DetectedCompetitor {
  name: string;
  domain: string | null;
  mentionCount: number;
  avgPosition: number | null;
  engines: string[];
  promptCount: number;
  relevantPromptCount: number;
  hasCitations: boolean;
  score: number;
  selectedForResearch: boolean;
}

export interface CompetitorDetectionResult {
  all_detected: DetectedCompetitor[];
  selected_top_competitors: { name: string; domain: string | null }[];
}

export interface ResearchedPage {
  url: string;
  kind: string; // homepage | category | product | faq | guide
  title: string | null;
  metaDescription: boolean;
  headings: string[];
  schemaTypes: string[];
  faqQuestions: string[];
  ok: boolean;
}

export interface CompetitorResearch {
  name: string;
  domain: string | null;
  resolved: boolean;
  mentionCount: number;
  avgPosition: number | null;
  engines: string[];
  researchedPages: ResearchedPage[];
  schemaAudit: {
    product: boolean;
    offer: boolean;
    aggregateRating: boolean;
    review: boolean;
    faqPage: boolean;
  };
  contentPatterns: {
    hasFaqContent: boolean;
    hasBuyerGuide: boolean;
    hasComparisonPage: boolean;
    hasReviewSignals: boolean;
    recurringHeadings: string[];
  };
  externalSources: string[];
  comparisonToShop: Record<string, { shop: boolean | number; competitor: boolean | number }>;
}

export type Severity = "low" | "medium" | "high";

export interface GapFinding {
  title: string;
  category: string;
  severity: Severity;
  impact: Severity;
  effort: Severity;
  evidence: { shop: string; competitors: string[] };
  recommendation: string;
  auto_fix_possible: boolean;
}

export interface Recommendation {
  title: string;
  impact: Severity;
  effort: Severity;
  why_it_matters: string;
  steps: string[];
  auto_fix_available: boolean;
}

export interface RecommendationBundle {
  executiveSummary: string;
  visibilitySummary: string;
  topCompetitors: { name: string; domain: string | null }[];
  whyOutperforming: string[];
  topMissingAssets: string[];
  priorityFixes: Recommendation[];
  actionPlan30Day: { week: string; focus: string; actions: string[] }[];
  contentIdeas: string[];
}

export interface CostEstimate {
  groundedCalls: number;
  analysisCalls: number;
  synthesisCalls: number;
  competitorPagesFetched: number;
  estimatedUsd: number;
}
