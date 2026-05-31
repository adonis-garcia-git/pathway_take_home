// Fuzzy matching for USDA commodity lookup.
//
// Each ingredient has a `canonicalName` (e.g. "san marzano tomato") and a
// `category` (e.g. "produce"). We:
//   1. Route to the right report by category (PRIMARY_REPORT_BY_CATEGORY).
//   2. Score each candidate commodity (and optional variety) against the
//      ingredient's head noun + modifier using fuzzball.token_sort_ratio and
//      fuzzball.partial_ratio. Take the max, normalize to 0..1.
//   3. If best score < CONFIDENCE_THRESHOLD, caller falls back to a
//      documented category average and labels the price as "estimated".
//
// All scoring is pure; IO (fetching the commodity list) lives in usda.ts.

import * as fuzz from "fuzzball";

export type Category = "produce" | "dairy" | "meat" | "seafood" | "pantry" | "other";

export type ReportSlug = "3324" | "2315";

/** Primary USDA report to consult per ingredient category. */
export const PRIMARY_REPORT_BY_CATEGORY: Record<Category, ReportSlug> = {
  produce: "3324", // National Retail Specialty Crops (FVWRETAIL)
  dairy: "3324", // retail dairy not in MARS retail; fallback applies often
  meat: "2315", // NY Terminal — wholesale meat/veg crossover
  seafood: "2315",
  pantry: "3324",
  other: "3324",
};

/** Secondary (fallback) report tried when primary returns no commodity hit. */
export const SECONDARY_REPORT_BY_CATEGORY: Record<Category, ReportSlug | null> = {
  produce: "2315",
  dairy: "2315",
  meat: "3324",
  seafood: "3324",
  pantry: "2315",
  other: "2315",
};

/**
 * Documented category-average fallback prices in USD per default unit.
 * Used when:
 *   (a) no USDA API key is set (source = "mock"), OR
 *   (b) the best match confidence is below CONFIDENCE_THRESHOLD
 *       (source = "estimated", unmatched = true).
 * Numbers are intentionally round so they read as estimates, not measurements.
 * See docs/usda-mapping.md for sourcing notes.
 */
export const CATEGORY_AVG_PRICE: Record<Category, { price: number; unit: string }> = {
  produce: { price: 2.5, unit: "lb" },
  dairy: { price: 6.0, unit: "lb" },
  meat: { price: 8.0, unit: "lb" },
  seafood: { price: 12.0, unit: "lb" },
  pantry: { price: 4.0, unit: "lb" },
  other: { price: 5.0, unit: "lb" },
};

export const CONFIDENCE_THRESHOLD = 0.6;

/** Split a canonical name into head noun (last token) + modifier (everything else). */
export function splitHeadAndModifier(canonicalName: string): { head: string; modifier: string } {
  const tokens = canonicalName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { head: "", modifier: "" };
  if (tokens.length === 1) return { head: tokens[0], modifier: "" };
  const head = tokens[tokens.length - 1];
  const modifier = tokens.slice(0, -1).join(" ");
  return { head, modifier };
}

/** Max of token_sort_ratio and partial_ratio, normalized 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ts = fuzz.token_sort_ratio(a, b);
  const pr = fuzz.partial_ratio(a, b);
  return Math.max(ts, pr) / 100;
}

export interface Candidate {
  commodity: string;
  variety?: string;
}

export interface MatchResult<T extends Candidate> {
  candidate: T | null;
  confidence: number; // 0..1
}

/**
 * Score every candidate and return the best one.
 * Scoring rule:
 *   - Head noun is matched against `commodity`.
 *   - Modifier (if present) is matched against `variety`.
 *   - When the candidate has a variety AND we have a modifier, the score is
 *     the average of the two similarities; otherwise it's just the head sim.
 */
export function bestMatch<T extends Candidate>(
  canonicalName: string,
  candidates: readonly T[],
): MatchResult<T> {
  const { head, modifier } = splitHeadAndModifier(canonicalName);
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const headSim = similarity(head, c.commodity);
    const varietySim = modifier && c.variety ? similarity(modifier, c.variety) : null;
    const score = varietySim === null ? headSim : (headSim + varietySim) / 2;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return { candidate: best, confidence: bestScore };
}

/** Lower bound of "weak but real" match window. Below this is noise. */
export const WEAK_MATCH_LOWER = 0.4;

/**
 * Return every candidate whose score falls inside [WEAK_MATCH_LOWER,
 * CONFIDENCE_THRESHOLD). Sorted by confidence descending. Used by the
 * fallback path to derive a neighbor-median estimate when we don't have
 * a clean single match but DO have a cluster of near-misses.
 */
export function weakMatches<T extends Candidate>(
  canonicalName: string,
  candidates: readonly T[],
): { candidate: T; confidence: number }[] {
  const { head, modifier } = splitHeadAndModifier(canonicalName);
  const out: { candidate: T; confidence: number }[] = [];
  for (const c of candidates) {
    const headSim = similarity(head, c.commodity);
    const varietySim = modifier && c.variety ? similarity(modifier, c.variety) : null;
    const score = varietySim === null ? headSim : (headSim + varietySim) / 2;
    if (score >= WEAK_MATCH_LOWER && score < CONFIDENCE_THRESHOLD) {
      out.push({ candidate: c, confidence: score });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}
