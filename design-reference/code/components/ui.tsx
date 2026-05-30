"use client";
// components/ui.tsx — shared primitives for the RFP Pipeline.
// Tailwind + lucide-react. Status/badge color classes are written as LITERAL
// strings (never built dynamically) so Tailwind's JIT keeps them.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check, X, Clock, LoaderCircle, TriangleAlert, Send, RefreshCw, Sparkles, Minus,
  ArrowUp, ArrowDown, Flag, Plus, FlaskConical, ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { EmailStatus, StageStatus, Provenance, Confidence, Category } from "@/lib/data";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ───────────────────────── Brand ───────────────────────── */
export function Patty({ size = 22, className }: { size?: number; className?: string }) {
  // copy patty.svg into /public; or inline the SVG path (fill #57BD86).
  return <img src="/patty.svg" width={size} height={size} alt="" aria-hidden className={cn("block", className)} />;
}
export function PathwayLogo({ height = 20 }: { height?: number }) {
  return <img src="/pathway-logo.png" alt="Pathway" style={{ height }} className="w-auto block" />;
}
export function PattyAvatar({ size = 26, live = false }: { size?: number; live?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full bg-mint border border-patty/40 shrink-0", live && "[animation:pulse-ring_1.8s_ease-out_infinite]")}
      style={{ width: size, height: size }}
    >
      <Patty size={size * 0.62} />
    </span>
  );
}

/* ───────────────────────── Badge family ───────────────────────── */
export type BadgeStyle = "filled" | "outline" | "dots";
const BadgeStyleCtx = createContext<BadgeStyle>("filled");
export const BadgeStyleProvider = BadgeStyleCtx.Provider;
export const useBadgeStyle = () => useContext(BadgeStyleCtx);

type Meta = { label: string; Icon: LucideIcon; fg: string; bg: string; bd: string; dot: string; spin?: boolean };

const PIPELINE: Record<StageStatus, Meta> = {
  pending: { label: "Pending", Icon: Clock, fg: "text-st-pending", bg: "bg-st-pending-bg", bd: "border-st-pending/45", dot: "bg-st-pending" },
  running: { label: "Running", Icon: LoaderCircle, fg: "text-st-running", bg: "bg-st-running-bg", bd: "border-st-running/45", dot: "bg-st-running", spin: true },
  done:    { label: "Done", Icon: Check, fg: "text-st-done", bg: "bg-st-done-bg", bd: "border-st-done/45", dot: "bg-st-done" },
  error:   { label: "Error", Icon: TriangleAlert, fg: "text-st-error", bg: "bg-st-error-bg", bd: "border-st-error/45", dot: "bg-st-error" },
};
const EMAIL: Record<EmailStatus, Meta> = {
  queued:      { label: "Queued", Icon: Clock, fg: "text-st-pending", bg: "bg-st-pending-bg", bd: "border-st-pending/45", dot: "bg-st-pending" },
  sent:        { label: "Sent", Icon: Send, fg: "text-st-running", bg: "bg-st-running-bg", bd: "border-st-running/45", dot: "bg-st-running" },
  replied:     { label: "Replied", Icon: Check, fg: "text-st-done", bg: "bg-st-done-bg", bd: "border-st-done/45", dot: "bg-st-done" },
  followed_up: { label: "Followed up", Icon: RefreshCw, fg: "text-st-warn", bg: "bg-st-warn-bg", bd: "border-st-warn/45", dot: "bg-st-warn" },
  failed:      { label: "Failed", Icon: X, fg: "text-st-error", bg: "bg-st-error-bg", bd: "border-st-error/45", dot: "bg-st-error" },
};
const PROV: Record<Provenance, Meta> = {
  usda:      { label: "USDA verified", Icon: Check, fg: "text-pv-verified", bg: "bg-pv-verified-bg", bd: "border-pv-verified/45", dot: "bg-pv-verified" },
  estimated: { label: "Estimated", Icon: Sparkles, fg: "text-pv-estimated", bg: "bg-pv-estimated-bg", bd: "border-pv-estimated/45", dot: "bg-pv-estimated" },
  no_data:   { label: "No data", Icon: Minus, fg: "text-pv-nodata", bg: "bg-pv-nodata-bg", bd: "border-pv-nodata/45", dot: "bg-pv-nodata" },
  mock:      { label: "Mock", Icon: FlaskConical, fg: "text-pv-estimated", bg: "bg-pv-estimated-bg", bd: "border-pv-estimated/45 border-dashed", dot: "bg-pv-estimated" },
};

function BadgeBase({ meta, size = "md", dotOnly }: { meta: Meta; size?: "sm" | "md"; dotOnly?: boolean }) {
  const style = useBadgeStyle();
  const sm = size === "sm";
  const text = sm ? "text-[11px]" : "text-[12px]";
  const iconSz = sm ? 11 : 13;
  const { Icon } = meta;

  if (style === "dots") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 font-medium align-middle", text)} title={meta.label}>
        <span className={cn("relative w-2 h-2 rounded-full shrink-0", meta.dot)}>
          {meta.spin && <span className="absolute -inset-[3px] rounded-full border-2 border-current opacity-0 [animation:pulse-ring_1.6s_ease-out_infinite]" />}
        </span>
        {!dotOnly && <span className="text-ink-2">{meta.label}</span>}
      </span>
    );
  }
  const outline = style === "outline";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium align-middle whitespace-nowrap border",
        text, meta.fg,
        sm ? "px-[7px] py-[2px]" : "px-[9px] py-[3px]",
        outline ? cn("bg-transparent", meta.bd) : cn(meta.bg, "border-transparent"),
      )}
      title={meta.label}
    >
      <Icon size={iconSz} strokeWidth={2} className={meta.spin ? "animate-[spin_0.9s_linear_infinite]" : undefined} />
      {!dotOnly && meta.label}
    </span>
  );
}

export const StatusBadge = ({ status, ...p }: { status: StageStatus; size?: "sm" | "md"; dotOnly?: boolean }) => <BadgeBase meta={PIPELINE[status]} {...p} />;
export const EmailBadge = ({ status, ...p }: { status: EmailStatus; size?: "sm" | "md"; dotOnly?: boolean }) => <BadgeBase meta={EMAIL[status]} {...p} />;
export const ProvenanceBadge = ({ prov, ...p }: { prov: Provenance; size?: "sm" | "md" }) => <BadgeBase meta={PROV[prov]} {...p} />;

const CONF: Record<Confidence, { short: string; full: string; fg: string; pip: string }> = {
  high:   { short: "High", full: "High confidence", fg: "text-cf-high", pip: "bg-cf-high" },
  medium: { short: "Medium", full: "Medium confidence", fg: "text-cf-med", pip: "bg-cf-med" },
  low:    { short: "Low", full: "Low · needs review", fg: "text-cf-low", pip: "bg-cf-low" },
};
export function ConfidenceBadge({ level, size = "md", full = false }: { level: Confidence; size?: "sm" | "md"; full?: boolean }) {
  const m = CONF[level];
  const lit = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-border font-medium whitespace-nowrap", size === "sm" ? "text-[11px] px-2 py-[2px]" : "text-[12px] px-2.5 py-[3px]", m.fg)} title={m.full}>
      <span className="inline-flex gap-[2px] items-center" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className={cn("w-1 h-[9px] rounded-[2px]", i < lit ? m.pip : "bg-muted/20")} />)}
      </span>
      {full ? m.full : m.short}
    </span>
  );
}

export function ApprovalPill({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-st-warn text-white font-medium shadow-sh1 whitespace-nowrap", size === "sm" ? "text-[11px] px-2.5 py-1" : "text-[12px] px-3 py-1.5")}>
      <Flag size={size === "sm" ? 12 : 13} /> Needs human approval
    </span>
  );
}

const CAT: Record<Category, { label: string; dot: string }> = {
  produce: { label: "Produce", dot: "bg-cat-produce" },
  dairy: { label: "Dairy", dot: "bg-cat-dairy" },
  meat: { label: "Meat", dot: "bg-cat-meat" },
  seafood: { label: "Seafood", dot: "bg-cat-seafood" },
  drygoods: { label: "Dry goods", dot: "bg-cat-drygoods" },
};
export const CAT_DOT = CAT;
export function CatTag({ cat }: { cat: Category }) {
  const m = CAT[cat];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2 bg-surface-3 border border-border rounded-full pl-[7px] pr-[9px] py-[3px]">
      <span className={cn("w-[7px] h-[7px] rounded-full", m.dot)} /> {m.label}
    </span>
  );
}

/* ───────────────────────── Trend ───────────────────────── */
export function Trend({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="font-mono text-faint text-[12px]">—</span>;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  const color = flat ? "text-trend-flat" : up ? "text-trend-up" : "text-trend-down";
  return (
    <span className={cn("font-mono inline-flex items-center gap-[3px] text-[12px] font-medium tnum", color)}>
      <Icon size={12} strokeWidth={2.4} /> {flat ? "0.0" : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/* ───────────────────────── CountUp (visibility/reduced-motion safe) ───────────────────────── */
export function CountUp({ value, prefix = "", suffix = "", decimals = 0, dur = 700, run = true, className }: {
  value: number; prefix?: string; suffix?: string; decimals?: number; dur?: number; run?: boolean; className?: string;
}) {
  const [v, setV] = useState(value);
  const raf = useRef<number>();
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!run || reduce || document.hidden) { setV(value); return; }
    setV(0);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      setV(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const safety = setTimeout(() => setV(value), dur + 400);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); clearTimeout(safety); };
  }, [value, run, dur]);
  const out = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
  return <span className={className}>{prefix}{out}{suffix}</span>;
}

/* ───────────────────────── Skeleton ───────────────────────── */
export const Skeleton = ({ w = "100%", h = 12, r = 10, className }: { w?: number | string; h?: number; r?: number; className?: string }) =>
  <span className={cn("skeleton block", className)} style={{ width: w, height: h, borderRadius: r }} />;

/* ───────────────────────── Button ───────────────────────── */
type BtnVariant = "primary" | "secondary" | "ghost" | "quiet" | "destructive";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-forest text-white shadow-sh1 hover:bg-forest-hi hover:shadow-sh2 disabled:bg-[#B9C4BC] disabled:text-[#EEF2EF] disabled:shadow-none disabled:cursor-not-allowed",
  secondary: "bg-mint text-forest border-forest/15 hover:bg-mint-deep",
  ghost: "bg-transparent text-ink-2 border-border hover:bg-surface-3 hover:border-border-strong",
  quiet: "bg-transparent text-muted hover:bg-surface-3 hover:text-ink border-transparent",
  destructive: "bg-st-error text-white hover:brightness-95",
};
export function Button({ variant = "primary", size = "md", block, className, children, ...rest }: {
  variant?: BtnVariant; size?: "sm" | "md" | "lg"; block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz = size === "lg" ? "text-[16px] px-6 py-[15px] rounded-lg gap-2"
    : size === "sm" ? "text-[12.5px] px-[11px] py-[7px] rounded-sm gap-1.5"
    : "text-[14px] px-4 py-[11px] rounded-md gap-2";
  return (
    <button
      className={cn("inline-flex items-center justify-center font-medium leading-none border border-transparent transition active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-forest/25 whitespace-nowrap select-none", sz, BTN[variant], block && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
export const LinkButton = ({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button className={cn("bg-transparent border-0 p-0 cursor-pointer font-medium text-[12.5px] text-patty-ink hover:text-forest hover:underline underline-offset-2", className)} {...p} />;

/* ───────────────────────── Card / Panel / States ───────────────────────── */
export const Card = ({ pad, flush, className, ...p }: { pad?: boolean; flush?: boolean } & React.HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("bg-surface border border-border rounded-lg", flush ? "" : "shadow-sh1", pad && "p-5", className)} {...p} />;

export function PanelHead({ Icon, kicker, title, sub, right }: { Icon?: LucideIcon; kicker?: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-[18px]">
      <div className="flex items-start gap-3">
        {Icon && <span className="w-9 h-9 rounded-md shrink-0 inline-flex items-center justify-center bg-mint text-forest border border-forest/10"><Icon size={18} /></span>}
        <div>
          {kicker && <div className="text-[11px] font-semibold tracking-[0.09em] uppercase text-patty-ink mb-[5px]">{kicker}</div>}
          <h3 className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink leading-tight m-0">{title}</h3>
          {sub && <p className="text-[13.5px] text-muted mt-[5px] max-w-[62ch] leading-relaxed">{sub}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

type Tone = "neutral" | "warn" | "error" | "running";
const TONE: Record<Tone, string> = {
  neutral: "border-dashed border-border-strong bg-surface-2",
  warn: "border-dashed border-st-warn/40 bg-st-warn-bg/55 [&_.st-ic]:text-st-warn [&_.st-ic]:bg-st-warn-bg [&_.st-ic]:border-st-warn/30",
  error: "border-solid border-st-error/35 bg-st-error-bg/55 [&_.st-ic]:text-st-error [&_.st-ic]:bg-st-error-bg [&_.st-ic]:border-st-error/30",
  running: "border-dashed border-border-strong bg-surface-2 [&_.st-ic]:text-st-running [&_.st-ic]:bg-st-running-bg",
};
export function EmptyState({ Icon, title, body, tone = "neutral", action }: { Icon: LucideIcon; title: string; body?: string; tone?: Tone; action?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-2 px-7 py-9 rounded-lg border", TONE[tone])}>
      <span className="st-ic w-10 h-10 rounded-full mb-1 inline-flex items-center justify-center bg-surface-3 text-muted border border-border"><Icon size={20} /></span>
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {body && <div className="text-[13px] text-muted max-w-[42ch] leading-relaxed">{body}</div>}
      {action}
    </div>
  );
}

export function ReviewStrip({ Icon, tone = "warn", children }: { Icon: LucideIcon; tone?: "warn" | "error" | "info"; children: React.ReactNode }) {
  const c = tone === "error" ? "text-st-error" : tone === "info" ? "text-st-running" : "text-st-warn";
  return (
    <div className="flex gap-2.5 items-start mt-4 px-4 py-[13px] rounded-md text-[13px] leading-relaxed text-ink-2 bg-st-warn-bg/50 border border-st-warn/30">
      <Icon size={15} className={cn("shrink-0 mt-[1px]", c)} />
      <span>{children}</span>
    </div>
  );
}

/* ───────────────────────── Inputs ───────────────────────── */
export const Field = (p: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input className={cn("w-full bg-surface border border-border-strong rounded-md px-3.5 py-3 text-[14.5px] text-ink placeholder:text-faint focus:outline-none focus:border-forest focus:ring-[3px] focus:ring-forest/25 transition", p.className)} {...p} />;
export const TextArea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={cn("w-full bg-surface border border-border-strong rounded-md px-3.5 py-3 text-[14.5px] text-ink placeholder:text-faint leading-relaxed resize-y focus:outline-none focus:border-forest focus:ring-[3px] focus:ring-forest/25 transition", p.className)} {...p} />;

export function IconField({ icon, ...p }: { icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center gap-2.5 bg-surface border border-border-strong rounded-md px-3.5 focus-within:border-forest focus-within:ring-[3px] focus-within:ring-forest/25 transition">
      <span className="text-muted">{icon}</span>
      <input className="flex-1 border-0 outline-none bg-transparent text-[14.5px] text-ink placeholder:text-faint py-3" {...p} />
    </div>
  );
}

export type SegOption = { value: string; label: string; icon?: React.ReactNode };
export function Segmented({ options, value, onChange, className }: { options: SegOption[]; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn("inline-flex gap-[3px] p-[3px] w-full bg-surface-3 border border-border rounded-md", className)} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex-1 inline-flex items-center justify-center gap-[7px] text-[13px] font-medium rounded-sm px-2.5 py-2 transition",
            value === o.value ? "bg-surface text-forest shadow-sh1" : "text-muted hover:text-ink")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Table helpers ───────────────────────── */
export const TableHead = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <div className={cn("grid items-center gap-3.5 px-[18px] py-[11px] text-[11px] font-semibold tracking-[0.06em] uppercase text-muted bg-surface-2 border-b border-border", className)}>{children}</div>;
export const TableRow = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) =>
  <div className={cn("grid items-center gap-3.5 px-[18px] py-[11px] text-[13.5px] border-b border-border last:border-b-0", className)} style={style}>{children}</div>;

/* ───────────────────────── Modal shell (portal to body) ───────────────────────── */
export function Modal({ open, onClose, children, dismissable = true, label }: { open: boolean; onClose: () => void; children: React.ReactNode; dismissable?: boolean; label?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open || !dismissable) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, dismissable, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-ink/[0.38] backdrop-blur-[3px]"
      onClick={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal aria-label={label}
        className="animate-rise w-full max-w-[560px] max-h-[calc(100vh-48px)] bg-surface border border-border rounded-xl shadow-pop flex flex-col overflow-hidden">
        {children}
      </div>
    </div>,
    document.body,
  );
}
export const ModalHead = ({ Icon, kicker, title, onClose, iconClass = "bg-forest text-white" }: { Icon: LucideIcon; kicker: string; title: string; onClose: () => void; iconClass?: string }) => (
  <div className="flex items-start justify-between gap-4 px-[22px] pt-5 pb-4 border-b border-border">
    <div className="flex items-start gap-3">
      <span className={cn("w-9 h-9 rounded-md shrink-0 inline-flex items-center justify-center shadow-sh1", iconClass)}><Icon size={18} /></span>
      <div>
        <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-1">{kicker}</div>
        <h3 className="font-serif text-[21px] font-medium tracking-[-0.015em] text-ink m-0">{title}</h3>
      </div>
    </div>
    <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-sm border border-border bg-surface-2 text-muted inline-flex items-center justify-center hover:bg-surface-3 hover:text-ink transition shrink-0"><X size={18} /></button>
  </div>
);
export const ModalFoot = ({ children }: { children: React.ReactNode }) =>
  <div className="flex items-center justify-between gap-4 px-[22px] py-3.5 border-t border-border bg-surface-2">{children}</div>;

export { Check, X, Clock, Send, Flag, Plus, Minus, ArrowUp, ChevronRight }; // re-export common icons
