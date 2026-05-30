// Idempotent seed for the headless demo run.
//
// Keyed by `restaurants.externalId` so re-running this mutation does NOT
// duplicate rows. The seed creates the restaurant + an unparsed menu + a
// fresh pipelineRun (or returns the most recent non-terminal one).
//
// The menu is fed through the real parse_menu stage (no `parsedAt` preset)
// so the demo exercises the live Anthropic path.

import { mutation } from "./_generated/server";
import { STEPS } from "./lib/stepKeys";
import { FRANKIES_457 } from "./lib/seedData";
import type { Id } from "./_generated/dataModel";

export const seedFrankies457 = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    restaurantId: Id<"restaurants">;
    menuId: Id<"menus">;
    runId: Id<"pipelineRuns">;
    wasResumed: boolean;
  }> => {
    // 1. Restaurant — idempotent on externalId.
    const existingRestaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_externalId", (q) => q.eq("externalId", FRANKIES_457.externalId))
      .unique();

    let restaurantId: Id<"restaurants">;
    if (existingRestaurant) {
      restaurantId = existingRestaurant._id;
    } else {
      restaurantId = await ctx.db.insert("restaurants", {
        externalId: FRANKIES_457.externalId,
        name: FRANKIES_457.name,
        address: FRANKIES_457.address,
        lat: FRANKIES_457.lat,
        lng: FRANKIES_457.lng,
        sourceUrl: FRANKIES_457.sourceUrl,
      });
    }

    // 2. Menu — idempotent on (restaurantId, sourceUrl).
    const existingMenus = await ctx.db
      .query("menus")
      .withIndex("by_restaurantId", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    const existingMenu = existingMenus.find(
      (m) => m.sourceType === FRANKIES_457.sourceType && m.rawSource === FRANKIES_457.rawSource,
    );
    const menuId: Id<"menus"> =
      existingMenu?._id ??
      (await ctx.db.insert("menus", {
        restaurantId,
        sourceType: FRANKIES_457.sourceType,
        rawSource: FRANKIES_457.rawSource,
      }));

    // 3. PipelineRun — reuse the most recent non-terminal run for this
    //    restaurant if one exists; otherwise create a fresh one.
    const runs = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_restaurantId", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    const inFlight = runs
      .filter((r) => r.currentStep !== "done" && r.currentStep !== "error")
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (inFlight) {
      return { restaurantId, menuId, runId: inFlight._id, wasResumed: true };
    }

    const runId: Id<"pipelineRuns"> = await ctx.db.insert("pipelineRuns", {
      restaurantId,
      menuId,
      currentStep: "parse_menu",
      steps: STEPS.map((step) => ({ step, status: "pending" as const })),
      createdAt: Date.now(),
    });

    return { restaurantId, menuId, runId, wasResumed: false };
  },
});

// Backward-compatible alias for any external caller that still references the
// old name. Marked deprecated.
/** @deprecated Use seedFrankies457. */
export const seedTrattoriaLucia = seedFrankies457;
