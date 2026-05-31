// Phase 3 — fetch_pricing orchestration.
//
// Responsibilities:
//   - Read every ingredient.
//   - For each, fuzzy-route to a USDA MARS report; if no API key is set,
//     write a "mock" price from the category-average table.
//   - Compute % trend vs the prior report date.
//   - Idempotently upsert ingredientPrices keyed by (ingredientId, reportDate).
//
// IO lives in `fetchAllPricesAction`; DB writes live in `upsertIngredientPrice`.
// The stage wrapper in pipeline/fetchPricing.ts just calls the action.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { optional } from "./lib/env";
import {
  UsdaMarsClient,
  groupRowsByDateDesc,
  type NormalizedRow,
} from "./lib/usda";
import {
  bestMatch,
  CATEGORY_AVG_PRICE,
  CONFIDENCE_THRESHOLD,
  PRIMARY_REPORT_BY_CATEGORY,
  SECONDARY_REPORT_BY_CATEGORY,
  similarity,
  weakMatches,
  type Category,
  type ReportSlug,
} from "./lib/fuzzy";
import { normalizePackUnit } from "./lib/units";
import { runWithConcurrency } from "./lib/concurrency";

const sourceValidator = v.union(
  v.literal("usda_mars"),
  v.literal("usda_nass"),
  v.literal("estimated"),
  v.literal("mock"),
);

// ── Internal mutations ──────────────────────────────────────────────────────

/**
 * Upsert keyed by (ingredientId, reportDate). The schema index
 * `by_ingredient_and_reportDate` makes this O(1).
 */
const estimationDetailValidator = v.object({
  method: v.union(v.literal("neighbors"), v.literal("category")),
  category: v.optional(v.string()),
  contributingReports: v.optional(
    v.array(
      v.object({
        commodity: v.string(),
        price: v.number(),
        confidence: v.number(),
        region: v.optional(v.string()),
      }),
    ),
  ),
});

export const upsertIngredientPrice = internalMutation({
  args: {
    ingredientId: v.id("ingredients"),
    source: sourceValidator,
    price: v.optional(v.number()),
    unit: v.string(),
    region: v.optional(v.string()),
    reportDate: v.string(),
    weightedAvg: v.optional(v.number()),
    priceRangeLow: v.optional(v.number()),
    priceRangeHigh: v.optional(v.number()),
    matchConfidence: v.number(),
    unmatched: v.boolean(),
    trend: v.optional(v.number()),
    trendPriorDate: v.optional(v.string()),
    usdaUnit: v.optional(v.string()),
    reportSlug: v.optional(v.string()),
    priceUnitIncomparable: v.optional(v.boolean()),
    rawUsdaPayload: v.optional(v.any()),
    estimationDetail: v.optional(estimationDetailValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ingredientPrices")
      .withIndex("by_ingredient_and_reportDate", (q) =>
        q.eq("ingredientId", args.ingredientId).eq("reportDate", args.reportDate),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("ingredientPrices", args);
  },
});

export const listIngredientsQ = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"ingredients">[]> => ctx.db.query("ingredients").collect(),
});

// ── Pure helpers ───────────────────────────────────────────────────────────

interface EstimationDetail {
  method: "neighbors" | "category";
  category?: string;
  contributingReports?: {
    commodity: string;
    price: number;
    confidence: number;
    region?: string;
  }[];
}

interface PricedResult {
  source: "usda_mars" | "estimated" | "mock";
  price?: number;
  unit: string;
  reportDate: string;
  weightedAvg?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  region?: string;
  matchConfidence: number;
  unmatched: boolean;
  trend?: number;
  trendPriorDate?: string;
  usdaUnit?: string;
  reportSlug?: string;
  priceUnitIncomparable?: boolean;
  rawUsdaPayload?: unknown;
  estimationDetail?: EstimationDetail;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build a fallback "estimated"/"mock" priced result for an ingredient. */
function categoryFallback(
  ingredient: Doc<"ingredients">,
  source: "estimated" | "mock",
  matchConfidence: number,
): PricedResult {
  const category = ingredient.category as Category;
  const avg = CATEGORY_AVG_PRICE[category];
  return {
    source,
    price: avg.price,
    unit: ingredient.defaultUnit || avg.unit,
    reportDate: today(),
    matchConfidence,
    // Both mock and estimated rows are guesses. We previously left mock
    // as unmatched=false to call out the difference, but the user-facing
    // story is the same (no live measurement), so the flag is honest now.
    unmatched: true,
    trend: undefined,
    estimationDetail: { method: "category", category },
  };
}

/** Plain numeric median; small enough to inline but reads cleaner this way. */
function median(nums: number[]): number {
  const xs = [...nums].sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return xs[(n - 1) / 2];
  return (xs[n / 2 - 1] + xs[n / 2]) / 2;
}

/**
 * When the primary report's best match is too weak to trust, try to derive a
 * neighbor-median estimate from 2+ near-misses in the same report. Returns
 * null if there aren't enough qualifying weak matches with usable prices.
 */
function tryNeighborMedian(
  ingredient: Doc<"ingredients">,
  rows: NormalizedRow[],
): PricedResult | null {
  if (rows.length === 0) return null;
  const byDate = groupRowsByDateDesc(rows);
  const dates = [...byDate.keys()];
  if (dates.length === 0) return null;
  const latestRows = byDate.get(dates[0]) ?? [];
  const weaks = weakMatches(ingredient.canonicalName, latestRows);

  const priced = weaks
    .map(({ candidate, confidence }) => {
      const p =
        candidate.weightedAvg ??
        (candidate.priceRangeLow != null && candidate.priceRangeHigh != null
          ? (candidate.priceRangeLow + candidate.priceRangeHigh) / 2
          : null);
      return p != null ? { candidate, confidence, price: p } : null;
    })
    .filter((x): x is { candidate: NormalizedRow; confidence: number; price: number } => x !== null);

  if (priced.length < 2) return null;

  // Anchor unit on the highest-confidence weak match. Only count contributors
  // with the same unit so we don't average $/lb with $/dozen.
  const anchorUnit = priced[0].candidate.unit;
  const sameUnit = priced.filter((p) => p.candidate.unit === anchorUnit);
  if (sameUnit.length < 2) return null;

  const top = sameUnit.slice(0, 5);
  const med = median(top.map((p) => p.price));

  // Pack-unit normalization: convert the median pack price to per-base-unit.
  let displayPrice = med;
  let displayUnit = anchorUnit || ingredient.defaultUnit;
  let incomparable = false;
  const usdaUnit = anchorUnit;
  if (usdaUnit) {
    const norm = normalizePackUnit(usdaUnit);
    if ("ok" in norm) {
      displayUnit = norm.base;
      displayPrice = med / norm.baseQtyPerPack;
    } else {
      incomparable = true;
    }
  }

  return {
    source: "estimated",
    price: Math.round(displayPrice * 100) / 100,
    unit: displayUnit,
    reportDate: dates[0],
    matchConfidence: top[0].confidence,
    unmatched: true,
    trend: undefined,
    usdaUnit,
    priceUnitIncomparable: incomparable || undefined,
    estimationDetail: {
      method: "neighbors",
      contributingReports: top.map((p) => ({
        commodity: p.candidate.commodity,
        price: Math.round(p.price * 100) / 100,
        confidence: Math.round(p.confidence * 100) / 100,
        region: p.candidate.region,
      })),
    },
  };
}

// Min similarity for a prior-date row to count as the same commodity for
// trend purposes. Lower than CONFIDENCE_THRESHOLD because we're comparing
// USDA labels to themselves; small spelling drift ("Roma Tomatoes" vs
// "Tomatoes Roma") should still match.
const TREND_NAME_SIMILARITY = 0.85;

/**
 * Compute % change of `weightedAvg` between the latest report date and
 * the most recent prior date that holds a matching commodity. Matches
 * across dates use fuzzy name similarity, not exact equality, so minor
 * USDA label drift doesn't kill the trend. Returns the signed percentage
 * (2dp) and the prior date used as the denominator. Either field is null
 * when not computable.
 */
function computeTrend(
  rowsByDateDesc: Map<string, NormalizedRow[]>,
  commodity: string,
): { pct: number | null; priorDate: string | null } {
  const dates = [...rowsByDateDesc.keys()];
  if (dates.length < 2) return { pct: null, priorDate: null };
  const [latest, ...priors] = dates;
  const latestRow = rowsByDateDesc.get(latest)?.find((r) => r.commodity === commodity);
  const a = latestRow?.weightedAvg;
  if (a == null) return { pct: null, priorDate: null };
  for (const priorDate of priors) {
    const priorRows = rowsByDateDesc.get(priorDate) ?? [];
    let bestRow: NormalizedRow | undefined;
    let bestScore = 0;
    for (const r of priorRows) {
      if (r.weightedAvg == null) continue;
      const sim = similarity(commodity, r.commodity);
      if (sim >= TREND_NAME_SIMILARITY && sim > bestScore) {
        bestRow = r;
        bestScore = sim;
      }
    }
    const b = bestRow?.weightedAvg;
    if (b != null && b !== 0) {
      const pct = Math.round(((a - b) / b) * 10000) / 100;
      return { pct, priorDate };
    }
  }
  return { pct: null, priorDate: null };
}

/** Try to price one ingredient against a fetched report. Returns null if no usable match. */
function tryMatchReport(
  ingredient: Doc<"ingredients">,
  rows: NormalizedRow[],
  reportSlug?: string,
): PricedResult | null {
  if (rows.length === 0) return null;
  const byDate = groupRowsByDateDesc(rows);
  const dates = [...byDate.keys()];
  if (dates.length === 0) return null;
  const latestRows = byDate.get(dates[0]) ?? [];
  if (latestRows.length === 0) return null;

  const { candidate, confidence } = bestMatch(ingredient.canonicalName, latestRows);
  if (!candidate) return null;

  if (confidence < CONFIDENCE_THRESHOLD) {
    // Caller will decide whether to try secondary report or fall back.
    return null;
  }

  const { pct: trendPct, priorDate: trendPriorDate } = computeTrend(byDate, candidate.commodity);
  const rawPackPrice =
    candidate.weightedAvg ??
    (candidate.priceRangeLow != null && candidate.priceRangeHigh != null
      ? (candidate.priceRangeLow + candidate.priceRangeHigh) / 2
      : undefined);

  // Normalize the USDA pack unit to per-base-unit (per-lb / per-each /
  // per-gal). If the pack is opaque (bare "carton", "case") we keep the
  // price but flag the row incomparable so the UI excludes it from totals.
  const usdaUnit = candidate.unit || ingredient.defaultUnit;
  let displayPrice = rawPackPrice;
  let displayUnit = usdaUnit;
  let priceLow = candidate.priceRangeLow ?? undefined;
  let priceHigh = candidate.priceRangeHigh ?? undefined;
  let incomparable = false;

  if (usdaUnit) {
    const norm = normalizePackUnit(usdaUnit);
    if ("ok" in norm) {
      displayUnit = norm.base;
      if (rawPackPrice != null) displayPrice = rawPackPrice / norm.baseQtyPerPack;
      if (priceLow != null) priceLow = priceLow / norm.baseQtyPerPack;
      if (priceHigh != null) priceHigh = priceHigh / norm.baseQtyPerPack;
    } else {
      incomparable = true;
    }
  }

  return {
    source: "usda_mars",
    price: displayPrice != null ? Math.round(displayPrice * 100) / 100 : undefined,
    unit: displayUnit,
    reportDate: dates[0],
    weightedAvg: candidate.weightedAvg ?? undefined,
    priceRangeLow: priceLow != null ? Math.round(priceLow * 100) / 100 : undefined,
    priceRangeHigh: priceHigh != null ? Math.round(priceHigh * 100) / 100 : undefined,
    region: candidate.region,
    matchConfidence: confidence,
    unmatched: false,
    trend: trendPct ?? undefined,
    trendPriorDate: trendPriorDate ?? undefined,
    usdaUnit,
    reportSlug,
    priceUnitIncomparable: incomparable || undefined,
    rawUsdaPayload: candidate.raw,
  };
}

// Fetched per orchestrator invocation: at most one request per slug, even
// under concurrent workers. The settled result lives in `reportCache`; the
// in-flight Promise lives in `inFlightReports` so concurrent callers share
// the same fetch.
const REPORT_WINDOW = 4;

async function priceOneIngredient(
  client: UsdaMarsClient,
  ingredient: Doc<"ingredients">,
  reportCache: Map<ReportSlug, NormalizedRow[]>,
  inFlightReports: Map<ReportSlug, Promise<NormalizedRow[]>>,
): Promise<PricedResult> {
  const category = ingredient.category as Category;
  const primary = PRIMARY_REPORT_BY_CATEGORY[category];
  const secondary = SECONDARY_REPORT_BY_CATEGORY[category];

  const getReport = async (slug: ReportSlug): Promise<NormalizedRow[]> => {
    const cached = reportCache.get(slug);
    if (cached) return cached;
    const pending = inFlightReports.get(slug);
    if (pending) return pending;
    const p = (async () => {
      try {
        return await client.fetchReport(slug, REPORT_WINDOW);
      } catch {
        return [] as NormalizedRow[];
      }
    })();
    inFlightReports.set(slug, p);
    try {
      const rows = await p;
      reportCache.set(slug, rows);
      return rows;
    } finally {
      inFlightReports.delete(slug);
    }
  };

  const primaryRows = await getReport(primary);
  const primaryHit = tryMatchReport(ingredient, primaryRows, primary);
  if (primaryHit) return primaryHit;

  let secondaryRows: NormalizedRow[] = [];
  let usedSecondary: ReportSlug | undefined;
  if (secondary) {
    secondaryRows = await getReport(secondary);
    usedSecondary = secondary;
    const secondaryHit = tryMatchReport(ingredient, secondaryRows, secondary);
    if (secondaryHit) return secondaryHit;
  }

  // No clean match on either report. Before defaulting to a static category
  // average, look for a cluster of weak USDA matches and take their median.
  // Try the primary report first (richer for the category), then secondary.
  const neighborHit =
    tryNeighborMedian(ingredient, primaryRows) ??
    tryNeighborMedian(ingredient, secondaryRows);
  if (neighborHit) {
    neighborHit.reportSlug = primaryRows.length > 0 ? primary : usedSecondary;
    return neighborHit;
  }

  // Best-effort: compute a weak match confidence on the primary report to
  // record alongside the fallback price.
  let weakConfidence = 0;
  if (primaryRows.length > 0) {
    const byDate = groupRowsByDateDesc(primaryRows);
    const latestDate = [...byDate.keys()][0];
    const latestRows = latestDate ? (byDate.get(latestDate) ?? []) : [];
    const { confidence } = bestMatch(ingredient.canonicalName, latestRows);
    weakConfidence = confidence;
  }
  const fallback = categoryFallback(ingredient, "estimated", weakConfidence);
  fallback.reportSlug = primary;
  return fallback;
}

// ── Orchestrator action ────────────────────────────────────────────────────

interface FetchAllSummary {
  summary: string;
}

export const fetchAllPricesAction = internalAction({
  args: {},
  handler: async (ctx): Promise<FetchAllSummary> => {
    const ingredients = await ctx.runQuery(internal.pricing.listIngredientsQ, {});
    const apiKey = optional("USDA_MARS_API_KEY");

    // Mock mode: no key → category averages for everyone, source = "mock".
    if (!apiKey) {
      for (const ing of ingredients) {
        const r = categoryFallback(ing, "mock", 0);
        await ctx.runMutation(internal.pricing.upsertIngredientPrice, {
          ingredientId: ing._id,
          source: r.source,
          price: r.price,
          unit: r.unit,
          reportDate: r.reportDate,
          matchConfidence: 0,
          unmatched: r.unmatched,
          trend: undefined,
        });
      }
      return {
        summary: `${ingredients.length} priced (mock mode) · 0 no public data · ${ingredients.length} ingredients`,
      };
    }

    const client = new UsdaMarsClient(apiKey);
    const reportCache = new Map<ReportSlug, NormalizedRow[]>();
    const inFlightReports = new Map<ReportSlug, Promise<NormalizedRow[]>>();

    // Warm the commodities list once (cached on the client).
    try {
      await client.listCommodities();
    } catch {
      // Non-fatal: report endpoints still work without the catalog.
    }

    let priced = 0;
    let noData = 0;

    await runWithConcurrency(ingredients, 4, async (ing: Doc<"ingredients">) => {
      const result = await priceOneIngredient(client, ing, reportCache, inFlightReports);
      if (result.source === "usda_mars" && result.price != null) priced++;
      else noData++;
      await ctx.runMutation(internal.pricing.upsertIngredientPrice, {
        ingredientId: ing._id,
        source: result.source,
        price: result.price,
        unit: result.unit,
        region: result.region,
        reportDate: result.reportDate,
        weightedAvg: result.weightedAvg,
        priceRangeLow: result.priceRangeLow,
        priceRangeHigh: result.priceRangeHigh,
        matchConfidence: result.matchConfidence,
        unmatched: result.unmatched,
        trend: result.trend,
        trendPriorDate: result.trendPriorDate,
        usdaUnit: result.usdaUnit,
        reportSlug: result.reportSlug,
        priceUnitIncomparable: result.priceUnitIncomparable,
        rawUsdaPayload: result.rawUsdaPayload,
        estimationDetail: result.estimationDetail,
      });
    });

    return {
      summary: `${priced} priced · ${noData} no public data · ${ingredients.length} ingredients`,
    };
  },
});

// Convenience type re-export used by the stage wrapper.
export type { Id };

// ── Public reactive query: feeds PricingPanel ───────────────────────────────

type Provenance = "usda" | "estimated" | "mock" | "no_data";
type PriceProv = Doc<"ingredientPrices">["source"];

function provenanceFromSource(src: PriceProv): Provenance {
  if (src === "usda_mars" || src === "usda_nass") return "usda";
  if (src === "estimated") return "estimated";
  return "mock";
}

function sourceLabel(row: Doc<"ingredientPrices">): string {
  if (row.source === "usda_mars") {
    if (row.region) return `USDA MARS · ${row.region}`;
    if (row.reportSlug) return `USDA MARS · report ${row.reportSlug}`;
    return "USDA MARS";
  }
  if (row.source === "usda_nass") {
    if (row.region) return `USDA NASS · ${row.region}`;
    if (row.reportSlug) return `USDA NASS · report ${row.reportSlug}`;
    return "USDA NASS";
  }
  if (row.source === "estimated") {
    if (row.estimationDetail?.method === "neighbors") return "Estimated · USDA neighbors";
    return "Estimated · category avg";
  }
  return "Mock (category avg)";
}

export const getPricingForRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;

    // Source of basket: prefer rfp.ingredientList (snapshot from send-time);
    // otherwise derive from dishIngredients across the menu's dishes.
    type BasketItem = {
      ingredientId: Id<"ingredients">;
      qty: number;
      unit: string;
    };
    let basket: BasketItem[] = [];

    if (run.rfpId) {
      const rfp = await ctx.db.get(run.rfpId);
      if (rfp) {
        basket = rfp.ingredientList.map((l) => ({
          ingredientId: l.ingredientId,
          qty: l.quantity,
          unit: l.unit,
        }));
      }
    }
    if (basket.length === 0 && run.menuId) {
      const menuId = run.menuId;
      const dishes = await ctx.db
        .query("dishes")
        .withIndex("by_menuId", (q) => q.eq("menuId", menuId))
        .collect();
      const agg = new Map<string, BasketItem>();
      for (const dish of dishes) {
        const dis = await ctx.db
          .query("dishIngredients")
          .withIndex("by_dishId", (q) => q.eq("dishId", dish._id))
          .collect();
        for (const r of dis) {
          const k = r.ingredientId as unknown as string;
          const prev = agg.get(k);
          if (prev) prev.qty = Math.round((prev.qty + r.estimatedQuantity) * 10) / 10;
          else agg.set(k, { ingredientId: r.ingredientId, qty: r.estimatedQuantity, unit: r.unit });
        }
      }
      basket = [...agg.values()];
    }

    if (basket.length === 0) return null;

    type Row = {
      id: Id<"ingredients">;
      name: string;
      category: Doc<"ingredients">["category"];
      qty: number;
      unit: string;
      price: number | null;
      trend: number | null;
      trendPriorDate?: string;
      provenance: Provenance;
      sourceLabel: string;
      estimationDetail?: Doc<"ingredientPrices">["estimationDetail"];
      flag?: string;
      qtyDerivation?: string;
      priceRangeLow?: number;
      priceRangeHigh?: number;
      matchConfidence?: number;
      usdaUnit?: string;
      reportSlug?: string;
      priceUnitIncomparable?: boolean;
    };

    // Map dishId → dish name for the active menu, so we can show per-row
    // quantity derivation tooltips without N+1 dish lookups.
    const dishNameById = new Map<string, string>();
    if (run.menuId) {
      const menuDishes = await ctx.db
        .query("dishes")
        .withIndex("by_menuId", (q) => q.eq("menuId", run.menuId!))
        .collect();
      for (const d of menuDishes) {
        dishNameById.set(d._id as unknown as string, d.name);
      }
    }

    let latestReportDate = "";
    const rows: Row[] = [];
    for (const b of basket) {
      const ing = await ctx.db.get(b.ingredientId);
      if (!ing) continue;

      // Quantity derivation: list the contributing dishes from this menu.
      let qtyDerivation: string | undefined;
      const contributing = await ctx.db
        .query("dishIngredients")
        .withIndex("by_ingredientId", (q) => q.eq("ingredientId", b.ingredientId))
        .collect();
      const fromThisMenu = contributing.filter((c) =>
        dishNameById.has(c.dishId as unknown as string),
      );
      if (fromThisMenu.length > 0) {
        const top = [...fromThisMenu]
          .sort((a, b2) => b2.estimatedQuantity - a.estimatedQuantity)
          .slice(0, 3)
          .map(
            (c) =>
              `${dishNameById.get(c.dishId as unknown as string) ?? "dish"} (~${c.estimatedQuantity.toFixed(1)} ${c.unit})`,
          );
        const rest = fromThisMenu.length - top.length;
        qtyDerivation =
          `${b.qty} ${b.unit}/wk total. From ${top.join(", ")}` +
          (rest > 0 ? `, plus ${rest} other dish${rest === 1 ? "" : "es"}.` : ".");
      }
      // newest price row for this ingredient
      const prices = await ctx.db
        .query("ingredientPrices")
        .withIndex("by_ingredient_and_reportDate", (q) => q.eq("ingredientId", b.ingredientId))
        .order("desc")
        .take(1);
      const p = prices[0];

      if (!p) {
        rows.push({
          id: b.ingredientId,
          name: ing.canonicalName,
          category: ing.category,
          qty: b.qty,
          unit: b.unit,
          price: null,
          trend: null,
          provenance: "no_data",
          sourceLabel: "No public series",
          qtyDerivation,
        });
        continue;
      }

      if (p.reportDate > latestReportDate) latestReportDate = p.reportDate;

      rows.push({
        id: b.ingredientId,
        name: ing.canonicalName,
        category: ing.category,
        qty: b.qty,
        unit: b.unit,
        price: p.price ?? null,
        trend: p.trend ?? null,
        trendPriorDate: p.trendPriorDate,
        provenance: provenanceFromSource(p.source),
        sourceLabel: sourceLabel(p),
        estimationDetail: p.estimationDetail,
        flag: p.unmatched ? "weak match" : undefined,
        qtyDerivation,
        priceRangeLow: p.priceRangeLow,
        priceRangeHigh: p.priceRangeHigh,
        matchConfidence: p.matchConfidence,
        usdaUnit: p.usdaUnit,
        reportSlug: p.reportSlug,
        priceUnitIncomparable: p.priceUnitIncomparable,
      });
    }

    const priced = rows.filter((r) => r.provenance === "usda" && r.price != null).length;
    const estimated = rows.filter((r) => r.provenance === "estimated" || r.provenance === "mock").length;
    const noData = rows.filter((r) => r.provenance === "no_data").length;
    // Skip rows whose pack unit couldn't be normalized to per-base-unit;
    // multiplying basket lb by $X/carton would produce a misleading total.
    // These rows are surfaced separately as "pending distributor quote".
    const incomparable = rows.filter((r) => r.priceUnitIncomparable === true).length;
    const weeklyTotal = rows.reduce(
      (a, r) => (r.price != null && !r.priceUnitIncomparable ? a + r.price * r.qty : a),
      0,
    );

    return {
      asOf: latestReportDate || new Date().toISOString().slice(0, 10),
      rows,
      summary: {
        priced,
        estimated,
        noData,
        incomparable,
        weeklyTotal: Math.round(weeklyTotal),
      },
    };
  },
});
