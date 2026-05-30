// Pure aggregation + dedup for ingredient extractions across dishes.
//
// Pipeline:
//   1. normalize    — lowercase, strip punctuation, collapse whitespace,
//                      naive singularization.
//   2. synonym pass — collapse hand-curated kitchen synonyms
//                      ("green onion" → "scallion", "EVOO" → "olive oil").
//   3. fuzzy pass   — cluster remaining names with token_set_ratio ≥ 92
//                      to absorb residual drift the model emits.
//   4. roll-up      — group occurrences by final canonical; category = mode,
//                      defaultUnit = unit with largest summed quantity.
//
// This file has NO Convex imports — it's pure TS so vitest can exercise it
// without spinning up a deployment.

import { token_set_ratio } from "fuzzball";
import type { Category, Confidence, DishExtraction } from "./schemas";

export type ParsedDish = DishExtraction & { dishIndex: number };

export interface IngredientOccurrence {
  dishIndex: number;
  rawName: string;
  estimatedQuantity: number;
  unit: string;
  confidence: Confidence;
  assumptionNote?: string;
}

export interface AggregatedIngredient {
  canonicalName: string;
  category: Category;
  defaultUnit: string;
  occurrences: IngredientOccurrence[];
}

// ── synonyms ────────────────────────────────────────────────────────
// Keys = normalized variants we want to collapse. Values = the chosen canonical
// (also normalized). Keep this curated — false positives here corrupt the
// shopping list. Add entries as we observe real menus.
export const SYNONYMS: Record<string, string> = {
  // alliums
  "green onion": "scallion",
  "spring onion": "scallion",
  // citrus / herbs
  cilantro: "coriander",
  "italian parsley": "parsley",
  "flat-leaf parsley": "parsley",
  "flat leaf parsley": "parsley",
  // oils / fats
  evoo: "olive oil",
  "extra virgin olive oil": "olive oil",
  "extra-virgin olive oil": "olive oil",
  // cheeses
  parmesan: "parmigiano reggiano",
  "parmesan cheese": "parmigiano reggiano",
  "parmigiano-reggiano": "parmigiano reggiano",
  "pecorino romano cheese": "pecorino romano",
  "mozzarella di bufala": "mozzarella cheese",
  "fresh mozzarella": "mozzarella cheese",
  mozzarella: "mozzarella cheese",
  // tomatoes
  "san marzano tomato": "tomato",
  "san marzano": "tomato",
  "heirloom tomato": "tomato",
  "roma tomato": "tomato",
  "plum tomato": "tomato",
  // pasta
  "fresh tagliatelle": "tagliatelle",
  "spaghetti pasta": "spaghetti",
  // misc pantry
  "black pepper": "black peppercorn",
  "black peppercorns": "black peppercorn",
  "kosher salt": "salt",
  "sea salt": "salt",
};

const FUZZY_THRESHOLD = 92;

// ── normalize ───────────────────────────────────────────────────────
export function normalize(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/\([^)]*\)/g, " "); // strip parentheticals
  s = s.replace(/[^a-z0-9\s\-]/g, " "); // drop punctuation/diacritics-ish
  s = s.replace(/\s+/g, " ").trim();
  // naive singularization on the LAST word only (avoid mangling "olives oil")
  const parts = s.split(" ");
  const last = parts[parts.length - 1];
  if (last && last.length > 3) {
    if (last.endsWith("ies")) parts[parts.length - 1] = last.slice(0, -3) + "y";
    else if (last.endsWith("ses") || last.endsWith("xes")) parts[parts.length - 1] = last.slice(0, -2);
    else if (last.endsWith("s") && !last.endsWith("ss")) parts[parts.length - 1] = last.slice(0, -1);
  }
  return parts.join(" ");
}

function applySynonym(canonical: string): string {
  return SYNONYMS[canonical] ?? canonical;
}

// ── fuzzy cluster ───────────────────────────────────────────────────
// Build clusters incrementally. For each new name, find an existing cluster
// where token_set_ratio against the cluster's representative is ≥ threshold;
// otherwise start a new cluster. Representative = the most-frequent name in
// the cluster (tie-break: shortest, then lexicographic).
interface Cluster {
  names: string[]; // every member name (with duplicates)
}

function clusterByFuzzy(canonicals: string[]): Map<string, string> {
  const clusters: Cluster[] = [];

  for (const name of canonicals) {
    let placed = false;
    for (const cluster of clusters) {
      const rep = cluster.names[0];
      if (token_set_ratio(name, rep) >= FUZZY_THRESHOLD) {
        cluster.names.push(name);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ names: [name] });
  }

  // Pick representative per cluster.
  const nameToRep = new Map<string, string>();
  for (const cluster of clusters) {
    const counts = new Map<string, number>();
    for (const n of cluster.names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // most frequent
      if (a[0].length !== b[0].length) return a[0].length - b[0].length; // shorter wins
      return a[0].localeCompare(b[0]);
    });
    const rep = sorted[0][0];
    for (const member of new Set(cluster.names)) nameToRep.set(member, rep);
  }
  return nameToRep;
}

// ── roll-up helpers ─────────────────────────────────────────────────
function mode<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = values[0];
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function dominantUnit(occurrences: IngredientOccurrence[]): string {
  const totals = new Map<string, number>();
  for (const o of occurrences) {
    totals.set(o.unit, (totals.get(o.unit) ?? 0) + o.estimatedQuantity);
  }
  let best = occurrences[0].unit;
  let bestQty = -Infinity;
  for (const [u, q] of totals) {
    if (q > bestQty) {
      best = u;
      bestQty = q;
    }
  }
  return best;
}

// ── public API ──────────────────────────────────────────────────────
export function aggregateIngredients(dishes: ParsedDish[]): AggregatedIngredient[] {
  // Step 1+2: normalize + synonym for every occurrence.
  type Occ = IngredientOccurrence & { norm: string; category: Category };
  const occs: Occ[] = [];
  for (const dish of dishes) {
    for (const ing of dish.ingredients) {
      const norm = applySynonym(normalize(ing.canonicalName));
      occs.push({
        dishIndex: dish.dishIndex,
        rawName: ing.rawName,
        estimatedQuantity: ing.estimatedQuantity,
        unit: ing.unit.toLowerCase().trim(),
        confidence: ing.confidence,
        assumptionNote: ing.assumptionNote,
        norm,
        category: ing.category,
      });
    }
  }

  // Step 3: fuzzy cluster.
  const allNames = occs.map((o) => o.norm);
  const nameToRep = clusterByFuzzy(allNames);

  // Step 4: roll-up.
  const groups = new Map<string, Occ[]>();
  for (const o of occs) {
    const rep = nameToRep.get(o.norm) ?? o.norm;
    const arr = groups.get(rep) ?? [];
    arr.push(o);
    groups.set(rep, arr);
  }

  const aggregated: AggregatedIngredient[] = [];
  for (const [canonicalName, members] of groups) {
    aggregated.push({
      canonicalName,
      category: mode(members.map((m) => m.category)),
      defaultUnit: dominantUnit(members),
      occurrences: members.map((m) => ({
        dishIndex: m.dishIndex,
        rawName: m.rawName,
        estimatedQuantity: m.estimatedQuantity,
        unit: m.unit,
        confidence: m.confidence,
        assumptionNote: m.assumptionNote,
      })),
    });
  }
  return aggregated;
}
