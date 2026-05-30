import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { STEPS } from "./lib/stepKeys";
import { aggregateIngredients, type ParsedDish } from "./lib/aggregate";
import { extractMenu, type MenuContent } from "./lib/anthropic";
import { fetchUrlAsText } from "./lib/fetchUrl";
import type { MenuExtraction } from "./lib/schemas";
import { sumOccurrences } from "./lib/units";

// ── public mutations ───────────────────────────────────────────────

/**
 * Returns a signed upload URL for an image or PDF menu. The client POSTs
 * the file to this URL, gets back a storage id, then passes that id as
 * `rawSource` to `createFromMenu` with the matching `sourceType`.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * Create a real (non-seed) pipeline run from user-supplied menu input.
 * Inserts restaurants + menus + pipelineRuns (parse_menu / pending) and
 * returns the runId — caller then invokes `pipelineRuns.startPipeline`.
 *
 * lat/lng default to (0,0). Real geocoding is a follow-up; the distributors
 * stage already falls back to its seeded mock catalog regardless.
 */
export const createFromMenu = mutation({
  args: {
    sourceType: v.union(
      v.literal("url"),
      v.literal("text"),
      v.literal("image"),
      v.literal("pdf"),
    ),
    rawSource: v.string(),
    restaurantName: v.string(),
    address: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const restaurantId: Id<"restaurants"> = await ctx.db.insert("restaurants", {
      name: args.restaurantName,
      address: args.address,
      lat: 0,
      lng: 0,
      sourceUrl: args.sourceUrl,
    });

    const menuId: Id<"menus"> = await ctx.db.insert("menus", {
      restaurantId,
      sourceType: args.sourceType,
      rawSource: args.rawSource,
    });

    const runId: Id<"pipelineRuns"> = await ctx.db.insert("pipelineRuns", {
      restaurantId,
      menuId,
      currentStep: "parse_menu",
      steps: STEPS.map((step) => ({ step, status: "pending" as const })),
      createdAt: Date.now(),
    });

    return { restaurantId, menuId, runId };
  },
});

// ── public: reactive query feeding RecipesPanel ────────────────────

export const getRecipesForRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || !run.menuId) return null;
    const dishes = await ctx.db
      .query("dishes")
      .withIndex("by_menuId", (q) => q.eq("menuId", run.menuId!))
      .collect();
    if (dishes.length === 0) return null;

    type IngredientLine = {
      ingredientId: Id<"ingredients">;
      rawName: string;
      canonicalName: string;
      category: Doc<"ingredients">["category"];
      estimatedQuantity: number;
      unit: string;
      confidence: Doc<"dishIngredients">["confidence"];
      assumptionNote?: string;
    };

    const basketMap = new Map<
      string,
      {
        ingredientId: Id<"ingredients">;
        canonicalName: string;
        category: Doc<"ingredients">["category"];
        rows: { qty: number; unit: string }[];
        confidence: Doc<"dishIngredients">["confidence"];
        flag?: string;
      }
    >();

    const dishesOut = await Promise.all(
      dishes.map(async (dish) => {
        const di = await ctx.db
          .query("dishIngredients")
          .withIndex("by_dishId", (q) => q.eq("dishId", dish._id))
          .collect();
        const ingredients: IngredientLine[] = [];
        for (const row of di) {
          const ing = await ctx.db.get(row.ingredientId);
          if (!ing) continue;
          ingredients.push({
            ingredientId: row.ingredientId,
            rawName: row.rawName,
            canonicalName: ing.canonicalName,
            category: ing.category,
            estimatedQuantity: row.estimatedQuantity,
            unit: row.unit,
            confidence: row.confidence,
            assumptionNote: row.assumptionNote,
          });
          const key = row.ingredientId as unknown as string;
          const prev = basketMap.get(key);
          const lowerConf = (a: typeof row.confidence, b: typeof row.confidence) =>
            (a === "low" || b === "low") ? "low" : a === "medium" || b === "medium" ? "medium" : "high";
          if (prev) {
            prev.rows.push({ qty: row.estimatedQuantity, unit: row.unit });
            prev.confidence = lowerConf(prev.confidence, row.confidence);
            if (!prev.flag && row.assumptionNote) prev.flag = row.assumptionNote;
          } else {
            basketMap.set(key, {
              ingredientId: row.ingredientId,
              canonicalName: ing.canonicalName,
              category: ing.category,
              rows: [{ qty: row.estimatedQuantity, unit: row.unit }],
              confidence: row.confidence,
              flag: row.assumptionNote,
            });
          }
        }
        return { ...dish, ingredients };
      }),
    );

    // Sum each basket entry's per-dish rows in a unit-aware way.
    const basket = [...basketMap.values()].map((b) => {
      const totaled = sumOccurrences(b.rows);
      return {
        ingredientId: b.ingredientId,
        canonicalName: b.canonicalName,
        category: b.category,
        qty: totaled.qty,
        unit: totaled.unit,
        confidence: b.confidence,
        flag: totaled.mixed
          ? (b.flag ? `${b.flag} · mixed units` : "mixed units")
          : b.flag,
      };
    });
    const needReviewCount =
      dishesOut.filter((d) => d.needsReview || d.confidence === "low").length;
    const weeklyVolumeLb = basket.reduce(
      (a, b) => a + (b.unit === "lb" ? b.qty : 0),
      0,
    );

    return {
      dishes: dishesOut,
      basket,
      stats: {
        dishCount: dishesOut.length,
        lineCount: basket.length,
        weeklyVolumeLb: Math.round(weeklyVolumeLb),
        needReviewCount,
      },
    };
  },
});

// ── internal: query the action needs ──────────────────────────────

export const getRunMenu = internalQuery({
  args: { runId: v.id("pipelineRuns") },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ run: Doc<"pipelineRuns">; menu: Doc<"menus"> | null }> => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error(`pipelineRun ${runId} not found`);
    const menu = run.menuId ? await ctx.db.get(run.menuId) : null;
    return { run, menu };
  },
});

// ── internal: writeParseResult (the core of step 1) ───────────────
//
// Idempotency: keyed by (dishes.menuId) — we delete-and-rewrite all dishes
// for this menu, then upsert ingredients by canonicalName and dishIngredients
// keyed by (dishId, ingredientId). The action only calls this once per
// pipeline run; the menu.parsedAt timestamp short-circuits replays upstream.

export const writeParseResult = internalMutation({
  args: {
    menuId: v.id("menus"),
    extraction: v.any(), // MenuExtraction (validated upstream by Zod)
  },
  handler: async (ctx, { menuId, extraction }) => {
    const extr = extraction as MenuExtraction;

    // Insert dishes; remember dishIndex → dishId mapping for the join.
    const dishIdByIndex = new Map<number, Id<"dishes">>();
    for (let i = 0; i < extr.dishes.length; i++) {
      const d = extr.dishes[i];
      const dishId = await ctx.db.insert("dishes", {
        menuId,
        name: d.name,
        description: d.description,
        confidence: d.confidence,
        needsReview: d.needsReview,
      });
      dishIdByIndex.set(i, dishId);
    }

    // Aggregate ingredients across dishes (synonyms + fuzzy + roll-up).
    const parsed: ParsedDish[] = extr.dishes.map((d, idx) => ({ ...d, dishIndex: idx }));
    const aggregated = aggregateIngredients(parsed);

    // Upsert master ingredients keyed by canonicalName + write per-dish rows.
    let ingredientRows = 0;
    let dishIngredientRows = 0;
    for (const agg of aggregated) {
      const existing = await ctx.db
        .query("ingredients")
        .withIndex("by_canonicalName", (q) => q.eq("canonicalName", agg.canonicalName))
        .first();
      let ingredientId: Id<"ingredients">;
      if (existing) {
        ingredientId = existing._id;
      } else {
        ingredientId = await ctx.db.insert("ingredients", {
          canonicalName: agg.canonicalName,
          category: agg.category,
          defaultUnit: agg.defaultUnit,
        });
        ingredientRows++;
      }

      for (const occ of agg.occurrences) {
        const dishId = dishIdByIndex.get(occ.dishIndex);
        if (!dishId) continue;
        await ctx.db.insert("dishIngredients", {
          dishId,
          ingredientId,
          rawName: occ.rawName,
          estimatedQuantity: occ.estimatedQuantity,
          unit: occ.unit,
          confidence: occ.confidence,
          assumptionNote: occ.assumptionNote,
        });
        dishIngredientRows++;
      }
    }

    // Mark the menu parsed (idempotency hook for re-runs).
    await ctx.db.patch(menuId, { parsedAt: Date.now() });

    const needsReviewCount = extr.dishes.filter((d) => d.needsReview).length;
    return {
      dishesWritten: extr.dishes.length,
      ingredientsWritten: ingredientRows,
      dishIngredientsWritten: dishIngredientRows,
      needsReviewCount,
    };
  },
});

// ── internal: action that loads + parses + writes (real parse_menu body) ──

export const runParseMenuAction = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<string> => {
    const { menu } = await ctx.runQuery(internal.menus.getRunMenu, { runId });
    if (!menu) return "no menu attached";
    if (menu.parsedAt) return "already parsed (seed/replay)";

    // Build the content blocks for Claude.
    let content: MenuContent;
    if (menu.sourceType === "text") {
      content = [{ type: "text", text: menu.rawSource }];
    } else if (menu.sourceType === "url") {
      const text = await fetchUrlAsText(menu.rawSource);
      content = [
        {
          type: "text",
          text: `Source URL: ${menu.rawSource}\n\n---\n\n${text}`,
        },
      ];
    } else if (menu.sourceType === "image") {
      const blob = await ctx.storage.get(menu.rawSource);
      if (!blob) throw new Error(`storage blob ${menu.rawSource} not found`);
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
      const media = (blob.type || "image/png") as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "image/gif";
      content = [{ type: "image", source: { type: "base64", media_type: media, data } }];
    } else {
      // pdf
      const blob = await ctx.storage.get(menu.rawSource);
      if (!blob) throw new Error(`storage blob ${menu.rawSource} not found`);
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
      content = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        },
      ];
    }

    const extraction = await extractMenu(content);

    const result = await ctx.runMutation(internal.menus.writeParseResult, {
      menuId: menu._id,
      extraction,
    });

    const reviewSuffix = result.needsReviewCount > 0 ? ` (${result.needsReviewCount} need review)` : "";
    return `${result.dishesWritten} dishes · ${result.ingredientsWritten} ingredients${reviewSuffix}`;
  },
});
