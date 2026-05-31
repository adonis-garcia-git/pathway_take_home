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

      // Discover from Google Places, biased to the restaurant's location.
      // No mock seeding: Places is the sole discovery source. Each
      // candidate's website is scraped for a mailto email so Stage 4 has
      // a real `to:` address to send to (or to redirect to a demo inbox).
      const where = await ctx.runQuery(internal.pipeline.findDistributors.getRunRestaurant, {
        runId,
      });

      let placesResult: {
        distinctPlaces: number;
        newDistributors: number;
        existingDistributors: number;
        widenedCategories?: number;
        emailsScraped?: number;
      } = {
        distinctPlaces: 0,
        newDistributors: 0,
        existingDistributors: 0,
      };
      if (where) {
        placesResult = await ctx.runAction(internal.distributors.discoverFromPlaces, {
          address: where.address,
          lat: where.lat,
          lng: where.lng,
        });
      }

      const newThisRun = placesResult.newDistributors;
      const existingFromPrior = placesResult.existingDistributors;
      const totalForRun = newThisRun + existingFromPrior;
      const emailsScraped = placesResult.emailsScraped ?? 0;
      const parts = [
        `${totalForRun} distributors discovered`,
        `${newThisRun} new this run, ${existingFromPrior} from prior discovery`,
      ];
      if (emailsScraped > 0) {
        parts.push(`${emailsScraped} email${emailsScraped === 1 ? "" : "s"} scraped`);
      }
      const summary = parts.join(" · ");

      await ctx.runMutation(internal.pipelineRuns.markStepDone, { runId, step, summary });
      await ctx.runMutation(internal.pipeline.index.scheduleNext, { runId, justFinished: step });
    } catch (e) {
      await ctx.runMutation(internal.pipelineRuns.markStepError, {
        runId,
        step,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
