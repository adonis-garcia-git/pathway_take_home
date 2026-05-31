// send_rfps stage entrypoint. Thin wrapper — the actual orchestration
// (basket aggregation, recipient creation, Maileroo HTTP) lives in
// convex/email.ts so it can be unit-tested in isolation.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const runSendRfps = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "send_rfps" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });
      const result: { summary: string } = await ctx.runAction(internal.email.runSendRfps, {
        runId,
      });
      await ctx.runMutation(internal.pipelineRuns.markStepDone, {
        runId,
        step,
        summary: result.summary,
      });
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
