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
  weakMatches,
  type Category,
  type ReportSlug,
} from "./lib/fuzzy";

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

// ── Concurrency helper ──────────────────────────────────────────────────────

/** Run tasks with bounded concurrency. Tiny, no deps. */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

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
    // "mock mode" is an intentional system state, not a per-ingredient failure
    // to match. "estimated" means we matched too weakly to trust the number.
    unmatched: source === "estimated",
    trend: undefined,
    estimationDetail:
      source === "estimated"
        ? { method: "category", category }
        : undefined,
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
  return {
    source: "estimated",
    price: Math.round(med * 100) / 100,
    unit: anchorUnit || ingredient.defaultUnit,
    reportDate: dates[0],
    matchConfidence: top[0].confidence,
    unmatched: true,
    trend: undefined,
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

/**
 * Compute % change of `weightedAvg` between the latest and the prior report
 * date for the same commodity name. Returns null when not computable.
 */
function computeTrend(
  rowsByDateDesc: Map<string, NormalizedRow[]>,
  commodity: string,
): number | null {
  const dates = [...rowsByDateDesc.keys()];
  if (dates.length < 2) return null;
  const [latest, prior] = dates;
  const latestRow = rowsByDateDesc.get(latest)?.find((r) => r.commodity === commodity);
  const priorRow = rowsByDateDesc.get(prior)?.find((r) => r.commodity === commodity);
  const a = latestRow?.weightedAvg;
  const b = priorRow?.weightedAvg;
  if (a == null || b == null || b === 0) return null;
  return Math.round(((a - b) / b) * 10000) / 100; // signed %, 2dp
}

/** Try to price one ingredient against a fetched report. Returns null if no usable match. */
function tryMatchReport(
  ingredient: Doc<"ingredients">,
  rows: NormalizedRow[],
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

  const trend = computeTrend(byDate, candidate.commodity);
  const price =
    candidate.weightedAvg ??
    (candidate.priceRangeLow != null && candidate.priceRangeHigh != null
      ? (candidate.priceRangeLow + candidate.priceRangeHigh) / 2
      : undefined);

  return {
    source: "usda_mars",
    price: price ?? undefined,
    unit: candidate.unit || ingredient.defaultUnit,
    reportDate: dates[0],
    weightedAvg: candidate.weightedAvg ?? undefined,
    priceRangeLow: candidate.priceRangeLow ?? undefined,
    priceRangeHigh: candidate.priceRangeHigh ?? undefined,
    region: candidate.region,
    matchConfidence: confidence,
    unmatched: false,
    trend: trend ?? undefined,
    rawUsdaPayload: candidate.raw,
  };
}

async function priceOneIngredient(
  client: UsdaMarsClient,
  ingredient: Doc<"ingredients">,
  reportCache: Map<ReportSlug, NormalizedRow[]>,
): Promise<PricedResult> {
  const category = ingredient.category as Category;
  const primary = PRIMARY_REPORT_BY_CATEGORY[category];
  const secondary = SECONDARY_REPORT_BY_CATEGORY[category];

  const getReport = async (slug: ReportSlug): Promise<NormalizedRow[]> => {
    const cached = reportCache.get(slug);
    if (cached) return cached;
    try {
      const rows = await client.fetchReport(slug, 2);
      reportCache.set(slug, rows);
      return rows;
    } catch {
      reportCache.set(slug, []);
      return [];
    }
  };

  const primaryRows = await getReport(primary);
  const primaryHit = tryMatchReport(ingredient, primaryRows);
  if (primaryHit) return primaryHit;

  let secondaryRows: NormalizedRow[] = [];
  if (secondary) {
    secondaryRows = await getReport(secondary);
    const secondaryHit = tryMatchReport(ingredient, secondaryRows);
    if (secondaryHit) return secondaryHit;
  }

  // No clean match on either report. Before defaulting to a static category
  // average, look for a cluster of weak USDA matches and take their median.
  // Try the primary report first (richer for the category), then secondary.
  const neighborHit =
    tryNeighborMedian(ingredient, primaryRows) ??
    tryNeighborMedian(ingredient, secondaryRows);
  if (neighborHit) return neighborHit;

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
  return categoryFallback(ingredient, "estimated", weakConfidence);
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
          unmatched: false, // intentional mock; not a match failure
          trend: undefined,
        });
      }
      return {
        summary: `${ingredients.length} priced (mock mode) · 0 no public data · ${ingredients.length} ingredients`,
      };
    }

    const client = new UsdaMarsClient(apiKey);
    const reportCache = new Map<ReportSlug, NormalizedRow[]>();

    // Warm the commodities list once (cached on the client).
    try {
      await client.listCommodities();
    } catch {
      // Non-fatal: report endpoints still work without the catalog.
    }

    let priced = 0;
    let noData = 0;

    await runWithConcurrency(ingredients, 4, async (ing: Doc<"ingredients">) => {
      const result = await priceOneIngredient(client, ing, reportCache);
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
  if (row.source === "usda_mars") return `USDA MARS · ${row.region ?? "national"}`;
  if (row.source === "usda_nass") return `USDA NASS · ${row.region ?? "national"}`;
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
      provenance: Provenance;
      sourceLabel: string;
      estimationDetail?: Doc<"ingredientPrices">["estimationDetail"];
      flag?: string;
    };

    let latestReportDate = "";
    const rows: Row[] = [];
    for (const b of basket) {
      const ing = await ctx.db.get(b.ingredientId);
      if (!ing) continue;
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
        provenance: provenanceFromSource(p.source),
        sourceLabel: sourceLabel(p),
        estimationDetail: p.estimationDetail,
        flag: p.unmatched ? "weak match" : undefined,
      });
    }

    const priced = rows.filter((r) => r.provenance === "usda" && r.price != null).length;
    const estimated = rows.filter((r) => r.provenance === "estimated" || r.provenance === "mock").length;
    const noData = rows.filter((r) => r.provenance === "no_data").length;
    const weeklyTotal = rows.reduce((a, r) => (r.price ? a + r.price * r.qty : a), 0);

    return {
      asOf: latestReportDate || new Date().toISOString().slice(0, 10),
      rows,
      summary: { priced, estimated, noData, weeklyTotal: Math.round(weeklyTotal) },
    };
  },
});
