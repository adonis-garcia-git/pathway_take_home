"use client";
// app/page.tsx — App Router page. State machine: start → pipeline.
// runId is carried in component state; LivePipeline subscribes to Convex
// reactively from there.
import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PathwayLogo, Patty, BadgeStyleProvider } from "@/components/ui";
import { StartScreen } from "@/components/screens/StartScreen";
import { LivePipeline } from "@/components/screens/LivePipeline";

export default function Page() {
  const [runId, setRunId] = useState<Id<"pipelineRuns"> | null>(null);
  const screen: "start" | "pipeline" = runId ? "pipeline" : "start";

  const newRun = () => setRunId(null);

  return (
    <BadgeStyleProvider value="filled">
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-5 px-7 h-[60px] bg-background/85 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-3.5">
            <PathwayLogo height={20} />
            {screen === "pipeline" && runId && <TopbarRunChip runId={runId} />}
          </div>
          <div className="flex items-center gap-2.5">
            {screen === "pipeline" && (
              <button
                onClick={newRun}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2 bg-transparent border border-border rounded-sm px-[11px] py-[7px] hover:bg-surface-3 transition"
              >
                <RefreshCw size={14} /> New run
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted bg-surface-3 border border-border rounded-full px-2.5 py-1 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-patty" /> Live · Convex reactive
            </span>
          </div>
        </header>

        <main className="flex-1">
          {screen === "start" ? (
            <StartScreen onRun={(id) => setRunId(id)} />
          ) : (
            <LivePipeline runId={runId!} />
          )}
        </main>
      </div>
    </BadgeStyleProvider>
  );
}

function TopbarRunChip({ runId }: { runId: Id<"pipelineRuns"> }) {
  const header = useQuery(api.pipelineRuns.getPipelineRunHeader, { runId });
  if (!header) return null;
  const cityState = header.address.split(",")[1]?.trim() ?? "";
  return (
    <>
      <span className="w-px h-6 bg-border-strong" />
      <span className="inline-flex items-center gap-3 text-[13px] text-ink-2 bg-surface border border-border rounded-full pl-3.5 pr-3.5 py-1.5">
        <Patty size={16} />
        <span className="flex flex-col gap-px leading-tight">
          <span className="font-medium">{header.restaurantName}</span>
          <span className="font-mono text-[11.5px] text-muted">
            {header.rfpShortCode ?? "RFP pending"} · {cityState}
          </span>
        </span>
      </span>
    </>
  );
}
