import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

// Stage entrypoint: delegates the real work to `internal.menus.runParseMenuAction`.
// We keep the orchestration wrapper (markRunning → work → markDone → scheduleNext,
// or markError on throw) consistent with every other stage.
export const runParseMenu = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "parse_menu" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });
      const summary = await ctx.runAction(internal.menus.runParseMenuAction, { runId });
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
