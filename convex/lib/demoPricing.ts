// Wholesale price lookup for demo-mode replies. Generates realistic
// per-line prices so the recommendation engine produces a confident award
// (high completeness, clear margin) instead of flagging the run for review.
// Production replies come from real distributors and never touch this file.

import { CATEGORY_AVG_PRICE, type Category } from "./fuzzy";

const TABLE: Record<string, number> = {
  // ── produce
  tomato: 2.2,
  "san marzano tomato": 2.85,
  "heirloom tomato": 3.1,
  basil: 14.0,
  garlic: 4.5,
  onion: 0.9,
  carrot: 1.2,
  celery: 1.45,
  lemon: 1.8,
  parsley: 6.5,
  escarole: 2.6,
  beet: 1.4,
  potato: 0.85,
  pepper: 1.8,
  // ── dairy
  "mozzarella cheese": 5.8,
  "mozzarella di bufala": 9.5,
  "parmigiano reggiano cheese": 18.5,
  "pecorino romano cheese": 16.0,
  "pecorino toscano cheese": 16.5,
  "mascarpone cheese": 7.5,
  "goat cheese": 12.0,
  "burrata cheese": 11.0,
  butter: 4.1,
  egg: 3.2,
  cream: 3.6,
  // ── meat / seafood
  "ground beef": 6.2,
  "ground pork": 4.8,
  "veal shank": 11.0,
  pork: 5.4,
  "pork sausage": 5.9,
  sausage: 5.9,
  chicken: 3.6,
  "half chicken": 3.6,
  "prosciutto di parma": 28.0,
  prosciutto: 24.0,
  soppressata: 18.0,
  // ── pantry / dry
  "olive oil": 7.5, // per L
  "extra virgin olive oil": 8.5, // per L
  "evoo": 8.5,
  "rustic bread": 3.2,
  bread: 3.0,
  crostini: 4.2,
  "spaghetti pasta": 1.95,
  spaghetti: 1.95,
  "tagliatelle pasta": 2.4,
  tagliatelle: 2.4,
  bucatini: 2.1,
  cavatelli: 2.3,
  gnocchi: 3.0,
  flour: 0.85,
  "flour 00": 1.1,
  salt: 0.4,
  "black peppercorn": 9.0,
  pepper_dry: 9.0,
  water: 0.3,
  "white wine": 8.0, // per L
  "red wine": 8.5, // per L
  marinara: 3.4,
  "tomato sauce": 3.0,
  cannellini: 2.4,
  "marinated olives": 6.5,
  olive: 6.0,
  "olive oil cake": 9.0,
  "savoiardi biscuit": 5.2,
  ladyfinger: 5.2,
  cocoa: 4.1,
  "cocoa powder": 4.1,
  espresso: 14.0,
  coffee: 12.0,
  sugar: 0.7,
  vanilla: 28.0,
};

/**
 * Best-effort lookup for a canonical name. Falls back through:
 *   1. Exact match
 *   2. Last-word match (e.g. "san marzano tomato" → "tomato" if needed)
 *   3. Category average (mass, lb)
 */
function basePriceFor(canonicalName: string, category: Category): number {
  const key = canonicalName.trim().toLowerCase();
  if (TABLE[key] !== undefined) return TABLE[key];
  // Try the head noun (last token).
  const tokens = key.split(/\s+/);
  if (tokens.length > 1) {
    const head = tokens[tokens.length - 1];
    if (TABLE[head] !== undefined) return TABLE[head];
  }
  return CATEGORY_AVG_PRICE[category]?.price ?? 5.0;
}

/**
 * Return a wholesale price for one basket line, biased per distributor and
 * jittered ±3% so distributors don't all show identical prices. `bias`
 * controls the distributor's relative pricing posture: values below 1
 * make them cheaper (winner), above 1 makes them pricier (also-rans).
 */
export function demoPriceFor(
  canonicalName: string,
  category: Category,
  bias: number,
): number {
  const base = basePriceFor(canonicalName, category);
  const jitter = 1 + (Math.random() * 0.06 - 0.03); // ±3%
  const priced = base * bias * jitter;
  // Round to 2 decimals.
  return Math.round(priced * 100) / 100;
}

/**
 * Pick a per-line unit string for the reply body. Most items quote per lb;
 * oils and wines quote per L. Canonical name matching is permissive.
 */
export function demoUnitFor(canonicalName: string): string {
  const k = canonicalName.toLowerCase();
  if (k.includes("oil")) return "L";
  if (k.includes("wine")) return "L";
  if (k.includes("egg")) return "dozen";
  return "lb";
}
