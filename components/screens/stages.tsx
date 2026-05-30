"use client";
// components/screens/stages.tsx — the five stage output panels.
// Each renders by phase: "pending" | "running" | "done".
import React, { useState } from "react";
import { Sprout, Tag, MapPin, Send, Award, Flag, Mail, Phone, Clock, Check, X, Minus, ChevronRight, Search } from "lucide-react";
import {
  cn, Card, Skeleton, Trend, CountUp, ProvenanceBadge, EmailBadge, ConfidenceBadge, CatTag, CAT_DOT,
  EmptyState, ReviewStrip, Patty, PattyAvatar, Button, TableHead, TableRow,
} from "@/components/ui";
import {
  DISHES, INGREDIENTS, PRICING, DISTRIBUTORS, EMAILS, QUOTES, RECOMMENDATION, RFP_ITEMS,
  ingredientById as ing, distributorById as dist,
} from "@/lib/data";
import { ApproveModal, BasketModal } from "@/components/screens/modals";

type Phase = "pending" | "running" | "done" | "error";
const money = (n: number) => "$" + Math.round(n).toLocaleString();

/* ═══════════ 1 · RECIPES & INGREDIENTS ═══════════ */
export function RecipesPanel({ phase }: { phase: Phase }) {
  if (phase === "pending")
    return <EmptyState Icon={Sprout} title="Waiting to parse the menu" body="Patty will extract each dish and break it into an ingredient basket with estimated weekly quantities." />;
  if (phase === "running")
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card pad key={i}><Skeleton w="42%" h={15} /><div className="h-3" /><div className="flex flex-wrap gap-1.5">{[60, 88, 52, 74].map((w, j) => <Skeleton key={j} w={w} h={22} r={999} />)}</div></Card>
        ))}
      </div>
    );

  const needReview = INGREDIENTS.filter((i) => i.confidence !== "high").length;
  const volume = INGREDIENTS.reduce((a, b) => a + (b.unit === "doz" ? 0 : b.qty), 0);
  const lowConf = DISHES.filter((d) => d.confidence === "low" || d.note);
  return (
    <div className="animate-rise">
      <div className="grid grid-cols-4 gap-3">
        <Stat n={<CountUp value={DISHES.length} />} label="dishes parsed" />
        <Stat n={<CountUp value={INGREDIENTS.length} />} label="ingredient lines" />
        <Stat n={<CountUp value={volume} suffix=" lb" />} label="weekly volume" />
        <Stat n={<CountUp value={needReview} />} label="need review" warn />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-[18px]">
        {DISHES.map((d) => (
          <Card pad key={d.name} className="animate-rise">
            <div className="flex items-start justify-between mb-[11px]">
              <div>
                <div className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-patty-ink mb-[3px]">{d.section}</div>
                <div className="font-serif text-[18px] font-medium text-ink tracking-[-0.01em]">{d.name}</div>
              </div>
              <ConfidenceBadge level={d.confidence} size="sm" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.ingredients.map((x) => <span key={x} className="text-[12px] text-ink-2 bg-surface-3 border border-border rounded-full px-2.5 py-1">{x}</span>)}
            </div>
            {d.note && <div className="flex gap-[7px] items-start mt-[11px] pt-[11px] border-t border-dashed border-border-strong text-[12.5px] text-muted leading-snug"><Flag size={13} className="text-st-warn shrink-0 mt-px" />{d.note}</div>}
          </Card>
        ))}
      </div>
      {lowConf.length > 0 && (
        <ReviewStrip Icon={Flag}><b className="text-ink font-medium">{lowConf.length} items flagged for review.</b> Quantities for low-confidence dishes are estimated from short menu descriptions — confirm before ordering.</ReviewStrip>
      )}
    </div>
  );
}
const Stat = ({ n, label, warn }: { n: React.ReactNode; label: string; warn?: boolean }) => (
  <div className="bg-surface border border-border rounded-md px-4 py-3.5 shadow-sh1">
    <div className={cn("font-mono text-[24px] font-medium tracking-[-0.02em] leading-none", warn ? "text-st-warn" : "text-ink")}>{n}</div>
    <div className="text-[12px] text-muted mt-1.5">{label}</div>
  </div>
);

/* ═══════════ 2 · PRICING ═══════════ */
export function PricingPanel({ phase }: { phase: Phase }) {
  if (phase === "pending")
    return <EmptyState Icon={Tag} title="Pricing not started" body="Each ingredient will be priced against USDA market data where available, with estimates and gaps clearly labeled." />;
  if (phase === "running")
    return (
      <Card className="overflow-hidden">
        <TableHead className="[grid-template-columns:1.7fr_0.8fr_1fr_1fr_1.6fr]"><span>Ingredient</span><span>Qty</span><span>Price</span><span>Trend</span><span>Source</span></TableHead>
        {PRICING.rows.slice(0, 8).map((_, i) => (
          <TableRow key={i} className="[grid-template-columns:1.7fr_0.8fr_1fr_1fr_1.6fr]"><Skeleton w="72%" h={13} /><Skeleton w="70%" h={13} /><Skeleton w={56} h={13} /><Skeleton w={40} h={13} /><Skeleton w="82%" h={13} /></TableRow>
        ))}
      </Card>
    );

  const priced = PRICING.rows.filter((r) => r.price !== null);
  const noData = PRICING.rows.filter((r) => r.price === null);
  const estimated = priced.filter((r) => r.prov === "estimated").length;
  const weekly = priced.reduce((a, r) => a + (ing(r.id)!.qty * (r.price as number)), 0);
  const cols = "[grid-template-columns:1.7fr_0.8fr_1fr_1fr_1.6fr]";
  return (
    <div className="animate-rise">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3.5">
        <div className="flex gap-2 flex-wrap">
          <Chip><Check size={13} className="text-pv-verified" />{priced.length} priced</Chip>
          <Chip><span className="text-pv-estimated">✦</span>{estimated} estimated</Chip>
          <Chip><Minus size={13} className="text-pv-nodata" />{noData.length} no data</Chip>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] text-muted">Est. weekly basket <span className="text-faint">(priced items)</span></span>
          <span className="font-mono text-[22px] font-medium text-forest tracking-[-0.02em]"><CountUp value={weekly} prefix="$" /></span>
        </div>
      </div>
      <Card className="overflow-hidden">
        <TableHead className={cols}><span>Ingredient</span><span>Qty</span><span>Unit price</span><span>Trend <span className="font-normal text-faint">· vs last wk</span></span><span>Provenance</span></TableHead>
        {PRICING.rows.map((r) => {
          const it = ing(r.id)!;
          const nd = r.price === null;
          return (
            <TableRow key={r.id} className={cn(cols, "animate-rise", nd && "bg-surface-3/60")}>
              <span className="font-medium text-ink inline-flex items-center gap-1.5">{it.name}{it.flag && <Flag size={11} className="text-st-warn" />}</span>
              <span className="font-mono text-muted text-[12.5px]">{it.qty} {it.unit}</span>
              <span className="font-mono font-medium text-ink">{nd ? <span className="text-faint">—</span> : <>${(r.price as number).toFixed(2)}<span className="text-faint text-[11.5px] font-normal">/{r.unit}</span></>}</span>
              <span><Trend pct={r.trend} /></span>
              <span className="flex flex-col gap-[3px] items-start"><ProvenanceBadge prov={r.prov} size="sm" /><span className="text-[11px] text-faint">{r.src}</span></span>
            </TableRow>
          );
        })}
      </Card>
      {noData.length > 0 && (
        <ReviewStrip Icon={Minus}><b className="text-ink font-medium">{noData.length} items have no public pricing.</b> Mozzarella di bufala and fresh tagliatelle aren’t in any commodity series — Patty will ask distributors to quote them directly rather than guess.</ReviewStrip>
      )}
    </div>
  );
}
const Chip = ({ children }: { children: React.ReactNode }) =>
  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted bg-surface-3 border border-border rounded-full px-2.5 py-1 whitespace-nowrap">{children}</span>;

/* ═══════════ 3 · DISTRIBUTORS (+ stylized map) ═══════════ */
export function DistributorsPanel({ phase }: { phase: Phase }) {
  if (phase === "pending")
    return <EmptyState Icon={MapPin} title="No distributors yet" body="Patty will search verified suppliers near the restaurant and match them to the ingredient basket by category." />;
  if (phase === "running")
    return (
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Card pad key={i}><Skeleton w="50%" h={15} /><div className="h-2" /><Skeleton w="80%" h={12} /></Card>)}
          <div className="inline-flex items-center gap-2 text-[12.5px] text-muted px-1 py-2.5"><Search size={14} /> Widening search radius…</div>
        </div>
        <Card className="relative aspect-[4/5] min-h-[360px] overflow-hidden"><Skeleton className="absolute inset-0" r={18} /></Card>
      </div>
    );

  return (
    <div className="grid grid-cols-2 gap-4 items-start animate-rise">
      <div className="flex flex-col gap-3">
        {DISTRIBUTORS.map((d) => (
          <Card pad key={d.id} className="animate-rise">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <span className="w-[30px] h-[30px] rounded-sm shrink-0 inline-flex items-center justify-center bg-mint text-forest border border-forest/10"><MapPin size={15} /></span>
                <div>
                  <div className="text-[15.5px] font-medium text-ink">{d.name}</div>
                  <div className="font-mono text-[11.5px] text-muted mt-0.5">{d.dist} away</div>
                </div>
              </div>
              <ProvenanceBadge prov={d.prov === "verified" ? "usda" : "estimated"} size="sm" />
            </div>
            <p className="text-[13px] text-muted leading-relaxed my-[11px]">{d.blurb}</p>
            <div className="flex flex-wrap gap-1.5 mb-[11px]">{d.cats.map((c) => <CatTag key={c} cat={c} />)}</div>
            <div className="flex flex-col gap-1.5 pt-[11px] border-t border-border text-[12.5px] text-ink-2">
              <span className="flex items-center gap-1.5"><Mail size={13} className="text-muted" /><span className="font-mono text-[12px]">{d.contact}</span></span>
              <span className="flex items-center gap-1.5"><Phone size={13} className="text-muted" /><span className="font-mono text-[12px]">{d.phone}</span></span>
            </div>
          </Card>
        ))}
      </div>
      {/* stylized map */}
      <Card className="relative aspect-[4/5] min-h-[360px] overflow-hidden" style={{ background: "linear-gradient(160deg,#F3F1EA,#ECEFE9)" } as React.CSSProperties}>
        <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "linear-gradient(#E9E5DA 1px,transparent 1px),linear-gradient(90deg,#E9E5DA 1px,transparent 1px)", backgroundSize: "34px 34px" }} />
        <div className="absolute inset-0 opacity-90" style={{ background: "linear-gradient(115deg,transparent 46%,#fff 46% 49%,transparent 49%),linear-gradient(28deg,transparent 60%,#fff 60% 62.5%,transparent 62.5%)" }} />
        <div className="absolute top-3 left-3 z-[3] flex flex-col gap-1.5 bg-surface/90 backdrop-blur border border-border rounded-sm px-[11px] py-2 text-[11.5px] text-ink-2">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-forest" />Restaurant</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-patty" />Distributor</span>
        </div>
        <div className="absolute z-[2] -translate-x-1/2 -translate-y-1/2" style={{ left: "50%", top: "54%" }}>
          <span className="block w-4 h-4 rounded-full bg-forest border-[3px] border-white shadow-sh2 [animation:pulse-ring_2s_ease-out_infinite]" />
        </div>
        {DISTRIBUTORS.map((d) => (
          <div key={d.id} className="absolute z-[2] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${d.lat}%`, top: `${d.lng}%` }}>
            <MapPin size={13} className="text-white bg-patty p-[5px] shadow-sh2" style={{ borderRadius: "50% 50% 50% 2px", width: 23, height: 23 }} />
            <span className="text-[10.5px] font-semibold text-forest-lo mt-[3px] bg-surface/80 px-1.5 rounded-full whitespace-nowrap">{d.name.split(" ")[0]}</span>
          </div>
        ))}
        <div className="absolute bottom-2 right-2.5 z-[3] font-mono text-[10px] text-muted">map · illustrative</div>
      </Card>
    </div>
  );
}

/* ═══════════ 4 · RFP EMAILS ═══════════ */
export function RfpPanel({ phase }: { phase: Phase }) {
  if (phase === "pending")
    return <EmptyState Icon={Send} title="No RFPs sent yet" body="Patty will email each distributor a request for quote with the relevant ingredient lines, quantities, and a reply deadline." />;
  if (phase === "running")
    return (
      <div className="grid grid-cols-[0.92fr_1.08fr] gap-4 items-start">
        <div className="flex flex-col gap-2">{EMAILS.threads.map((_, i) => <Card pad key={i} className="flex items-center justify-between"><Skeleton w="46%" h={14} /><Skeleton w={64} h={22} r={999} /></Card>)}</div>
        <Card pad><Skeleton w="60%" h={14} /><div className="h-2.5" /><Skeleton w="90%" h={11} /><div className="h-1.5" /><Skeleton w="84%" h={11} /></Card>
      </div>
    );
  return <RfpDone />;
}
function RfpDone() {
  const [sel, setSel] = useState("lombardi");
  const t = EMAILS.threads.find((x) => x.id === sel)!;
  const d = dist(sel)!;
  const cfg = RFP_ITEMS[sel];
  const footByStatus = t.status === "replied" ? `Replied ${t.repliedAt}` : t.status === "followed_up" ? "Awaiting reply · followed up" : t.status === "failed" ? "Bounced · retrying by phone" : "Sent autonomously by Patty";
  return (
    <div className="grid grid-cols-[0.92fr_1.08fr] gap-4 items-start animate-rise">
      <div className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-[7px] text-[12.5px] text-muted px-0.5 pt-1 pb-2"><Clock size={14} className="text-muted" />Reply deadline · <b className="text-ink font-medium">{EMAILS.deadline}</b></div>
        {EMAILS.threads.map((th) => {
          const dd = dist(th.id)!;
          const pin = th.status === "replied" ? "bg-st-done-bg text-st-done" : th.status === "sent" ? "bg-st-running-bg text-st-running" : th.status === "followed_up" ? "bg-st-warn-bg text-st-warn" : th.status === "failed" ? "bg-st-error-bg text-st-error" : "bg-surface-3 text-muted";
          return (
            <button key={th.id} onClick={() => setSel(th.id)}
              className={cn("block w-full text-left bg-surface border rounded-lg p-5 shadow-sh1 transition hover:shadow-sh2", sel === th.id ? "border-forest ring-2 ring-forest/20" : "border-border")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={cn("w-[30px] h-[30px] rounded-sm shrink-0 inline-flex items-center justify-center border border-border", pin)}><Mail size={14} /></span>
                  <div>
                    <div className="text-[14.5px] font-medium text-ink">{dd.name}</div>
                    <div className="font-mono text-[11.5px] text-muted mt-0.5">sent {th.sentAt}{th.repliedAt ? ` · replied ${th.repliedAt}` : ""}{th.attempts > 1 ? ` · ${th.attempts} attempts` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2"><EmailBadge status={th.status} size="sm" /><ChevronRight size={14} className="text-faint" /></div>
              </div>
              {th.note && <div className={cn("mt-2.5 pt-2.5 border-t border-dashed border-border-strong text-[12.5px] leading-snug", th.status === "failed" ? "text-st-error" : "text-muted")}>{th.note}</div>}
            </button>
          );
        })}
      </div>
      {/* email preview */}
      <Card className="overflow-hidden sticky top-[76px]">
        {t.status === "failed" && <div className="flex items-center gap-2 px-[18px] py-2.5 text-[12.5px] leading-snug text-st-error bg-st-error-bg border-b border-st-error/20"><X size={14} /><span><b className="font-semibold">Delivery failed</b> — mailbox unavailable. Patty is trying {d.phone}.</span></div>}
        <div className="px-[18px] py-4 bg-surface-2 border-b border-border flex flex-col gap-[7px]">
          <EmailRow k="From" v={<span className="font-mono text-[12.5px]">patty@trattorialucia.pathway.app</span>} />
          <EmailRow k="To" v={<span className="font-mono text-[12.5px]">{d.contact}</span>} />
          <EmailRow k="Subject" v={<b className="font-medium">{cfg.subject}</b>} />
        </div>
        <div className="p-[18px] text-[13.5px] leading-relaxed text-ink-2">
          <p className="mb-[11px]">Hi {d.name.split(" ")[0]} team,</p>
          <p className="mb-[11px]">Trattoria Lucia (214 Court St) is requesting a quote for the following weekly items. Please reply with unit pricing, delivery days, and terms by <b className="font-medium">Fri May 30, 5:00 PM ET</b>.</p>
          <table className="w-full border-collapse font-mono text-[12.5px] my-1 mb-3">
            <thead><tr><th className="text-left font-semibold text-muted border-b border-border px-2 py-1.5 text-[11px] uppercase tracking-wide">Item</th><th className="text-right font-semibold text-muted border-b border-border px-2 py-1.5 text-[11px] uppercase tracking-wide">Qty / wk</th></tr></thead>
            <tbody>{cfg.items.map((id) => { const it = ing(id)!; return <tr key={id}><td className="px-2 py-[5px] border-b border-border text-ink-2">{it.name}</td><td className="px-2 py-[5px] border-b border-border text-right text-ink">{it.qty} {it.unit}</td></tr>; })}</tbody>
          </table>
          <p className="text-muted">Thank you,<br />Patty · procurement, on behalf of Trattoria Lucia</p>
        </div>
        <div className="flex items-center gap-[7px] px-[18px] py-3 border-t border-border bg-surface-2 text-[11.5px] text-muted"><Patty size={14} /><span>{footByStatus} · <span className="font-mono text-faint">RFP-2418-{cfg.rfp}</span></span></div>
      </Card>
    </div>
  );
}
const EmailRow = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="grid grid-cols-[64px_1fr] gap-2.5 items-baseline text-[13px]"><span className="text-[11px] font-semibold tracking-wide uppercase text-muted">{k}</span><span className="text-ink-2">{v}</span></div>
);

/* ═══════════ 5 · QUOTES & RECOMMENDATION ═══════════ */
export function QuotesPanel({ phase, run = true }: { phase: Phase; run?: boolean }) {
  const [approve, setApprove] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjusted, setAdjusted] = useState<{ changes: number; removed: number } | null>(null);

  if (phase === "pending")
    return <EmptyState Icon={Award} title="No quotes collected yet" body="As distributors reply, Patty normalizes their quotes into one comparison and recommends an award." />;
  if (phase === "running")
    return (
      <div>
        <EmptyState Icon={Clock} tone="running" title="Awaiting replies…" body="2 of 4 distributors have responded. Patty is normalizing line items and will recommend an award once quotes settle." />
        <Card className="mt-4 overflow-hidden">{[0, 1, 2, 3].map((i) => <TableRow key={i} className="[grid-template-columns:1.7fr_0.8fr_1fr_1fr_1.6fr]"><Skeleton w="60%" h={13} /><Skeleton w="70%" h={13} /><Skeleton w={56} h={13} /><Skeleton w={60} h={13} /><Skeleton w="50%" h={13} /></TableRow>)}</Card>
      </div>
    );

  const rec = RECOMMENDATION;
  const noQuote = QUOTES.filter((q) => q.total === null);
  const rows = [
    { k: "Total / wk", get: (q: typeof QUOTES[number]) => q.total === null ? "—" : money(q.total), mono: true },
    { k: "Completeness", complete: true },
    { k: "Delivery", get: (q: typeof QUOTES[number]) => q.delivery || "—" },
    { k: "Terms", get: (q: typeof QUOTES[number]) => q.terms || "—", mono: true },
    { k: "Lead time", get: (q: typeof QUOTES[number]) => q.lead || "—", mono: true },
  ];
  const isRec = (id: string) => rec.splits.some((s) => s.id === id);

  return (
    <div className="animate-rise">
      {adjusted && (
        <div className="flex items-center justify-between gap-3 mb-4 px-3.5 py-3 rounded-md text-[13px] leading-relaxed text-ink-2 bg-mint border border-patty/40 animate-rise">
          <span className="flex items-center gap-2"><PattyAvatar size={24} live /><span><b className="text-ink font-medium">Basket updated · {adjusted.changes} change{adjusted.changes > 1 ? "s" : ""}.</b> Patty is re-pricing the affected lines and will re-send {adjusted.removed > 0 ? "the remaining " : ""}RFPs — quotes refresh shortly.</span></span>
          <button onClick={() => setAdjusted(null)} aria-label="Dismiss" className="shrink-0 w-[26px] h-[26px] rounded-md text-muted hover:bg-forest/10 hover:text-ink inline-flex items-center justify-center"><X size={15} /></button>
        </div>
      )}

      {/* Recommendation card */}
      <div className={cn("relative overflow-hidden rounded-xl p-[22px] shadow-sh3 border", rec.needsApproval ? "border-st-warn/40" : "border-forest/20")}
        style={{ background: rec.needsApproval ? "linear-gradient(168deg, color-mix(in oklch,#FBF2DC 60%,#fff), #fff 60%)" : "linear-gradient(168deg, color-mix(in oklch,#F1F7F3 70%,#fff), #fff 58%)" }}>
        <div className="flex items-start justify-between gap-4 mb-3.5">
          <div className="flex items-start gap-3">
            <span className={cn("w-10 h-10 rounded-md shrink-0 inline-flex items-center justify-center text-white shadow-sh2", rec.needsApproval ? "bg-st-warn" : "bg-forest")}><Award size={20} /></span>
            <div>
              <div className={cn("flex items-center gap-2.5 text-[11.5px] font-semibold tracking-[0.07em] uppercase mb-[5px]", rec.needsApproval ? "text-st-warn" : "text-forest")}>Patty’s recommendation<ConfidenceBadge level={rec.confidence} size="sm" full /></div>
              <h3 className="font-serif text-[24px] font-medium tracking-[-0.015em] text-ink m-0 leading-tight">{rec.headline}</h3>
            </div>
          </div>
          {rec.needsApproval && <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white bg-st-warn rounded-full px-3 py-1.5 shadow-sh1 shrink-0"><Flag size={13} /> Needs human approval</span>}
        </div>
        <p className="text-[14.5px] leading-relaxed text-ink-2 mb-[18px] max-w-[70ch]">{rec.rationale}</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {rec.splits.map((s) => (
            <div key={s.id} className="bg-surface/75 border border-border rounded-md px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2.5"><span className="text-[14.5px] font-medium text-ink">{dist(s.id)!.name}</span><span className="font-mono text-[16px] font-medium text-forest">{money(s.value)}<span className="text-faint text-[11px] font-normal">/wk</span></span></div>
              <div className="text-[12.5px] text-muted mt-1">{s.role}</div>
            </div>
          ))}
        </div>
        {rec.gaps.length > 0 && (
          <div className="bg-surface/70 border border-dashed border-st-warn/40 rounded-md px-4 py-3.5 mb-4">
            <div className="flex items-center gap-[7px] text-[13px] font-medium text-ink mb-2.5"><Flag size={13} className="text-st-warn" /> {rec.gaps.length} lines need a human decision</div>
            {rec.gaps.map((g, i) => (
              <div key={g.item} className={cn("flex items-baseline gap-3 py-1.5", i > 0 && "border-t border-border")}>
                <span className="text-[13px] font-medium text-ink-2 min-w-[200px] shrink-0">{g.item}</span><span className="text-[12.5px] text-muted">{g.reason}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 pt-4 border-t border-border">
          <div className="flex flex-col gap-[3px]"><span className="text-[11.5px] text-muted">Est. weekly saving vs. baseline</span><span className="font-mono text-[20px] font-medium text-forest tracking-[-0.02em]"><CountUp value={rec.estSavings} prefix="$" run={run} /> <span className="text-faint text-[12px] font-normal">of {money(rec.estBaseline)}</span></span></div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdjustOpen(true)}>Adjust basket</Button>
            <Button variant="primary" size="sm" onClick={() => setApprove(true)}><Check size={14} /> Review &amp; approve award</Button>
          </div>
        </div>
      </div>

      {/* comparison table */}
      <div className="flex items-baseline justify-between mt-[26px] mb-3"><h4 className="font-serif text-[18px] font-medium text-ink m-0">Quote comparison</h4><span className="text-[12.5px] text-muted">{QUOTES.length - noQuote.length} quotes · {noQuote.length} no response</span></div>
      <div className="overflow-x-auto">
        <div className="grid bg-surface border border-border rounded-lg overflow-hidden min-w-[640px]" style={{ gridTemplateColumns: `132px repeat(${QUOTES.length}, minmax(120px,1fr))` }}>
          <div className="bg-surface-2 border-b border-border" />
          {QUOTES.map((q) => {
            const r = isRec(q.id), nq = q.total === null;
            return (
              <div key={q.id} className={cn("relative px-3.5 py-3 border-b border-l border-border flex flex-col gap-[3px]", r ? "bg-mint" : "bg-surface-2", nq && "opacity-65")}>
                {r && <span className="absolute top-0 right-0 text-[9.5px] font-bold tracking-wide uppercase text-white bg-forest px-2 py-[3px] rounded-bl-sm">Awarded</span>}
                <span className="text-[13.5px] font-medium text-ink pr-10">{dist(q.id)!.name}</span>
                <span className="text-[11px] text-muted">{dist(q.id)!.cats.map((c) => CAT_DOT[c].label).join(" · ")}</span>
              </div>
            );
          })}
          {rows.map((row) => (
            <React.Fragment key={row.k}>
              <div className="px-3.5 py-3 text-[12.5px] text-muted border-b border-border flex items-center bg-surface-2">{row.k}</div>
              {QUOTES.map((q) => {
                const r = isRec(q.id), nq = q.total === null;
                return (
                  <div key={q.id} className={cn("px-3.5 py-3 text-[13.5px] border-b border-l border-border flex items-center", r && "bg-mint/[0.45] font-medium", nq && "text-faint", row.mono && "font-mono")}>
                    {row.complete ? (nq ? <span className="text-faint">—</span> : (
                      <div className="flex items-center gap-2 w-full"><div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[40px]"><span className={cn("block h-full rounded-full transition-[width] duration-700", r ? "bg-forest" : "bg-sage")} style={{ width: `${q.complete}%` }} /></div><span className="font-mono text-[11.5px] text-muted">{q.itemsQuoted}/{q.itemsTotal}</span></div>
                    )) : row.get!(q)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {noQuote.length > 0 && (
        <ReviewStrip Icon={X} tone="error"><b className="text-ink font-medium">{noQuote.map((q) => dist(q.id)!.name).join(", ")} did not quote.</b> The RFP email hard-bounced — Patty held the specialty-import lines out of the award rather than guess a price.</ReviewStrip>
      )}

      <ApproveModal open={approve} onClose={() => setApprove(false)} />
      <BasketModal open={adjustOpen} onClose={() => setAdjustOpen(false)} onApply={(s) => setAdjusted(s)} />
    </div>
  );
}
