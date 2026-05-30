import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const runParseMenu = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "parse_menu" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });
      // Phase 2 will do external IO here (Anthropic menu parse → dishes + ingredients).
      await ctx.runMutation(internal.pipelineRuns.markStepDone, {
        runId,
        step,
        summary: "stub: 0 dishes",
      });
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
