import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { STEPS, type StepKey } from "./lib/stepKeys";

const stepKeyValidator = v.union(
  v.literal("parse_menu"),
  v.literal("fetch_pricing"),
  v.literal("find_distributors"),
  v.literal("send_rfps"),
  v.literal("collect_quotes"),
);

// ── public ─────────────────────────────────────────────────────────

export const getPipelineRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => ctx.db.get(runId),
});

export const startPipeline = mutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error(`pipelineRun ${runId} not found`);
    if (run.currentStep !== "parse_menu" || run.steps.some((s) => s.status !== "pending")) {
      return { alreadyRunning: true as const };
    }
    await ctx.scheduler.runAfter(0, internal.pipeline.parseMenu.runParseMenu, { runId });
    return { alreadyRunning: false as const };
  },
});

// ── internal: step status transitions ──────────────────────────────

export const markStepRunning = internalMutation({
  args: { runId: v.id("pipelineRuns"), step: stepKeyValidator },
  handler: async (ctx, { runId, step }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const steps = run.steps.map((s) =>
      s.step === step ? { ...s, status: "running" as const, startedAt: Date.now() } : s,
    );
    await ctx.db.patch(runId, { steps, currentStep: step });
  },
});

export const markStepDone = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    step: stepKeyValidator,
    summary: v.optional(v.string()),
  },
  handler: async (ctx, { runId, step, summary }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const steps = run.steps.map((s) =>
      s.step === step ? { ...s, status: "done" as const, finishedAt: Date.now(), summary } : s,
    );
    const last: StepKey = STEPS[STEPS.length - 1];
    const currentStep = step === last ? ("done" as const) : run.currentStep;
    await ctx.db.patch(runId, { steps, currentStep });
  },
});

export const markStepError = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    step: stepKeyValidator,
    error: v.string(),
  },
  handler: async (ctx, { runId, step, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const steps = run.steps.map((s) =>
      s.step === step ? { ...s, status: "error" as const, finishedAt: Date.now(), error } : s,
    );
    await ctx.db.patch(runId, { steps, currentStep: "error" });
  },
});
