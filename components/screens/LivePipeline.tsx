"use client";
// components/screens/LivePipeline.tsx — timeline engine + 3 layouts (horizontal / vertical / orbital)
import React, { useEffect, useRef, useState } from "react";
import { Sprout, Tag, MapPin, Send, Award, Check, Clock, Play, Pause, RotateCcw, RefreshCw, type LucideIcon } from "lucide-react";
import { cn, StatusBadge, Patty, PattyAvatar } from "@/components/ui";
import { STAGES, PIPELINE_TOTAL, type StageStatus } from "@/lib/data";
import { RecipesPanel, PricingPanel, DistributorsPanel, RfpPanel, QuotesPanel } from "@/components/screens/stages";

export type Layout = "horizontal" | "vertical" | "orbital";
const STAGE_ICONS: LucideIcon[] = [Sprout, Tag, MapPin, Send, Award];
const PANELS = [RecipesPanel, PricingPanel, DistributorsPanel, RfpPanel, QuotesPanel];
const phaseOf = (s: typeof STAGES[number], clock: number): StageStatus => (clock >= s.end ? "done" : clock >= s.start ? "running" : "pending");
const fmtT = (s: number) => s.toFixed(1) + "s";

/* ── timeline engine ── */
function useClock(speed: number) {
  const KEY = "rfp.clock.v1";
  const [clock, setClock] = useState(() => (typeof localStorage === "undefined" ? 0 : Math.min(parseFloat(localStorage.getItem(KEY) || "0") || 0, PIPELINE_TOTAL)));
  const [playing, setPlaying] = useState(() => clock < PIPELINE_TOTAL);
  const raf = useRef<number | undefined>(undefined); const last = useRef(0);
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000; last.current = now;
      setClock((c) => { const n = c + dt * speed; if (n >= PIPELINE_TOTAL) { setPlaying(false); return PIPELINE_TOTAL; } return n; });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed]);
  useEffect(() => { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, String(clock)); }, [clock]);
  return {
    clock, playing,
    play: () => { if (clock >= PIPELINE_TOTAL) setClock(0); setPlaying(true); },
    pause: () => setPlaying(false),
    replay: () => { setClock(0); setPlaying(true); },
    scrub: (v: number) => { setPlaying(false); setClock(v); },
  };
}

function pattyLine(clock: number): { live: boolean; text: React.ReactNode } {
  const running = STAGES.find((s) => phaseOf(s, clock) === "running");
  if (clock <= 0.001) return { live: false, text: "Ready to run." };
  if (clock >= PIPELINE_TOTAL) return { live: false, text: <><b className="text-ink font-medium">Done.</b> I recommend awarding the core basket to Lombardi — 2 specialty lines need your call.</> };
  if (!running) return { live: true, text: "Working…" };
  const map: Record<string, React.ReactNode> = {
    parse_menu: <>Reading the menu — I found <b className="text-ink font-medium">6 dishes</b> and I’m breaking them into ingredients.</>,
    fetch_pricing: <>Pricing the basket against <b className="text-ink font-medium">USDA</b> data. Two items have no public series — I’ll have distributors quote those.</>,
    find_distributors: <>Searching suppliers near <b className="text-ink font-medium">Carroll Gardens</b> and matching them by category.</>,
    send_rfps: <>Emailing <b className="text-ink font-medium">4 distributors</b> for quotes. One mailbox bounced — trying their phone.</>,
    collect_quotes: <>Comparing replies and working out the best <b className="text-ink font-medium">award</b>.</>,
  };
  return { live: true, text: map[running.key] };
}

/* ── stage node (shared) ── */
function StageNode({ i, phase, active, onClick, layout }: { i: number; phase: StageStatus; active: boolean; onClick: () => void; layout: "h" | "v" }) {
  const s = STAGES[i]; const Ic = STAGE_ICONS[i];
  const chip = phase === "pending" ? "bg-st-pending-bg text-st-pending" : phase === "running" ? "bg-st-running-bg text-st-running" : "bg-st-done-bg text-st-done";
  return (
    <button disabled={phase === "pending"} onClick={onClick}
      className={cn("flex items-start gap-3 text-left bg-surface border rounded-md p-[13px_14px] transition", layout === "h" ? "flex-1 min-w-0 flex-col gap-[9px]" : "w-full",
        phase === "pending" ? "opacity-55 bg-surface-2 cursor-default" : "cursor-pointer hover:-translate-y-px",
        phase === "running" ? "border-st-running/50 shadow-[0_0_0_3px_var(--color-st-running-bg)]" : "border-border",
        active && "!border-forest shadow-[0_0_0_2px_color-mix(in_oklch,var(--color-forest)_22%,transparent)]")}>
      <span className={cn("relative w-8 h-8 rounded-sm shrink-0 inline-flex items-center justify-center", chip)}>
        {phase === "done" ? <Check size={16} strokeWidth={2.4} /> : <Ic size={16} />}
        {phase === "running" && <span className="absolute inset-0 rounded-sm border-2 border-st-running [animation:pulse-ring_1.6s_ease-out_infinite]" />}
      </span>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="font-mono text-[10.5px] text-faint">Stage {s.n}</span>
        <span className="text-[14px] font-medium text-ink">{s.title}</span>
        <span className="text-[12px] text-muted leading-snug">{phase === "done" ? s.done : phase === "running" ? s.run : "Waiting"}</span>
      </span>
    </button>
  );
}

/* ── controls ── */
function Controls({ engine, speed, setSpeed }: { engine: ReturnType<typeof useClock>; speed: number; setSpeed: (s: number) => void }) {
  const { clock, playing, play, pause, replay, scrub } = engine;
  const done = clock >= PIPELINE_TOTAL;
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-md shadow-sh1 my-[18px]">
      <button onClick={done ? replay : playing ? pause : play} className="w-[38px] h-[38px] rounded-sm bg-forest text-white inline-flex items-center justify-center hover:bg-forest-hi active:scale-95 transition shrink-0">{done ? <RotateCcw size={16} /> : playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={replay} title="Restart" className="w-[38px] h-[38px] rounded-sm bg-surface-3 text-ink-2 border border-border inline-flex items-center justify-center hover:bg-mint hover:text-forest transition shrink-0"><RefreshCw size={15} /></button>
      <input type="range" min={0} max={PIPELINE_TOTAL} step={0.05} value={clock} onChange={(e) => scrub(parseFloat(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-forest [&::-webkit-slider-thumb]:shadow-sh1"
        style={{ background: `linear-gradient(90deg, var(--color-forest) ${(clock / PIPELINE_TOTAL) * 100}%, var(--color-surface-3) ${(clock / PIPELINE_TOTAL) * 100}%)` }} />
      <span className="font-mono text-[13px] text-ink min-w-[76px] text-right">{clock.toFixed(1)}<span className="text-faint"> / {PIPELINE_TOTAL.toFixed(0)}s</span></span>
      <div className="inline-flex gap-0.5 bg-surface-3 border border-border rounded-sm p-0.5">
        {[0.5, 1, 2].map((s) => <button key={s} onClick={() => setSpeed(s)} className={cn("font-mono text-[12px] font-medium rounded-[6px] px-2.5 py-[5px] transition", speed === s ? "bg-surface text-forest shadow-sh1" : "text-muted")}>{s}×</button>)}
      </div>
    </div>
  );
}

/* ── stage detail ── */
function StageDetail({ i, phase, clock }: { i: number; phase: StageStatus; clock: number }) {
  const s = STAGES[i]; const Ic = STAGE_ICONS[i]; const Panel = PANELS[i];
  const elapsed = phase === "done" ? s.end - s.start : phase === "running" ? Math.max(0, clock - s.start) : 0;
  const chip = phase === "running" ? "bg-st-running-bg text-st-running border-st-running/25" : phase === "done" ? "bg-st-done-bg text-st-done border-st-done/25" : "bg-mint text-forest border-forest/10";
  return (
    <div className="bg-surface border border-border rounded-lg shadow-sh1 p-[22px]">
      <div className="flex items-start justify-between gap-4 pb-[18px] mb-5 border-b border-border">
        <div className="flex items-center gap-3"><span className={cn("w-[38px] h-[38px] rounded-md shrink-0 inline-flex items-center justify-center border", chip)}><Ic size={18} /></span><div><div className="font-mono text-[11px] text-muted">Stage {s.n} of 5</div><h3 className="font-serif text-[21px] font-medium tracking-[-0.01em] text-ink mt-0.5">{s.title}</h3></div></div>
        <div className="flex items-center gap-2.5">
          {phase !== "pending" && <span className={cn("inline-flex items-center gap-1.5 font-mono text-[12px] rounded-full px-2.5 py-1 border", phase === "running" ? "text-st-running bg-st-running-bg border-transparent" : "text-muted bg-surface-3 border-border")}><Clock size={12} /> {fmtT(elapsed)}</span>}
          <StatusBadge status={phase} />
        </div>
      </div>
      <div key={s.key + phase} className="min-h-[120px]"><Panel phase={phase} run={phase === "done"} /></div>
    </div>
  );
}

/* ── LIVE PIPELINE ── */
export function LivePipeline({ layout, speed, setSpeed }: { layout: Layout; speed: number; setSpeed: (s: number) => void }) {
  const engine = useClock(speed);
  const { clock } = engine;
  const [userSel, setUserSel] = useState<number | null>(null);

  const phases = STAGES.map((s) => phaseOf(s, clock));
  const runningIdx = phases.indexOf("running");
  const lastNonPending = phases.reduce((acc, p, i) => (p !== "pending" ? i : acc), 0);
  const autoIdx = runningIdx >= 0 ? runningIdx : lastNonPending;
  const selIdx = userSel != null ? userSel : autoIdx;
  const completed = phases.filter((p) => p === "done").length;
  const narration = pattyLine(clock);
  const pct = Math.min(100, (clock / PIPELINE_TOTAL) * 100);

  const Header = (
    <div className="flex items-end justify-between gap-6 max-md:flex-col max-md:items-stretch mb-[22px]">
      <div>
        <div className="flex items-baseline gap-3 mb-[9px]"><h2 className="font-serif text-[26px] font-medium tracking-[-0.02em] text-ink m-0">Live pipeline</h2><span className="font-mono text-[12.5px] text-muted bg-surface border border-border rounded-full px-2.5 py-[3px] whitespace-nowrap">{completed}/5 stages</span></div>
        <div className="flex items-center gap-2.5 text-[14px] text-ink-2"><PattyAvatar size={28} live={narration.live} /><span className="text-muted">{narration.text}</span></div>
      </div>
      <div className="w-[220px] max-md:w-full shrink-0"><div className="h-1.5 rounded-full bg-surface-3 border border-border overflow-hidden"><span className="block h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: "linear-gradient(90deg,var(--color-forest),var(--color-patty))" }} /></div></div>
    </div>
  );

  return (
    <div className="max-w-[1280px] mx-auto px-7 pt-[26px] pb-20">
      {Header}
      {layout === "vertical" ? (
        <div className="grid grid-cols-[320px_1fr] max-[960px]:grid-cols-1 gap-[22px] items-start">
          <div className="sticky top-[76px] max-[960px]:static">
            <VerticalRail phases={phases} selIdx={selIdx} pick={setUserSel} clock={clock} />
            <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          </div>
          <StageDetail i={selIdx} phase={phases[selIdx]} clock={clock} />
        </div>
      ) : layout === "orbital" ? (
        <div className="flex flex-col">
          <OrbitalRail phases={phases} selIdx={selIdx} pick={setUserSel} live={narration.live} />
          <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          <StageDetail i={selIdx} phase={phases[selIdx]} clock={clock} />
        </div>
      ) : (
        <div>
          <div className="flex items-stretch max-[960px]:flex-col max-[960px]:gap-2">
            {STAGES.map((s, i) => (
              <React.Fragment key={s.key}>
                <StageNode i={i} phase={phases[i]} active={i === selIdx} onClick={() => phases[i] !== "pending" && setUserSel(i)} layout="h" />
                {i < STAGES.length - 1 && <span className={cn("max-[960px]:hidden flex-[0_0_26px] self-center h-[2px] rounded-full relative overflow-hidden mt-1.5", phases[i] === "running" ? "bg-st-running-bg" : "bg-border-strong")}><span className={cn("absolute inset-0 transition-[width] duration-500", clock >= s.end ? "w-full bg-st-done" : phases[i] === "running" ? "w-3/5 bg-st-running" : "w-0")} /></span>}
              </React.Fragment>
            ))}
          </div>
          <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          <StageDetail i={selIdx} phase={phases[selIdx]} clock={clock} />
        </div>
      )}
    </div>
  );
}

function VerticalRail({ phases, selIdx, pick, clock }: { phases: StageStatus[]; selIdx: number; pick: (i: number) => void; clock: number }) {
  return (
    <div className="flex flex-col">
      {STAGES.map((s, i) => (
        <div key={s.key} className="flex flex-col">
          <StageNode i={i} phase={phases[i]} active={i === selIdx} onClick={() => phases[i] !== "pending" && pick(i)} layout="v" />
          {i < STAGES.length - 1 && <span className="w-[2px] h-[18px] ml-[27px] bg-border-strong relative overflow-hidden rounded-full"><span className={cn("absolute inset-0 transition-[height] duration-500", clock >= s.end ? "h-full bg-st-done" : phases[i] === "running" ? "h-3/5 bg-st-running" : "h-0")} /></span>}
        </div>
      ))}
    </div>
  );
}

function OrbitalRail({ phases, selIdx, pick, live }: { phases: StageStatus[]; selIdx: number; pick: (i: number) => void; live: boolean }) {
  const R = 168, cx = 220, cy = 200;
  const ang = (i: number) => (-90 + i * 72) * (Math.PI / 180);
  return (
    <div className="relative w-[440px] h-[400px] mx-auto mt-1.5 max-[960px]:scale-[0.82] max-[960px]:-my-6">
      <svg viewBox="0 0 440 400" className="absolute inset-0 w-full h-full" aria-hidden>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--color-border-strong)" strokeWidth={1.5} strokeDasharray="3 6" />
        {STAGES.map((_, i) => { const a = ang(i); const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); const p = phases[i];
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} strokeWidth={2} stroke={p === "running" ? "var(--color-st-running)" : p === "done" ? "color-mix(in oklch,var(--color-st-done) 55%,transparent)" : "var(--color-border-strong)"} strokeDasharray={p === "running" ? "4 5" : undefined} />; })}
      </svg>
      <div className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92px] h-[92px] rounded-full bg-surface border border-patty/45 shadow-sh3 flex flex-col items-center justify-center gap-0.5 z-[2]", live && "[animation:pulse-ring_2s_ease-out_infinite]")}><Patty size={34} /><span className="text-[11px] font-semibold text-forest">Patty</span></div>
      {STAGES.map((s, i) => { const a = ang(i); const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); const p = phases[i]; const Ic = STAGE_ICONS[i];
        const chip = p === "pending" ? "text-st-pending" : p === "running" ? "bg-st-running-bg text-st-running border-st-running" : p === "done" ? "bg-st-done-bg text-st-done border-st-done/40" : "";
        return (
          <button key={s.key} disabled={p === "pending"} onClick={() => p !== "pending" && pick(i)} style={{ left: `${(x / 440) * 100}%`, top: `${(y / 400) * 100}%` }}
            className={cn("absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 w-24 z-[3]", p === "pending" ? "opacity-50 cursor-default" : "cursor-pointer")}>
            <span className={cn("relative w-[46px] h-[46px] rounded-full inline-flex items-center justify-center bg-surface border border-border shadow-sh2 transition", chip, i === selIdx && "shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-forest)_25%,transparent)] scale-105")}>
              {p === "done" ? <Check size={15} strokeWidth={2.4} /> : <Ic size={15} />}
              {p === "running" && <span className="absolute inset-0 rounded-full border-2 border-st-running [animation:pulse-ring_1.6s_ease-out_infinite]" />}
            </span>
            <span className={cn("text-[12px] font-medium text-center leading-tight", p === "pending" ? "text-muted" : "text-ink")}>{s.title}</span>
          </button>
        );
      })}
    </div>
  );
}
