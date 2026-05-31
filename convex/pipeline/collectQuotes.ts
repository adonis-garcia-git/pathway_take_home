// collect_quotes stage entrypoint.
//
// Marks the step running, then schedules a single deadline-driven completion
// check. The webhook (convex/http.ts → recordInboundQuote) ALSO schedules
// `checkCollectQuotesDone` after every reply, which fast-paths the close
// when all replies arrive before the deadline. Both call paths share the
// same idempotent handler in convex/email.ts.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

export const runCollectQuotes = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const step = "collect_quotes" as const;
    try {
      await ctx.runMutation(internal.pipelineRuns.markStepRunning, { runId, step });

      const run: Doc<"pipelineRuns"> | null = await ctx.runQuery(
        internal.email.getRunForSend,
        { runId },
      );
      if (!run) return;

      // Find the rfp for this run and read its deadline.
      const rfp: Doc<"rfps"> | null = run.rfpId
        ? await ctx.runQuery(internal.email.getRfp, { rfpId: run.rfpId })
        : null;

      if (!rfp) {
        // No RFP was created (e.g. no ingredients). Close out immediately.
        await ctx.runMutation(internal.pipelineRuns.markStepDone, {
          runId,
          step,
          summary: "no rfp",
        });
        return;
      }

      const delay = Math.max(0, rfp.deadline - Date.now());
      await ctx.scheduler.runAfter(delay, internal.email.checkCollectQuotesDone, {
        runId,
        reason: "deadline",
      });

      // Demo-mode auto-completion: as soon as Stage 5 opens, schedule the
      // fast templated simulator. It writes inbound quotes via the same
      // recordInboundQuote path the real webhook uses, idempotently. The
      // action is a no-op when DISABLE_DEMO_CONTROLS=1 (production safety).
      await ctx.scheduler.runAfter(0, internal.email.autoSimulateReplies, { runId });

      // Also run an immediate reply-mode check in case every recipient is
      // already terminal (mock send + simulator workflow can finish before
      // we ever schedule the deadline).
      await ctx.scheduler.runAfter(0, internal.email.checkCollectQuotesDone, {
        runId,
        reason: "reply",
      });
    } catch (e) {
      await ctx.runMutation(internal.pipelineRuns.markStepError, {
        runId,
        step,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});
