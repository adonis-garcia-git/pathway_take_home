import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

// Lookup helper: fetch the restaurant attached to a pipelineRun. Lives here
// (not in pipelineRuns.ts) because that file is in the protected set and this
// query is specific to the distributor discovery stage's needs.
export const getRunRestaurant = internalQuery({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const restaurant = await ctx.db.get(run.restaurantId);
    if (!restaurant) return null;
    return {
      address: restaurant.address,
      lat: restaurant.lat,
      lng: restaurant.lng,
    };
  },
});

export const runFindDistributors = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "find_distributors" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });

      // 1. Always seed mocks first so the demo has a baseline distributor pool
      //    even when GOOGLE_PLACES_API_KEY is unset. seedDistributors is
      //    idempotent (keyed on `externalId = "mock:<slug>"`).
      const seedResult = await ctx.runMutation(internal.distributors.seedDistributors, {});

      // 2. Discover from Google Places, biased to the restaurant's location.
      //    discoverFromPlaces is a no-op (returns zeros) if the API key is
      //    missing — we still complete the stage successfully.
      const where = await ctx.runQuery(internal.pipeline.findDistributors.getRunRestaurant, {
        runId,
      });

      let placesResult = { distinctPlaces: 0, newDistributors: 0, existingDistributors: 0 };
      if (where) {
        placesResult = await ctx.runAction(internal.distributors.discoverFromPlaces, {
          address: where.address,
          lat: where.lat,
          lng: where.lng,
        });
      }

      const placesCount = placesResult.newDistributors + placesResult.existingDistributors;
      const totalCatalog = seedResult.mocksInCatalog + placesResult.newDistributors;
      const summary = `${totalCatalog} distributors · ${placesCount} from Places, ${seedResult.mocksInCatalog} mock`;

      await ctx.runMutation(internal.pipelineRuns.markStepDone, { runId, step, summary });
      await ctx.runAction(internal.pipeline.index.scheduleNext, { runId, justFinished: step });
    } catch (e) {
      await ctx.runMutation(internal.pipelineRuns.markStepError, {
        runId,
        step,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
