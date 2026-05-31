// Tiny unit-normalization helper.
//
// Three dimensions only: mass (base lb), count (base each), volume (base gal).
// Anything else passes through as `dimension: "unknown"` so callers can
// treat it as opaque — the goal is graceful degradation, not a full UoM library.
//
// We keep the table closed (no plugin mechanism) — a take-home that needs
// "cup → gal" later can just add the row. No registration ceremony.

export type Dimension = "mass" | "count" | "volume" | "unknown";

export interface Normalized {
  qty: number;
  unit: string; // base unit for the dimension, or the original unit when unknown
  dimension: Dimension;
  original: { qty: number; unit: string };
}

interface UnitMeta {
  factor: number; // multiply qty by `factor` to get base-unit qty
  dim: Exclude<Dimension, "unknown">;
  base: string;
}

const MASS_BASE = "lb";
const COUNT_BASE = "each";
const VOLUME_BASE = "gal";

/** Closed set of recognised units. Aliases lowercased and stripped of punctuation. */
const TABLE: Record<string, UnitMeta> = {
  // mass → lb
  lb:   { factor: 1, dim: "mass", base: MASS_BASE },
  lbs:  { factor: 1, dim: "mass", base: MASS_BASE },
  pound:{ factor: 1, dim: "mass", base: MASS_BASE },
  pounds:{factor: 1, dim: "mass", base: MASS_BASE },
  oz:   { factor: 1 / 16, dim: "mass", base: MASS_BASE },
  ozs:  { factor: 1 / 16, dim: "mass", base: MASS_BASE },
  ounce:{ factor: 1 / 16, dim: "mass", base: MASS_BASE },
  ounces:{factor: 1 / 16, dim: "mass", base: MASS_BASE },
  kg:   { factor: 2.20462, dim: "mass", base: MASS_BASE },
  kgs:  { factor: 2.20462, dim: "mass", base: MASS_BASE },
  g:    { factor: 0.00220462, dim: "mass", base: MASS_BASE },
  gram: { factor: 0.00220462, dim: "mass", base: MASS_BASE },
  grams:{ factor: 0.00220462, dim: "mass", base: MASS_BASE },

  // count → each
  each:  { factor: 1, dim: "count", base: COUNT_BASE },
  ea:    { factor: 1, dim: "count", base: COUNT_BASE },
  unit:  { factor: 1, dim: "count", base: COUNT_BASE },
  units: { factor: 1, dim: "count", base: COUNT_BASE },
  doz:   { factor: 12, dim: "count", base: COUNT_BASE },
  dozen: { factor: 12, dim: "count", base: COUNT_BASE },
  dozens:{ factor: 12, dim: "count", base: COUNT_BASE },

  // volume → gal
  gal:  { factor: 1, dim: "volume", base: VOLUME_BASE },
  gals: { factor: 1, dim: "volume", base: VOLUME_BASE },
  gallon:{factor: 1, dim: "volume", base: VOLUME_BASE },
  gallons:{factor: 1, dim: "volume", base: VOLUME_BASE },
  qt:   { factor: 0.25, dim: "volume", base: VOLUME_BASE },
  quart:{ factor: 0.25, dim: "volume", base: VOLUME_BASE },
  quarts:{factor: 0.25, dim: "volume", base: VOLUME_BASE },
  pt:   { factor: 0.125, dim: "volume", base: VOLUME_BASE },
  pint: { factor: 0.125, dim: "volume", base: VOLUME_BASE },
  pints:{ factor: 0.125, dim: "volume", base: VOLUME_BASE },
  floz: { factor: 1 / 128, dim: "volume", base: VOLUME_BASE },
  "fl oz":{factor: 1 / 128, dim: "volume", base: VOLUME_BASE },
};

const canon = (u: string): string =>
  u.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

// ── USDA retail-pack normalization ─────────────────────────────────
//
// USDA MARS reports quote prices in pack units that vary by commodity
// and report. We convert the common, unambiguous packs to per-base-unit
// (per-lb for mass, per-each for count). Packs we cannot disambiguate
// without commodity-specific info (a bare "carton" or "case") are flagged
// opaque, and callers must skip pricing math on those rows.

type OpaquePack = { opaque: true; reason: string };

const RETAIL_PACK_TABLE: Record<string, UnitMeta | OpaquePack> = {
  // mass packs
  cwt: { factor: 100, dim: "mass", base: MASS_BASE },
  "hundred weight": { factor: 100, dim: "mass", base: MASS_BASE },
  "100 lb": { factor: 100, dim: "mass", base: MASS_BASE },
  "100 lbs": { factor: 100, dim: "mass", base: MASS_BASE },
  "50 lb": { factor: 50, dim: "mass", base: MASS_BASE },
  "50 lb sack": { factor: 50, dim: "mass", base: MASS_BASE },
  "50 lb bag": { factor: 50, dim: "mass", base: MASS_BASE },
  "40 lb": { factor: 40, dim: "mass", base: MASS_BASE },
  "40 lb carton": { factor: 40, dim: "mass", base: MASS_BASE },
  "30 lb": { factor: 30, dim: "mass", base: MASS_BASE },
  "30 lb carton": { factor: 30, dim: "mass", base: MASS_BASE },
  "25 lb": { factor: 25, dim: "mass", base: MASS_BASE },
  "25 lb carton": { factor: 25, dim: "mass", base: MASS_BASE },
  "20 lb": { factor: 20, dim: "mass", base: MASS_BASE },
  "20 lb carton": { factor: 20, dim: "mass", base: MASS_BASE },
  "10 lb": { factor: 10, dim: "mass", base: MASS_BASE },
  "10 lb carton": { factor: 10, dim: "mass", base: MASS_BASE },
  "5 lb": { factor: 5, dim: "mass", base: MASS_BASE },
  "5 lb bag": { factor: 5, dim: "mass", base: MASS_BASE },
  // commodity-agnostic bushel approximation; varies in reality (apple 42 lb,
  // tomato 53 lb, peach 50 lb). The generic 50 lb is good enough for round
  // demo numbers; a commodity-aware table is out of scope.
  bushel: { factor: 50, dim: "mass", base: MASS_BASE },
  "1 1/9 bushel": { factor: 25, dim: "mass", base: MASS_BASE },
  "5/9 bushel": { factor: 12, dim: "mass", base: MASS_BASE },

  // count packs
  "24 ct carton": { factor: 24, dim: "count", base: COUNT_BASE },
  "24 count carton": { factor: 24, dim: "count", base: COUNT_BASE },
  "18 ct carton": { factor: 18, dim: "count", base: COUNT_BASE },
  "12 ct carton": { factor: 12, dim: "count", base: COUNT_BASE },
  "30 ct flat": { factor: 30, dim: "count", base: COUNT_BASE },
  flat: { factor: 30, dim: "count", base: COUNT_BASE }, // strawberry/berry flat ~ 12 pints; rough
  crate: { factor: 24, dim: "count", base: COUNT_BASE },

  // opaque packs: pack size depends on commodity and isn't stated
  carton: { opaque: true, reason: "carton size not stated" },
  ctn: { opaque: true, reason: "carton size not stated" },
  cs: { opaque: true, reason: "case pack not stated" },
  case: { opaque: true, reason: "case pack not stated" },
  package: { opaque: true, reason: "package size not stated" },
  pkg: { opaque: true, reason: "package size not stated" },
  container: { opaque: true, reason: "container size not stated" },
};

export type PackNormalized =
  | {
      ok: true;
      /** How many base units one pack equals. e.g. `cwt` → 100, `25 lb carton` → 25, `oz` → 1/16. */
      baseQtyPerPack: number;
      /** Base unit name: "lb" for mass, "each" for count, "gal" for volume. */
      base: string;
      dim: Exclude<Dimension, "unknown">;
    }
  | OpaquePack;

/**
 * Resolve a USDA-style pack unit to its base-unit equivalence. Returns
 * `baseQtyPerPack` so callers can compute price-per-base-unit as
 * `pricePerPack / baseQtyPerPack` (a $45/cwt price becomes $0.45/lb since
 * 1 cwt = 100 lb).
 *
 * Falls back to the standard `TABLE` first (lb, oz, kg, dozen, etc.),
 * then tries `RETAIL_PACK_TABLE`. Anything else is opaque and the caller
 * must skip pricing math on that row.
 */
export function normalizePackUnit(unit: string): PackNormalized {
  const u = canon(unit);
  const compact = u.replace(/\s+/g, "");
  // First try the standard table so common units like "lb" pass through
  // with factor 1.
  const meta = TABLE[u] ?? TABLE[compact];
  if (meta) {
    return { ok: true, baseQtyPerPack: meta.factor, base: meta.base, dim: meta.dim };
  }
  // Then try the retail pack table.
  const pack = RETAIL_PACK_TABLE[u] ?? RETAIL_PACK_TABLE[compact];
  if (pack) {
    if ("opaque" in pack) return { opaque: true, reason: pack.reason };
    return { ok: true, baseQtyPerPack: pack.factor, base: pack.base, dim: pack.dim };
  }
  return { opaque: true, reason: `unrecognized unit "${unit}"` };
}

export function normalize(qty: number, unit: string): Normalized {
  const u = canon(unit);
  const compact = u.replace(/\s+/g, ""); // try "fl oz" → "floz"
  const meta = TABLE[u] ?? TABLE[compact];
  if (!meta) {
    return { qty, unit, dimension: "unknown", original: { qty, unit } };
  }
  return {
    qty: qty * meta.factor,
    unit: meta.base,
    dimension: meta.dim,
    original: { qty, unit },
  };
}

/**
 * Sum two normalized values when their dimensions match. Returns null if
 * dimensions differ or either is "unknown" — caller decides what to do
 * (typically: keep the dominant one and annotate "mixed units").
 */
export function sumCompatible(a: Normalized, b: Normalized): Normalized | null {
  if (a.dimension === "unknown" || b.dimension === "unknown") return null;
  if (a.dimension !== b.dimension) return null;
  return {
    qty: a.qty + b.qty,
    unit: a.unit, // both are at base for this dimension
    dimension: a.dimension,
    original: a.original, // not meaningful after a sum; keep the first
  };
}

/**
 * Sum a list of (qty, unit) occurrences, expressing the result in the dominant
 * dimension's base unit. If occurrences span multiple dimensions (e.g. mass +
 * volume), keeps the dominant-by-quantity dimension's sum and flags `mixed: true`
 * so the caller can annotate. Unknown units are passed through additively in
 * their input dimension; mixed unknown+known returns `mixed: true`.
 */
export function sumOccurrences(
  occurrences: Array<{ qty: number; unit: string }>,
): { qty: number; unit: string; dimension: Dimension; mixed: boolean } {
  if (occurrences.length === 0) {
    return { qty: 0, unit: "each", dimension: "count", mixed: false };
  }
  const normalized = occurrences.map((o) => normalize(o.qty, o.unit));
  const dimensions = new Set(normalized.map((n) => n.dimension));
  const mixed = dimensions.size > 1;

  if (!mixed) {
    const dim = normalized[0].dimension;
    if (dim === "unknown") {
      // No conversion possible; just sum raw qty in the original unit (first occurrence's).
      const unit = occurrences[0].unit;
      const qty = occurrences.reduce((a, o) => a + o.qty, 0);
      return { qty: Math.round(qty * 100) / 100, unit, dimension: "unknown", mixed: false };
    }
    const total = normalized.reduce((a, n) => a + n.qty, 0);
    return {
      qty: Math.round(total * 100) / 100,
      unit: normalized[0].unit, // base unit for the dimension
      dimension: dim,
      mixed: false,
    };
  }

  // Mixed dimensions: pick the dimension with the largest summed qty (in its base).
  const byDim = new Map<Dimension, number>();
  for (const n of normalized) {
    byDim.set(n.dimension, (byDim.get(n.dimension) ?? 0) + n.qty);
  }
  let bestDim: Dimension = "unknown";
  let bestQty = -Infinity;
  for (const [d, q] of byDim) {
    if (q > bestQty) {
      bestDim = d;
      bestQty = q;
    }
  }
  const winnerOcc = normalized.find((n) => n.dimension === bestDim)!;
  return {
    qty: Math.round(bestQty * 100) / 100,
    unit: winnerOcc.unit,
    dimension: bestDim,
    mixed: true,
  };
}

/** Format a normalized qty in either its base unit or a display override. */
export function formatQty(n: Normalized, displayUnit?: string): string {
  if (!displayUnit || canon(displayUnit) === n.unit) {
    return `${Math.round(n.qty * 100) / 100} ${n.unit}`;
  }
  const meta = TABLE[canon(displayUnit)];
  if (!meta || meta.base !== n.unit) {
    return `${Math.round(n.qty * 100) / 100} ${n.unit}`;
  }
  // Convert from base back to display unit by dividing by factor.
  const out = n.qty / meta.factor;
  return `${Math.round(out * 100) / 100} ${displayUnit}`;
}
