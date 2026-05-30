import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

// Stage wrapper: keeps the orchestration shape (running → done → scheduleNext,
// with try/catch → error). All real work lives in `pricing.fetchAllPricesAction`.
export const runFetchPricing = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "fetch_pricing" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });
      const { summary } = await ctx.runAction(internal.pricing.fetchAllPricesAction, {});
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
