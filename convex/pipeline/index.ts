import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { StepKey } from "../lib/stepKeys";

const stepKeyValidator = v.union(
  v.literal("parse_menu"),
  v.literal("fetch_pricing"),
  v.literal("find_distributors"),
  v.literal("send_rfps"),
  v.literal("collect_quotes"),
);

// Pipeline shape:
//
//   parse_menu
//        |
//        +--> fetch_pricing  ----+
//        |                       |
//        +--> find_distributors -+--> send_rfps --> collect_quotes
//
// fetch_pricing and find_distributors run in PARALLEL because they share no
// dependencies on each other. send_rfps is the join barrier: it only fires
// when BOTH are done. The barrier check lives inline so a single mutation
// handles the entire transition (status updates + scheduling) in one DB
// transaction, eliminating mid-handoff dead-air.

type ScheduledStep =
  | "fetch_pricing"
  | "find_distributors"
  | "send_rfps"
  | "collect_quotes"
  | "parse_menu";

/**
 * Patch a stage to running + startedAt in the run.steps array. Pre-marking
 * means the UI shows the stage as "running" immediately, even though the
 * action runner has a small cold-start delay before it actually executes.
 * The runner's own markStepRunning is now idempotent on startedAt, so the
 * timestamp we set here is preserved as the canonical start.
 */
function startStage(
  run: Doc<"pipelineRuns">,
  step: ScheduledStep,
  now: number,
): Doc<"pipelineRuns">["steps"] {
  return run.steps.map((s) =>
    s.step === step
      ? { ...s, status: "running" as const, startedAt: s.startedAt ?? now }
      : s,
  );
}

export const scheduleNext = internalMutation({
  args: { runId: v.id("pipelineRuns"), justFinished: stepKeyValidator },
  handler: async (ctx, { runId, justFinished }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const now = Date.now();

    // Guard against double-scheduling. Returns true only if `step` is still
    // in "pending" status. The join barrier and demo replays can both
    // legitimately call scheduleNext twice; this prevents a duplicate.
    const stillPending = (step: ScheduledStep): boolean =>
      run.steps.find((s) => s.step === step)?.status === "pending";

    if (justFinished === "parse_menu") {
      // Fan out: pricing and distributor discovery in parallel.
      if (!stillPending("fetch_pricing") && !stillPending("find_distributors")) return;
      let steps = startStage(run, "fetch_pricing", now);
      steps = startStage({ ...run, steps }, "find_distributors", now);
      await ctx.db.patch(runId, { steps, currentStep: "fetch_pricing" });
      await ctx.scheduler.runAfter(0, internal.pipeline.fetchPricing.runFetchPricing, { runId });
      await ctx.scheduler.runAfter(0, internal.pipeline.findDistributors.runFindDistributors, { runId });
      return;
    }

    if (justFinished === "fetch_pricing" || justFinished === "find_distributors") {
      // Join barrier. Both must be done before send_rfps fires.
      const otherKey: StepKey =
        justFinished === "fetch_pricing" ? "find_distributors" : "fetch_pricing";
      const other = run.steps.find((s) => s.step === otherKey);
      if (!other || other.status !== "done") {
        // Sibling still running (or errored). Don't advance.
        return;
      }
      if (!stillPending("send_rfps")) {
        // Race: the sibling's scheduleNext already passed the barrier and
        // scheduled send_rfps. Don't double-schedule.
        return;
      }
      const steps = startStage(run, "send_rfps", now);
      await ctx.db.patch(runId, { steps, currentStep: "send_rfps" });
      await ctx.scheduler.runAfter(0, internal.pipeline.sendRfps.runSendRfps, { runId });
      return;
    }

    if (justFinished === "send_rfps") {
      if (!stillPending("collect_quotes")) return;
      const steps = startStage(run, "collect_quotes", now);
      await ctx.db.patch(runId, { steps, currentStep: "collect_quotes" });
      await ctx.scheduler.runAfter(0, internal.pipeline.collectQuotes.runCollectQuotes, { runId });
      return;
    }

    // collect_quotes: terminal stage. Nothing to schedule.
  },
});
