import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { nextStep } from "../lib/stepKeys";

const stepKeyValidator = v.union(
  v.literal("parse_menu"),
  v.literal("fetch_pricing"),
  v.literal("find_distributors"),
  v.literal("send_rfps"),
  v.literal("collect_quotes"),
);

// Switchboard: given the step we just finished, schedule the next action.
// Centralized so each stage file doesn't need to know the order.
export const scheduleNext = internalAction({
  args: { runId: v.id("pipelineRuns"), justFinished: stepKeyValidator },
  handler: async (ctx, { runId, justFinished }) => {
    const next = nextStep(justFinished);
    switch (next) {
      case null:
        return;
      case "fetch_pricing":
        await ctx.scheduler.runAfter(0, internal.pipeline.fetchPricing.runFetchPricing, { runId });
        return;
      case "find_distributors":
        await ctx.scheduler.runAfter(0, internal.pipeline.findDistributors.runFindDistributors, {
          runId,
        });
        return;
      case "send_rfps":
        await ctx.scheduler.runAfter(0, internal.pipeline.sendRfps.runSendRfps, { runId });
        return;
      case "collect_quotes":
        await ctx.scheduler.runAfter(0, internal.pipeline.collectQuotes.runCollectQuotes, {
          runId,
        });
        return;
      case "parse_menu":
        // Never reached: parse_menu is the first step.
        await ctx.scheduler.runAfter(0, internal.pipeline.parseMenu.runParseMenu, { runId });
        return;
    }
  },
});
