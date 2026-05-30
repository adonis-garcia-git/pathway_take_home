"use client";
// app/page.tsx — App Router page. State machine: start → pipeline.
// (In the prototype, layout/speed/badge-style were live "Tweaks". In production
//  treat them as defaults or user settings; vertical layout is the chosen default.)
import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { PathwayLogo, Patty, BadgeStyleProvider, type BadgeStyle } from "@/components/ui";
import { StartScreen } from "@/components/screens/StartScreen";
import { LivePipeline, type Layout } from "@/components/screens/LivePipeline";
import { RESTAURANT } from "@/lib/data";

export default function Page() {
  const [screen, setScreen] = useState<"start" | "pipeline">("start");
  const [layout] = useState<Layout>("vertical");      // default
  const [speed, setSpeed] = useState(1);
  const [badgeStyle] = useState<BadgeStyle>("filled"); // default

  const newRun = () => { if (typeof localStorage !== "undefined") localStorage.setItem("rfp.clock.v1", "0"); setScreen("start"); };

  return (
    <BadgeStyleProvider value={badgeStyle}>
      <div className="min-h-screen flex flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center justify-between gap-5 px-7 h-[60px] bg-background/85 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-3.5">
            <PathwayLogo height={20} />
            {screen === "pipeline" && (
              <>
                <span className="w-px h-6 bg-border-strong" />
                <span className="inline-flex items-center gap-2.5 text-[13px] text-ink-2 bg-surface border border-border rounded-full pl-3 pr-2 py-[5px]">
                  <Patty size={16} />
                  <span className="flex flex-col gap-px leading-tight"><span className="font-medium">{RESTAURANT.name}</span><span className="font-mono text-[11.5px] text-muted">RFP-2418 · {RESTAURANT.address.split(",")[1]?.trim()}</span></span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {screen === "pipeline" && <button onClick={newRun} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2 bg-transparent border border-border rounded-sm px-[11px] py-[7px] hover:bg-surface-3 transition"><RefreshCw size={14} /> New run</button>}
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted bg-surface-3 border border-border rounded-full px-2.5 py-1 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-patty" /> Demo · synthetic data</span>
          </div>
        </header>

        <main className="flex-1">
          {screen === "start"
            ? <StartScreen onRun={() => setScreen("pipeline")} />
            : <LivePipeline layout={layout} speed={speed} setSpeed={setSpeed} />}
        </main>
      </div>
    </BadgeStyleProvider>
  );
}
