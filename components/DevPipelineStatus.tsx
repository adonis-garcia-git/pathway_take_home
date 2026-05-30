"use client";
// TODO(phase 7): remove. Temporary live-status panel for verifying the Phase 1
// orchestration skeleton end-to-end. The real UI is the LivePipeline component;
// in Phase 7 we replace its internal clock with the same useQuery subscription.
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_TONE: Record<string, string> = {
  pending: "text-st-pending bg-st-pending-bg border-transparent",
  running: "text-st-running bg-st-running-bg border-transparent",
  done: "text-st-done bg-st-done-bg border-transparent",
  error: "text-st-error bg-st-error-bg border-transparent",
};

export function DevPipelineStatus({ runId }: { runId: Id<"pipelineRuns"> }) {
  const run = useQuery(api.pipelineRuns.getPipelineRun, { runId });

  if (run === undefined) return <p className="text-[13px] text-muted">Loading run…</p>;
  if (run === null) return <p className="text-[13px] text-st-error">Run not found.</p>;

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sh1 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted">
            Skeleton pipeline · dev
          </div>
          <div className="font-mono text-[12px] text-muted mt-1">runId: {runId}</div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full border ${
            STATUS_TONE[run.currentStep] ?? "text-muted bg-surface-3 border-border"
          }`}
        >
          {run.currentStep}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {run.steps.map((s, i) => (
          <li
            key={s.step}
            className="flex items-center gap-3 text-[14px]"
          >
            <span className="font-mono text-[11.5px] text-faint w-[18px]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 font-medium text-ink">{s.step}</span>
            <span
              className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-full border ${
                STATUS_TONE[s.status] ?? ""
              }`}
            >
              {s.status}
            </span>
            <span className="text-[12px] text-muted w-[180px] text-right truncate">
              {s.error ?? s.summary ?? ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
