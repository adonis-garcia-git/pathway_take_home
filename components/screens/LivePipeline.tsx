"use client";
// components/screens/LivePipeline.tsx — vertical pipeline driven by live
// Convex reactivity. Stage phases come from `run.steps[].status`; the panel
// detail is selected from the running step, with user override.
import React, { useState } from "react";
import {
  Sprout, Tag, MapPin, Send, Award, Check, Clock, type LucideIcon,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn, StatusBadge, PattyAvatar, Skeleton } from "@/components/ui";
import { PattySpinner } from "@/components/PattySpinner";
import { STAGE_META, type StageKey, type StageStatus } from "@/lib/data";
import {
  RecipesPanel, PricingPanel, DistributorsPanel, RfpPanel, QuotesPanel,
} from "@/components/screens/stages";

const PATTY_LINES: Record<StageKey, string[]> = {
  parse_menu: [
    "Cracking open the menu.",
    "Counting tomatoes so you don't have to.",
    "Pretending I know what bottarga is.",
    "Decoding the chef's poetry.",
    "Pairing dishes with their secret ingredients.",
  ],
  fetch_pricing: [
    "Stalking USDA market reports.",
    "Haggling with the spreadsheet.",
    "Asking the produce ghost for prices.",
    "Looking up wholesale tomato gossip.",
    "Bargaining with imaginary farmers.",
  ],
  find_distributors: [
    "Sniffing out suppliers near you.",
    "Cold calling the universe.",
    "Checking who delivers before noon.",
    "Finding the cheese person.",
    "Knocking on warehouse doors.",
  ],
  send_rfps: [
    "Penning earnest emails.",
    "Forging my own signature.",
    "Hitting send and crossing fingers.",
    "Distributing the distribution.",
    "Whispering nice things to inboxes.",
  ],
  collect_quotes: [
    "Reading replies like a hawk.",
    "Squinting at prices.",
    "Working out who wins dinner.",
    "Doing arithmetic in clogs.",
    "Picking favorites, fairly.",
  ],
};

const STAGE_ICONS: LucideIcon[] = [Sprout, Tag, MapPin, Send, Award];
const PANELS = [RecipesPanel, PricingPanel, DistributorsPanel, RfpPanel, QuotesPanel];
const STAGE_KEYS: readonly StageKey[] = STAGE_META.map((s) => s.key);

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
};

const STAGE_TITLES: Record<StageKey, string> = {
  parse_menu: "Parse Menu",
  fetch_pricing: "Fetch Pricing",
  find_distributors: "Find Distributors",
  send_rfps: "Send RFPs",
  collect_quotes: "Collect Quotes",
};

function pattyLine(
  runningKey: StageKey | null,
  allDone: boolean,
  phases: StageStatus[],
): {
  live: boolean;
  text: React.ReactNode;
} {
  // Special case: stages 2 and 3 run in parallel. When both are simultaneously
  // running, show a combined line instead of just naming the first one.
  const pricingRunning = phases[1] === "running";
  const distributorsRunning = phases[2] === "running";
  if (pricingRunning && distributorsRunning) {
    return {
      live: true,
      text: (
        <>
          Pricing the basket against <b className="text-ink font-medium">USDA</b> and searching local distributors in parallel.
        </>
      ),
    };
  }
  if (allDone) {
    return {
      live: false,
      text: (
        <>
          <b className="text-ink font-medium">Done.</b> Quote comparison and recommendation are ready below.
        </>
      ),
    };
  }
  if (!runningKey) {
    // No stage is "running" but the pipeline isn't done. Two cases:
    //   (a) Cold start: every stage is pending. Patty is queuing parse_menu.
    //   (b) Handoff: a prior stage finished, next stage is queued but the
    //       runner hasn't picked it up yet. Name the next stage.
    const nextIdx = phases.findIndex((p) => p === "pending");
    if (nextIdx === -1) return { live: true, text: "Picking up where we left off." };
    const nextKey = STAGE_KEYS[nextIdx];
    const allPending = phases.every((p) => p === "pending");
    if (allPending) {
      return {
        live: true,
        text: (
          <>
            Spinning up the pipeline. First stop: <b className="text-ink font-medium">{STAGE_TITLES[nextKey]}</b>.
          </>
        ),
      };
    }
    return {
      live: true,
      text: (
        <>
          Handing off to <b className="text-ink font-medium">{STAGE_TITLES[nextKey]}</b>. Queueing the next pass.
        </>
      ),
    };
  }
  const map: Record<StageKey, React.ReactNode> = {
    parse_menu: <>Reading the menu. Extracting dishes into an ingredient basket.</>,
    fetch_pricing: <>Pricing the basket against <b className="text-ink font-medium">USDA</b> market data.</>,
    find_distributors: <>Searching local distributors and matching by category.</>,
    send_rfps: <>Emailing distributors for quotes.</>,
    collect_quotes: <>Comparing replies and working out the best award.</>,
  };
  return { live: true, text: map[runningKey] };
}

export function LivePipeline({ runId }: { runId: Id<"pipelineRuns"> }) {
  const run = useQuery(api.pipelineRuns.getPipelineRun, { runId });
  const [userSel, setUserSel] = useState<number | null>(null);

  // Build phases[] keyed by STAGE_KEYS, defaulting to "pending" when the run
  // hasn't loaded yet.
  const phases: StageStatus[] = STAGE_KEYS.map((key) => {
    const s = run?.steps.find((x) => x.step === key);
    return (s?.status ?? "pending") as StageStatus;
  });
  const stepErrors: Array<string | undefined> = STAGE_KEYS.map((key) => {
    const s = run?.steps.find((x) => x.step === key);
    return s?.error;
  });
  const stepSummaries: Array<string | undefined> = STAGE_KEYS.map((key) => {
    const s = run?.steps.find((x) => x.step === key);
    return s?.summary;
  });
  const stepStartedAt: Array<number | undefined> = STAGE_KEYS.map((key) => {
    const s = run?.steps.find((x) => x.step === key);
    return s?.startedAt;
  });
  const stepFinishedAt: Array<number | undefined> = STAGE_KEYS.map((key) => {
    const s = run?.steps.find((x) => x.step === key);
    return s?.finishedAt;
  });

  const runningIdx = phases.findIndex((p) => p === "running");
  const errorIdx = phases.findIndex((p) => p === "error");
  const lastNonPending = phases.reduce(
    (acc, p, i) => (p !== "pending" ? i : acc),
    0,
  );
  const autoIdx =
    errorIdx >= 0 ? errorIdx : runningIdx >= 0 ? runningIdx : lastNonPending;
  const selIdx = userSel != null ? userSel : autoIdx;

  const completed = phases.filter((p) => p === "done").length;
  const allDone = completed === STAGE_KEYS.length;
  const runningKey = runningIdx >= 0 ? STAGE_KEYS[runningIdx] : null;

  // When the agent is in stage 5, the topbar ticker surfaces the most recent
  // agentEvents summary so the user sees what Patty just did, not a static line.
  const latestEvents = useQuery(
    api.agent.getRecentEventsForRun,
    runningKey === "collect_quotes" ? { runId, limit: 1 } : "skip",
  );
  const liveEventSummary =
    runningKey === "collect_quotes" && latestEvents && latestEvents.length > 0
      ? latestEvents[0].summary
      : null;
  const narration = liveEventSummary
    ? { live: true, text: liveEventSummary as React.ReactNode }
    : pattyLine(runningKey, allDone, phases);
  const pct = Math.min(
    100,
    ((completed + (runningIdx >= 0 ? 0.5 : 0)) / STAGE_KEYS.length) * 100,
  );

  // Live elapsed: from run.createdAt to max(finishedAt) or now if anything still running.
  const finishedTs = stepFinishedAt.filter((t): t is number => typeof t === "number");
  const anyRunning = phases.includes("running");
  const elapsedMs = run
    ? anyRunning || finishedTs.length === 0
      ? Date.now() - run.createdAt
      : Math.max(...finishedTs) - run.createdAt
    : 0;

  return (
    <div className="max-w-[1280px] mx-auto px-7 pt-[26px] pb-20">
      <div className="flex items-end justify-between gap-6 max-md:flex-col max-md:items-stretch mb-[22px]">
        <div>
          <div className="flex items-baseline gap-3 mb-[9px]">
            <h2 className="font-serif text-[26px] font-medium tracking-[-0.02em] text-ink m-0">
              Live pipeline
            </h2>
            <span className="font-mono text-[12.5px] text-muted bg-surface border border-border rounded-full px-2.5 py-[3px] whitespace-nowrap">
              {completed}/5 stages
            </span>
            {run && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-muted">
                <Clock size={12} /> {fmtElapsed(elapsedMs)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-[14px] text-ink-2">
            <PattyAvatar size={28} live={narration.live} />
            <span className="text-muted">{narration.text}</span>
          </div>
        </div>
        <div className="w-[220px] max-md:w-full shrink-0">
          <div className="h-1.5 rounded-full bg-surface-3 border border-border overflow-hidden">
            <span
              className="block h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg,var(--color-forest),var(--color-patty))",
              }}
            />
          </div>
        </div>
      </div>

      {!run ? (
        <Skeleton w="100%" h={420} />
      ) : (
        <div className="grid grid-cols-[320px_1fr] max-[960px]:grid-cols-1 gap-[22px] items-start">
          <div className="sticky top-[76px] max-[960px]:static">
            <VerticalRail
              phases={phases}
              selIdx={selIdx}
              pick={setUserSel}
              summaries={stepSummaries}
            />
          </div>
          <StageDetail
            i={selIdx}
            phase={phases[selIdx]}
            error={stepErrors[selIdx]}
            summary={stepSummaries[selIdx]}
            startedAt={stepStartedAt[selIdx]}
            finishedAt={stepFinishedAt[selIdx]}
            runId={runId}
          />
        </div>
      )}
    </div>
  );
}

function StageNode({
  i,
  phase,
  active,
  onClick,
  summary,
  isNext,
}: {
  i: number;
  phase: StageStatus;
  active: boolean;
  onClick: () => void;
  summary?: string;
  isNext?: boolean;
}) {
  const meta = STAGE_META[i];
  const Ic = STAGE_ICONS[i];
  const chip =
    phase === "pending"
      ? isNext
        ? "bg-mint text-forest"
        : "bg-st-pending-bg text-st-pending"
      : phase === "running"
        ? "bg-st-running-bg text-st-running"
        : phase === "error"
          ? "bg-st-error-bg text-st-error"
          : "bg-st-done-bg text-st-done";

  const subText =
    phase === "done"
      ? (summary ?? meta.done)
      : phase === "running"
        ? meta.run
        : phase === "error"
          ? "Stage failed"
          : isNext
            ? "Up next, queued"
            : "Waiting";

  return (
    <button
      disabled={phase === "pending"}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 text-left bg-surface border rounded-md p-[13px_14px] transition w-full",
        phase === "pending"
          ? "opacity-55 bg-surface-2 cursor-default"
          : "cursor-pointer hover:-translate-y-px",
        phase === "running"
          ? "border-st-running/50 shadow-[0_0_0_3px_var(--color-st-running-bg)]"
          : phase === "error"
            ? "border-st-error/50 shadow-[0_0_0_3px_var(--color-st-error-bg)]"
            : "border-border",
        active &&
          "!border-forest shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-forest)_22%,transparent)]",
      )}
    >
      <span
        className={cn(
          "relative w-8 h-8 rounded-sm shrink-0 inline-flex items-center justify-center",
          chip,
        )}
      >
        {phase === "done" ? <Check size={16} strokeWidth={2.4} /> : <Ic size={16} />}
        {phase === "running" && (
          <span className="absolute inset-0 rounded-sm border-2 border-st-running [animation:pulse-ring_1.6s_ease-out_infinite]" />
        )}
      </span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="font-mono text-[10.5px] text-faint">Stage {meta.n}</span>
        <span className="text-[14px] font-medium text-ink">{meta.title}</span>
        <span className="text-[12px] text-muted leading-snug line-clamp-2">{subText}</span>
      </span>
    </button>
  );
}

function VerticalRail({
  phases,
  selIdx,
  pick,
  summaries,
}: {
  phases: StageStatus[];
  selIdx: number;
  pick: (i: number) => void;
  summaries: Array<string | undefined>;
}) {
  // The "next" stage is the first pending one when no stage is currently
  // running. Surface it visually so the user sees what's queued instead of
  // a row of indistinguishable "Waiting" rows.
  const anyRunning = phases.some((p) => p === "running");
  const nextIdx = anyRunning ? -1 : phases.findIndex((p) => p === "pending");
  return (
    <div className="flex flex-col">
      {STAGE_META.map((s, i) => (
        <div key={s.key} className="flex flex-col">
          <StageNode
            i={i}
            phase={phases[i]}
            active={i === selIdx}
            onClick={() => phases[i] !== "pending" && pick(i)}
            summary={summaries[i]}
            isNext={i === nextIdx}
          />
          {i < STAGE_META.length - 1 && (
            <span className="w-[2px] h-[18px] ml-[27px] bg-border-strong relative overflow-hidden rounded-full">
              <span
                className={cn(
                  "absolute inset-0 transition-[height] duration-500",
                  phases[i] === "done"
                    ? "h-full bg-st-done"
                    : phases[i] === "running"
                      ? "h-3/5 bg-st-running"
                      : phases[i] === "error"
                        ? "h-full bg-st-error"
                        : "h-0",
                )}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function StageDetail({
  i,
  phase,
  error,
  summary,
  startedAt,
  finishedAt,
  runId,
}: {
  i: number;
  phase: StageStatus;
  error?: string;
  summary?: string;
  startedAt?: number;
  finishedAt?: number;
  runId: Id<"pipelineRuns">;
}) {
  const meta = STAGE_META[i];
  const Ic = STAGE_ICONS[i];
  const Panel = PANELS[i];

  const elapsedMs =
    phase === "done" && startedAt && finishedAt
      ? finishedAt - startedAt
      : phase === "running" && startedAt
        ? Date.now() - startedAt
        : 0;

  const chip =
    phase === "running"
      ? "bg-st-running-bg text-st-running border-st-running/25"
      : phase === "done"
        ? "bg-st-done-bg text-st-done border-st-done/25"
        : phase === "error"
          ? "bg-st-error-bg text-st-error border-st-error/25"
          : "bg-mint text-forest border-forest/10";

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sh1 p-[22px]">
      <div className="flex items-start justify-between gap-4 pb-[18px] mb-5 border-b border-border">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "w-[38px] h-[38px] rounded-md shrink-0 inline-flex items-center justify-center border",
              chip,
            )}
          >
            <Ic size={18} />
          </span>
          <div>
            <div className="font-mono text-[11px] text-muted">Stage {meta.n} of 5</div>
            <h3 className="font-serif text-[21px] font-medium tracking-[-0.01em] text-ink mt-0.5">
              {meta.title}
            </h3>
            {phase === "done" && summary && (
              <div className="font-mono text-[11.5px] text-muted mt-1">{summary}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {phase !== "pending" && elapsedMs > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-mono text-[12px] rounded-full px-2.5 py-1 border",
                phase === "running"
                  ? "text-st-running bg-st-running-bg border-transparent"
                  : "text-muted bg-surface-3 border-border",
              )}
            >
              <Clock size={12} /> {fmtElapsed(elapsedMs)}
            </span>
          )}
          <StatusBadge status={phase} />
        </div>
      </div>
      <div key={meta.key + phase} className="min-h-[120px]">
        {phase === "running" ? (
          <PattySpinner lines={PATTY_LINES[meta.key as StageKey]} />
        ) : (
          <Panel phase={phase} runId={runId} error={error} />
        )}
      </div>
    </div>
  );
}
