"use client";
// components/screens/stages.tsx — the five stage output panels, all reactive.
// Each panel renders by phase: "pending" | "running" | "done" | "error"
// and pulls its data from a dedicated Convex query keyed by runId.
import React, { useState } from "react";
import {
  Sprout, Tag, MapPin, Send, Award, Flag, Mail, Phone, Clock, Check, X, Minus, ChevronRight, Search,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cn, Card, Skeleton, Trend, CountUp, ProvenanceBadge, EmailBadge, ConfidenceBadge, CatTag, CAT_DOT,
  EmptyState, ReviewStrip, Patty, Button, TableHead, TableRow,
} from "@/components/ui";
import type { Category as UICategory, Provenance as UIProvenance } from "@/lib/data";
import { bboxToStaticMapParams, projectMercator, projectBbox } from "@/lib/map";
import { AgentTimeline, Countdown, RecipientDots } from "@/components/AgentTimeline";
import { ApproveModal } from "@/components/screens/modals";

type Phase = "pending" | "running" | "done" | "error";
type BackendCategory = "produce" | "dairy" | "meat" | "seafood" | "pantry" | "other";

const money = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const toUiCategory = (c: BackendCategory): UICategory =>
  c === "pantry" || c === "other" ? "drygoods" : c;

/* ── error helper ── */
function ErrorArm({ error, Icon }: { error?: string; Icon: typeof Sprout }) {
  return (
    <div>
      <EmptyState
        Icon={Icon}
        tone="error"
        title="Stage failed"
        body={error ?? "An unexpected error stopped this stage. Check the Convex logs for the full trace."}
      />
    </div>
  );
}

/* ═══════════ 1 · RECIPES & INGREDIENTS ═══════════ */
export function RecipesPanel({
  phase,
  runId,
  error,
}: {
  phase: Phase;
  runId: Id<"pipelineRuns">;
  error?: string;
}) {
  const data = useQuery(api.menus.getRecipesForRun, { runId });

  if (phase === "error") return <ErrorArm error={error} Icon={Sprout} />;
  if (phase === "pending")
    return (
      <EmptyState
        Icon={Sprout}
        title="Waiting to parse the menu"
        body="Patty will extract each dish and break it into an ingredient basket with estimated weekly quantities."
      />
    );
  if (phase === "running" || !data)
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card pad key={i}>
            <Skeleton w="42%" h={15} />
            <div className="h-3" />
            <div className="flex flex-wrap gap-1.5">
              {[60, 88, 52, 74].map((w, j) => <Skeleton key={j} w={w} h={22} r={999} />)}
            </div>
          </Card>
        ))}
      </div>
    );

  const lowConf = data.dishes.filter((d) => d.confidence === "low" || d.needsReview);

  return (
    <div className="animate-rise">
      <div className="grid grid-cols-4 gap-3">
        <Stat n={<CountUp value={data.stats.dishCount} />} label="dishes parsed" />
        <Stat n={<CountUp value={data.stats.lineCount} />} label="ingredient lines" />
        <Stat n={<CountUp value={data.stats.weeklyVolumeLb} suffix=" lb" />} label="weekly volume" />
        <Stat n={<CountUp value={data.stats.needReviewCount} />} label="need review" warn />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-[18px]">
        {data.dishes.map((d) => (
          <Card pad key={d._id} className="animate-rise">
            <div className="flex items-start justify-between mb-[11px]">
              <div>
                <div className="font-serif text-[18px] font-medium text-ink tracking-[-0.01em]">{d.name}</div>
                {d.description && (
                  <div className="text-[12px] text-muted mt-1 leading-snug">{d.description}</div>
                )}
              </div>
              <ConfidenceBadge level={d.confidence} size="sm" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.ingredients.map((ing) => (
                <span
                  key={ing.ingredientId}
                  className="text-[12px] text-ink-2 bg-surface-3 border border-border rounded-full px-2.5 py-1"
                >
                  {ing.canonicalName}
                </span>
              ))}
            </div>
            {d.needsReview && (
              <div className="flex gap-[7px] items-start mt-[11px] pt-[11px] border-t border-dashed border-border-strong text-[12.5px] text-muted leading-snug">
                <Flag size={13} className="text-st-warn shrink-0 mt-px" />
                Needs review. Quantities estimated from a short menu description.
              </div>
            )}
          </Card>
        ))}
      </div>
      {lowConf.length > 0 && (
        <ReviewStrip Icon={Flag}>
          <b className="text-ink font-medium">{lowConf.length} items flagged for review.</b> Quantities for low-confidence dishes are estimated. Confirm before ordering.
        </ReviewStrip>
      )}
    </div>
  );
}

const Stat = ({ n, label, warn }: { n: React.ReactNode; label: string; warn?: boolean }) => (
  <div className="bg-surface border border-border rounded-md px-4 py-3.5 shadow-sh1">
    <div className={cn("font-mono text-[24px] font-medium tracking-[-0.02em] leading-none", warn ? "text-st-warn" : "text-ink")}>
      {n}
    </div>
    <div className="text-[12px] text-muted mt-1.5">{label}</div>
  </div>
);

/* ═══════════ 2 · PRICING ═══════════ */

type PricingRow = {
  price: number | null;
  sourceLabel: string;
  provenance: "usda" | "estimated" | "mock" | "no_data";
  trend?: number | null;
  estimationDetail?: {
    method: "neighbors" | "category";
    category?: string;
    contributingReports?: { commodity: string; price: number; confidence: number; region?: string }[];
  };
  qtyDerivation?: string;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  matchConfidence?: number;
  usdaUnit?: string;
  reportSlug?: string;
  priceUnitIncomparable?: boolean;
  trendPriorDate?: string;
};

function estimationTooltip(r: PricingRow): string | undefined {
  const parts: string[] = [];
  if (r.provenance === "no_data") {
    return "No public USDA series for this commodity. Patty will ask distributors to quote it directly.";
  }
  if (r.priceUnitIncomparable) {
    parts.push(
      `USDA reported the price in "${r.usdaUnit ?? "an opaque pack"}". We could not convert that to per-lb without ambiguity, so this row is excluded from the weekly total. Patty will ask distributors to quote it directly.`,
    );
  } else if (r.provenance === "usda") {
    parts.push(r.sourceLabel);
    if (r.usdaUnit && r.usdaUnit.toLowerCase() !== r.sourceLabel.toLowerCase()) {
      // Only show conversion line if the pack actually got converted.
      const u = r.usdaUnit.toLowerCase();
      if (u !== "lb" && u !== "each" && u !== "gal") {
        parts.push(`Original USDA pack: ${r.usdaUnit}. Converted to per base unit.`);
      }
    }
    if (r.priceRangeLow != null && r.priceRangeHigh != null) {
      const where = r.estimationDetail?.contributingReports?.[0]?.region ?? "reporting markets";
      parts.push(`Range $${r.priceRangeLow.toFixed(2)} to $${r.priceRangeHigh.toFixed(2)} across ${where}.`);
    }
  } else if (r.estimationDetail?.method === "neighbors" && r.estimationDetail.contributingReports?.length) {
    const cites = r.estimationDetail.contributingReports
      .slice(0, 4)
      .map((c) => `${c.commodity} $${c.price.toFixed(2)}`)
      .join(", ");
    parts.push(`Median of ${r.estimationDetail.contributingReports.length} weak USDA matches: ${cites}.`);
  } else if (r.estimationDetail?.method === "category") {
    const cat = r.estimationDetail.category ?? "category";
    parts.push(
      `Category average for ${cat}. No close USDA matches found, so we used a documented per-pound estimate.`,
    );
  } else {
    parts.push(r.sourceLabel);
  }
  if (r.matchConfidence != null && r.matchConfidence > 0) {
    parts.push(`Commodity-name match confidence: ${Math.round(r.matchConfidence * 100)}%.`);
  }
  return parts.join(" ");
}

function trendTooltip(r: PricingRow): string | undefined {
  if (r.trend == null) {
    return "USDA only published one usable snapshot for this commodity in the window we checked.";
  }
  if (r.trendPriorDate) return `Compared to ${r.trendPriorDate}.`;
  return undefined;
}

export function PricingPanel({
  phase,
  runId,
  error,
}: {
  phase: Phase;
  runId: Id<"pipelineRuns">;
  error?: string;
}) {
  const data = useQuery(api.pricing.getPricingForRun, { runId });
  const cols = "[grid-template-columns:1.7fr_0.8fr_1fr_1fr_1.6fr]";

  if (phase === "error") return <ErrorArm error={error} Icon={Tag} />;
  if (phase === "pending")
    return (
      <EmptyState
        Icon={Tag}
        title="Pricing not started"
        body="Each ingredient will be priced against USDA market data where available."
      />
    );
  if (phase === "running" || !data)
    return (
      <Card className="overflow-hidden">
        <TableHead className={cols}>
          <span>Ingredient</span><span>Qty</span><span>Price</span><span>Trend</span><span>Source</span>
        </TableHead>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <TableRow key={i} className={cols}>
            <Skeleton w="72%" h={13} />
            <Skeleton w="70%" h={13} />
            <Skeleton w={56} h={13} />
            <Skeleton w={40} h={13} />
            <Skeleton w="82%" h={13} />
          </TableRow>
        ))}
      </Card>
    );

  const noDataRows = data.rows.filter((r) => r.provenance === "no_data");

  return (
    <div className="animate-rise">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3.5">
        <div className="flex gap-2 flex-wrap">
          <Chip><Check size={13} className="text-pv-verified" />{data.summary.priced} priced</Chip>
          <Chip><span className="text-pv-estimated">✦</span>{data.summary.estimated} estimated</Chip>
          <Chip><Minus size={13} className="text-pv-nodata" />{data.summary.noData} no data</Chip>
          {data.summary.incomparable > 0 && (
            <Chip>
              <span
                className="text-pv-nodata"
                title="USDA returned the price in an opaque pack (e.g. carton, case) with no stated size. Excluded from the weekly total. Distributor quotes will fill these in."
              >
                ?
              </span>
              {data.summary.incomparable} pending quote
            </Chip>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[12px] text-muted">
            Est. weekly basket <span className="text-faint">(priced items)</span>
          </span>
          <span className="font-mono text-[22px] font-medium text-forest tracking-[-0.02em]">
            <CountUp value={data.summary.weeklyTotal} prefix="$" />
          </span>
        </div>
      </div>
      <Card className="overflow-hidden">
        <TableHead className={cols}>
          <span>Ingredient</span><span>Qty</span><span>Unit price</span>
          <span>Trend <span className="font-normal text-faint">· vs prior report</span></span>
          <span>Provenance</span>
        </TableHead>
        {data.rows.map((r) => {
          const noPrice = r.price === null || r.priceUnitIncomparable === true;
          return (
            <TableRow key={r.id} className={cn(cols, "animate-rise", noPrice && "bg-surface-3/60")}>
              <span className="font-medium text-ink inline-flex items-center gap-1.5">
                {r.name}
                {r.flag && <Flag size={11} className="text-st-warn" />}
              </span>
              <span
                className="font-mono text-muted text-[12.5px]"
                title={r.qtyDerivation ?? `${r.qty} ${r.unit} weekly estimate. Aggregated from per-dish ingredient quantities times each dish's estimated servings per week.`}
              >
                {r.qty} {r.unit}
              </span>
              <span
                className="font-mono font-medium text-ink"
                title={r.priceUnitIncomparable && r.usdaUnit ? `USDA returned the price in "${r.usdaUnit}". We could not convert to per-lb safely. Asking distributors to quote directly.` : undefined}
              >
                {noPrice ? <span className="text-faint">–</span> : (
                  <>${r.price!.toFixed(2)}<span className="text-faint text-[11.5px] font-normal">/{r.unit}</span></>
                )}
              </span>
              <span title={trendTooltip(r)}><Trend pct={r.trend} /></span>
              <span
                className="flex flex-col gap-[3px] items-start"
                title={estimationTooltip(r)}
              >
                <ProvenanceBadge prov={r.provenance as UIProvenance} size="sm" />
                <span className="text-[11px] text-faint">{r.sourceLabel}</span>
              </span>
            </TableRow>
          );
        })}
      </Card>
      {noDataRows.length > 0 && (
        <ReviewStrip Icon={Minus}>
          <b className="text-ink font-medium">{noDataRows.length} items have no public pricing.</b>{" "}
          {noDataRows.slice(0, 2).map((r) => r.name).join(" and ")}
          {noDataRows.length > 2 ? `, plus ${noDataRows.length - 2} more` : ""}. Patty will ask distributors to quote these directly rather than guess.
        </ReviewStrip>
      )}
    </div>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted bg-surface-3 border border-border rounded-full px-2.5 py-1 whitespace-nowrap">
    {children}
  </span>
);

/* ═══════════ 3 · DISTRIBUTORS (+ stylized map) ═══════════ */
export function DistributorsPanel({
  phase,
  runId,
  error,
}: {
  phase: Phase;
  runId: Id<"pipelineRuns">;
  error?: string;
}) {
  if (phase === "error") return <ErrorArm error={error} Icon={MapPin} />;
  if (phase === "pending")
    return (
      <EmptyState
        Icon={MapPin}
        title="No distributors yet"
        body="Patty will search verified suppliers near the restaurant and match them to the ingredient basket by category."
      />
    );
  return <DistributorsBody runId={runId} phase={phase} />;
}

function DistributorsBody({
  runId,
  phase,
}: {
  runId: Id<"pipelineRuns">;
  phase: Phase;
}) {
  const data = useQuery(api.distributors.getDistributorsForRun, { runId });
  const [mapFailed, setMapFailed] = useState(false);

  if (phase === "running" || !data)
    return (
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card pad key={i}>
              <Skeleton w="50%" h={15} />
              <div className="h-2" />
              <Skeleton w="80%" h={12} />
            </Card>
          ))}
          <div className="inline-flex items-center gap-2 text-[12.5px] text-muted px-1 py-2.5">
            <Search size={14} /> Widening search radius…
          </div>
        </div>
        <Card className="relative aspect-[4/5] min-h-[360px] overflow-hidden">
          <Skeleton className="absolute inset-0" r={18} />
        </Card>
      </div>
    );

  const distributors = data.distributors;
  const restaurant = data.restaurant;

  // Frame the static map so restaurant + every distributor fits.
  const allLats = [restaurant.lat, ...distributors.map((d) => d.lat)];
  const allLngs = [restaurant.lng, ...distributors.map((d) => d.lng)];
  const { center, zoom } = bboxToStaticMapParams(allLats, allLngs);
  const MAP_W = 600;
  const MAP_H = 750;
  const markers = [
    `${restaurant.lat},${restaurant.lng}`,
    ...distributors.map((d) => `${d.lat},${d.lng}`),
  ].join("|");
  const mapSrc = `/api/static-map?center=${center.lat},${center.lng}&zoom=${zoom}&size=${MAP_W}x${MAP_H}&markers=${encodeURIComponent(markers)}`;
  // Real Google map → Mercator projection. Stylized fallback → bbox 10-90.
  const project = (lat: number, lng: number) =>
    mapFailed
      ? projectBbox(lat, lng, allLats, allLngs)
      : projectMercator(lat, lng, center.lat, center.lng, zoom, MAP_W, MAP_H);
  const restaurantPin = project(restaurant.lat, restaurant.lng);

  const isPreview = data.displaySource === "preview";
  return (
    <div className="grid grid-cols-2 gap-4 items-start animate-rise">
      <div className="flex flex-col gap-3 max-h-[640px] overflow-y-auto pr-1">
        {isPreview && (
          <div
            className="inline-flex items-center gap-2 text-[11.5px] text-muted px-2 py-1.5 bg-surface-3 border border-border rounded-md leading-snug"
            title="Stage 4 has not selected RFP recipients yet. This is a preview of the qualifying distributors; the list collapses to the actual recipients once the RFP is created."
          >
            <Clock size={12} className="text-st-running shrink-0" />
            <span>Preview · final RFP recipient list pending Stage 4.</span>
          </div>
        )}
        {distributors.map((d) => (
          <Card pad key={d._id} className="animate-rise">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <span className="w-[30px] h-[30px] rounded-sm shrink-0 inline-flex items-center justify-center bg-mint text-forest border border-forest/10">
                  <MapPin size={15} />
                </span>
                <div>
                  <div className="text-[15.5px] font-medium text-ink">{d.name}</div>
                  <div className="font-mono text-[11.5px] text-muted mt-0.5">
                    {d.distanceMi > 0 ? `${d.distanceMi} mi away` : d.address.split(",")[1]?.trim() ?? d.address}
                  </div>
                </div>
              </div>
              <ProvenanceBadge prov={d.provLabel === "verified" ? "usda" : "estimated"} size="sm" />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3 mb-[11px]">
              {d.categories.map((c) => (
                <CatTag key={c} cat={toUiCategory(c as BackendCategory)} />
              ))}
            </div>
            <div className="flex flex-col gap-1.5 pt-[11px] border-t border-border text-[12.5px] text-ink-2">
              {d.email ? (
                <span className="flex items-center gap-1.5">
                  <Mail size={13} className="text-muted" />
                  <span className="font-mono text-[12px] truncate">{d.email}</span>
                </span>
              ) : d.contactStatus === "needs_enrichment" ? (
                <span
                  className="flex items-center gap-1.5 text-muted"
                  title="No mailto link found on this distributor's website. We attempted to scrape an email; in production this would also enrich against a B2B contact database."
                >
                  <Mail size={13} />
                  <span className="text-[12px] italic">Email pending enrichment</span>
                </span>
              ) : null}
              {d.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone size={13} className="text-muted" />
                  <span className="font-mono text-[12px]">{d.phone}</span>
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
      {/* Real Google static map with our pin overlay. If the proxy returns
          non-2xx (key missing, API not enabled, upstream error), the img
          onError swaps in a stylized gradient + grid placeholder so the
          card never renders broken. */}
      <Card
        className="relative aspect-[4/5] min-h-[360px] overflow-hidden sticky top-[76px]"
        style={
          mapFailed
            ? ({ background: "linear-gradient(160deg,#F3F1EA,#ECEFE9)" } as React.CSSProperties)
            : undefined
        }
      >
        {mapFailed ? (
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                "linear-gradient(#E9E5DA 1px,transparent 1px),linear-gradient(90deg,#E9E5DA 1px,transparent 1px)",
              backgroundSize: "34px 34px",
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapSrc}
            alt=""
            aria-hidden
            onError={() => setMapFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute top-3 left-3 z-[3] flex flex-col gap-1.5 bg-surface/90 backdrop-blur border border-border rounded-sm px-[11px] py-2 text-[11.5px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-forest" />Restaurant
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-patty" />Distributor
          </span>
        </div>
        {/* Restaurant pin */}
        <div
          className="absolute z-[2] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${restaurantPin.xPct}%`, top: `${restaurantPin.yPct}%` }}
        >
          <span className="block w-4 h-4 rounded-full bg-forest border-[3px] border-white shadow-sh2 [animation:pulse-ring_2s_ease-out_infinite]" />
        </div>
        {distributors.map((d) => {
          const { xPct, yPct } = project(d.lat, d.lng);
          return (
            <div
              key={d._id}
              className="absolute z-[2] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${xPct}%`, top: `${yPct}%` }}
            >
              <MapPin
                size={13}
                className="text-white bg-patty p-[5px] shadow-sh2"
                style={{ borderRadius: "50% 50% 50% 2px", width: 23, height: 23 }}
              />
              <span className="text-[10.5px] font-semibold text-forest-lo mt-[3px] bg-surface/80 px-1.5 rounded-full whitespace-nowrap max-w-[120px] truncate">
                {d.name.split(" ").slice(0, 2).join(" ")}
              </span>
            </div>
          );
        })}
        <div className="absolute bottom-2 right-2.5 z-[3] font-mono text-[10px] text-muted">
          {mapFailed ? "map · offline" : "map · google"}
        </div>
      </Card>
    </div>
  );
}

/* ═══════════ 4 · RFP EMAILS ═══════════ */
export function RfpPanel({
  phase,
  runId,
  error,
}: {
  phase: Phase;
  runId: Id<"pipelineRuns">;
  error?: string;
}) {
  if (phase === "error") return <ErrorArm error={error} Icon={Send} />;
  if (phase === "pending")
    return (
      <EmptyState
        Icon={Send}
        title="No RFPs sent yet"
        body="Patty will email each distributor a request for quote with the relevant ingredient lines, quantities, and a reply deadline."
      />
    );
  return <RfpBody runId={runId} phase={phase} />;
}

function RfpBody({ runId, phase }: { runId: Id<"pipelineRuns">; phase: Phase }) {
  const data = useQuery(api.email.getRfpThreadsForRun, { runId });
  const demoConfig = useQuery(api.email.getDemoConfig, {});
  const [selId, setSelId] = useState<Id<"rfpRecipients"> | null>(null);
  const demoRedirectInbox = demoConfig?.demoRedirectInbox ?? null;

  if (phase === "running" || !data)
    return (
      <div className="grid grid-cols-[0.92fr_1.08fr] gap-4 items-start">
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Card pad key={i} className="flex items-center justify-between">
              <Skeleton w="46%" h={14} />
              <Skeleton w={64} h={22} r={999} />
            </Card>
          ))}
        </div>
        <Card pad>
          <Skeleton w="60%" h={14} />
          <div className="h-2.5" />
          <Skeleton w="90%" h={11} />
          <div className="h-1.5" />
          <Skeleton w="84%" h={11} />
        </Card>
      </div>
    );

  if (data.threads.length === 0)
    return (
      <EmptyState
        Icon={Send}
        title="No outbound RFPs"
        body="No distributors matched the basket categories. Try expanding the basket or address."
      />
    );

  const sel =
    data.threads.find((t) => t.recipientId === selId) ?? data.threads[0];

  const footByStatus =
    sel.status === "replied"
      ? `Replied ${sel.repliedAt ? fmtDate(sel.repliedAt) : ""}`
      : sel.status === "followed_up"
        ? "Awaiting reply · followed up"
        : sel.status === "failed"
          ? "Bounced or send-failed"
          : sel.status === "sent"
            ? "Sent autonomously by Patty"
            : "Queued";

  return (
    <div className="grid grid-cols-[0.92fr_1.08fr] gap-4 items-start animate-rise">
      <div className="flex flex-col gap-2 max-h-[640px] overflow-y-auto pr-1">
        <div className="inline-flex items-center gap-[7px] text-[12.5px] text-muted px-0.5 pt-1 pb-2">
          <Clock size={14} className="text-muted" />Reply deadline ·{" "}
          <b className="text-ink font-medium">{fmtDate(data.deadline)}</b>
        </div>
        {data.threads.map((th) => {
          const pin =
            th.status === "replied"
              ? "bg-st-done-bg text-st-done"
              : th.status === "sent"
                ? "bg-st-running-bg text-st-running"
                : th.status === "followed_up"
                  ? "bg-st-warn-bg text-st-warn"
                  : th.status === "failed"
                    ? "bg-st-error-bg text-st-error"
                    : "bg-surface-3 text-muted";
          return (
            <button
              key={th.recipientId}
              onClick={() => setSelId(th.recipientId)}
              className={cn(
                "block w-full text-left bg-surface border rounded-lg p-5 shadow-sh1 transition hover:shadow-sh2",
                sel.recipientId === th.recipientId
                  ? "border-forest ring-2 ring-forest/20"
                  : "border-border",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={cn("w-[30px] h-[30px] rounded-sm shrink-0 inline-flex items-center justify-center border border-border", pin)}>
                    <Mail size={14} />
                  </span>
                  <div>
                    <div className="text-[14.5px] font-medium text-ink">{th.distributorName}</div>
                    <div className="font-mono text-[11.5px] text-muted mt-0.5">
                      {th.sentAt ? `sent ${fmtDate(th.sentAt)}` : "not sent"}
                      {th.repliedAt ? ` · replied ${fmtDate(th.repliedAt)}` : ""}
                      {th.attempts > 1 ? ` · ${th.attempts} attempts` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <EmailBadge status={th.status} size="sm" />
                  <ChevronRight size={14} className="text-faint" />
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted">
                <RecipientDots
                  emailStatus={th.status}
                  attempts={th.attempts}
                  hasQuote={!!th.repliedAt || th.hasParsedQuote}
                  parsed={th.hasParsedQuote}
                />
                <span className="font-mono">sent · nudged · replied · parsed</span>
              </div>
              {th.note && (
                <div
                  className={cn(
                    "mt-2.5 pt-2.5 border-t border-dashed border-border-strong text-[12.5px] leading-snug",
                    th.status === "failed" ? "text-st-error" : "text-muted",
                  )}
                >
                  {th.note}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {/* email preview */}
      <Card className="overflow-hidden sticky top-[76px]">
        {sel.status === "failed" && (
          <div className="flex items-center gap-2 px-[18px] py-2.5 text-[12.5px] leading-snug text-st-error bg-st-error-bg border-b border-st-error/20">
            <X size={14} />
            <span>
              <b className="font-semibold">Delivery failed</b>
              {sel.distributorPhone ? `. Trying ${sel.distributorPhone}.` : "."}
            </span>
          </div>
        )}
        <div className="px-[18px] py-4 bg-surface-2 border-b border-border flex flex-col gap-[7px]">
          <EmailRow k="From" v={<span className="font-mono text-[12.5px]">{sel.fromAddress}</span>} />
          <EmailRow
            k="To"
            v={
              sel.toAddress ? (
                <span className="flex flex-col gap-px leading-tight">
                  <span className="text-[13px] text-ink-2">
                    {sel.distributorName}{" "}
                    <span className="font-mono text-[11px] text-muted">
                      &lt;{sel.toAddress}&gt;
                    </span>
                  </span>
                  {demoRedirectInbox && (
                    <span
                      className="font-mono text-[11px] text-st-warn"
                      title="DEMO_REDIRECT_INBOX is set. The actual outbound message goes to this inbox instead of the distributor's real address, so the demo never bothers a real business."
                    >
                      → via demo redirect to {demoRedirectInbox}
                    </span>
                  )}
                </span>
              ) : (
                <span className="font-mono text-[12.5px]">(no email)</span>
              )
            }
          />
          <EmailRow k="Subject" v={<b className="font-medium">{sel.subject}</b>} />
        </div>
        <div className="p-[18px] text-[13.5px] leading-relaxed text-ink-2">
          <p className="mb-[11px]">Hi {sel.distributorName.split(" ")[0]} team,</p>
          <p className="mb-[11px]">
            {data.restaurantName} ({data.restaurantAddress}) is requesting a quote for the following weekly items. Please reply with unit pricing, delivery days, and terms by{" "}
            <b className="font-medium">{fmtDate(data.deadline)}</b>.
          </p>
          {sel.rfpItems.length > 0 ? (
            <table className="w-full border-collapse font-mono text-[12.5px] my-1 mb-3">
              <thead>
                <tr>
                  <th className="text-left font-semibold text-muted border-b border-border px-2 py-1.5 text-[11px] uppercase tracking-wide">Item</th>
                  <th className="text-right font-semibold text-muted border-b border-border px-2 py-1.5 text-[11px] uppercase tracking-wide">Qty / wk</th>
                </tr>
              </thead>
              <tbody>
                {sel.rfpItems.map((it) => (
                  <tr key={it.ingredientId}>
                    <td className="px-2 py-[5px] border-b border-border text-ink-2">{it.rawName}</td>
                    <td className="px-2 py-[5px] border-b border-border text-right text-ink">
                      {it.qty} {it.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted text-[12.5px] italic">
              (No category overlap. No items requested from this distributor.)
            </p>
          )}
          <p className="text-muted">
            Thank you,<br />Patty · procurement, on behalf of {data.restaurantName}
          </p>
        </div>
        <div className="flex items-center gap-[7px] px-[18px] py-3 border-t border-border bg-surface-2 text-[11.5px] text-muted">
          <Patty size={14} />
          <span>{footByStatus}</span>
        </div>
      </Card>
    </div>
  );
}

const EmailRow = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="grid grid-cols-[64px_1fr] gap-2.5 items-baseline text-[13px]">
    <span className="text-[11px] font-semibold tracking-wide uppercase text-muted">{k}</span>
    <span className="text-ink-2">{v}</span>
  </div>
);

/* ═══════════ 5 · QUOTES & RECOMMENDATION ═══════════ */
export function QuotesPanel({
  phase,
  runId,
  error,
}: {
  phase: Phase;
  runId: Id<"pipelineRuns">;
  error?: string;
}) {
  if (phase === "error") return <ErrorArm error={error} Icon={Award} />;
  if (phase === "pending")
    return (
      <EmptyState
        Icon={Award}
        title="Stage 5 is opening"
        body="Patty is wiring up the inbound flow. Quotes start landing here automatically as soon as Stage 4 finishes queuing RFPs."
      />
    );
  return <QuotesBody runId={runId} />;
}

function QuotesBody({ runId }: { runId: Id<"pipelineRuns"> }) {
  const rec = useQuery(api.recommendations.getForRun, { runId });
  const table = useQuery(api.recommendations.comparisonTable, { runId });
  const deadline = useQuery(api.agent.getRunDeadline, { runId });
  const [approve, setApprove] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);

  const loading = rec === undefined || table === undefined;
  if (loading || !table) {
    return (
      <div className="flex flex-col gap-4">
        {deadline && (
          <div className="flex justify-end">
            <Countdown deadlineMs={deadline} />
          </div>
        )}
        <Card pad>
          <div className="flex items-center gap-2.5 mb-3">
            <Clock size={16} className="text-st-running" />
            <span className="text-[13px] font-medium text-ink">Patty&apos;s notebook</span>
          </div>
          <AgentTimeline runId={runId} limit={20} />
        </Card>
      </div>
    );
  }

  const noQuoteCount = table.filter((r) => !r.hasQuote).length;

  return (
    <div className="animate-rise flex flex-col gap-4">
      {deadline && (
        <div className="flex justify-end">
          <Countdown deadlineMs={deadline} />
        </div>
      )}
      {/* Recommendation card */}
      {rec && (
        <RecommendationCard rec={rec} onApprove={() => setApprove(true)} />
      )}

      {/* Comparison table */}
      <div className="flex items-baseline justify-between mt-[26px] mb-3">
        <h4 className="font-serif text-[18px] font-medium text-ink m-0">Quote comparison</h4>
        <span className="text-[12.5px] text-muted">
          {table.length - noQuoteCount} quotes · {noQuoteCount} no response
        </span>
      </div>
      {table.length === 0 ? (
        <EmptyState
          Icon={Award}
          title="No recipients yet"
          body="The RFP stage hasn't queued any recipients."
        />
      ) : (
        <ComparisonTable table={table} awardedIds={recAwardedIds(rec)} />
      )}
      {noQuoteCount > 0 && noQuoteCount === table.length && (
        <ReviewStrip Icon={X} tone="error">
          <b className="text-ink font-medium">No distributor has replied yet.</b> Patty will keep nudging via the agent cron and follow up on missing info.
        </ReviewStrip>
      )}

      {/* Demo controls: exercise agent behaviors without waiting for the cron */}
      <DemoControls runId={runId} />

      {/* Patty's notebook: agent activity log, collapsed by default */}
      <Card pad>
        <button
          onClick={() => setNotebookOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="flex items-center gap-2.5">
            <Clock size={15} className="text-muted" />
            <span className="text-[13.5px] font-medium text-ink">Patty&apos;s notebook</span>
            <span className="font-mono text-[11px] text-faint">agent activity log</span>
          </span>
          <ChevronRight
            size={16}
            className={cn(
              "text-muted transition-transform",
              notebookOpen && "rotate-90",
            )}
          />
        </button>
        {notebookOpen && (
          <div className="mt-3 pt-3 border-t border-border">
            <AgentTimeline runId={runId} limit={50} />
          </div>
        )}
      </Card>

      <ApproveModal
        open={approve}
        onClose={() => setApprove(false)}
        recommendationId={rec?.recommendation._id}
        restaurantName={"this restaurant"}
        splits={
          rec
            ? rec.splits.map((s) => ({
                distributorName: s.distributor?.name ?? "Distributor",
                role: s.role,
                weeklyValue: s.weeklyValue,
              }))
            : []
        }
        gaps={rec?.recommendation.gaps ?? []}
      />
    </div>
  );
}

function DemoControls({ runId }: { runId: Id<"pipelineRuns"> }) {
  // Open by default so the agent-behavior buttons are visible on first
  // render of Stage 5. The headline simulate path now runs automatically
  // via autoSimulateReplies; these buttons exercise edge cases.
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demoMissingInfo = useAction(api.email.demoMissingInfoReplyForRecipient);
  const demoStale = useMutation(api.email.demoMarkRecipientStale);
  const forceTick = useAction(api.email.forceTick);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(`${label}: done.`);
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-2.5">
          <Search size={15} className="text-muted" />
          <span className="text-[13.5px] font-medium text-ink">Demo controls</span>
          <span className="font-mono text-[11px] text-faint">exercise agent behaviors (follow-ups, nudges, tick)</span>
        </span>
        <ChevronRight
          size={16}
          className={cn("text-muted transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                run("Simulate missing-info reply", () => demoMissingInfo({ runId }))
              }
            >
              Simulate missing-info reply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run("Simulate stale recipient", () => demoStale({ runId }))}
            >
              Simulate stale recipient
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => run("Force tick", () => forceTick({}))}
            >
              Force tick now
            </Button>
          </div>
          <p className="text-[11.5px] text-muted leading-relaxed">
            These actions exercise the agent&apos;s missing-info follow-up, no-reply nudge, and immediate tick paths without waiting for the 5 minute heartbeat. Watch Patty&apos;s notebook below to see the events fire.
          </p>
          {status && (
            <p className="font-mono text-[11px] text-ink-2 bg-surface-3 border border-border rounded px-2 py-1">
              {status}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function recAwardedIds(rec: ReturnType<typeof useQuery<typeof api.recommendations.getForRun>>) {
  if (!rec) return new Set<string>();
  const ids = new Set<string>();
  if (rec.recommendation.primaryDistributorId)
    ids.add(rec.recommendation.primaryDistributorId as unknown as string);
  for (const s of rec.splits) ids.add(s.distributorId as unknown as string);
  return ids;
}

type RecommendationView = NonNullable<
  ReturnType<typeof useQuery<typeof api.recommendations.getForRun>>
>;

function RecommendationCard({
  rec,
  onApprove,
}: {
  rec: RecommendationView;
  onApprove: () => void;
}) {
  const r = rec.recommendation;
  const baseline = r.estBaseline ?? 0;
  const savings = r.estSavings ?? 0;
  const approved = !!r.approvedAt;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl p-[22px] shadow-sh3 border",
        r.needsHumanApproval ? "border-st-warn/40" : "border-forest/20",
      )}
      style={{
        background: r.needsHumanApproval
          ? "linear-gradient(168deg, color-mix(in oklch,#FBF2DC 60%,#fff), #fff 60%)"
          : "linear-gradient(168deg, color-mix(in oklch,#F1F7F3 70%,#fff), #fff 58%)",
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "w-10 h-10 rounded-md shrink-0 inline-flex items-center justify-center text-white shadow-sh2",
              r.needsHumanApproval ? "bg-st-warn" : "bg-forest",
            )}
          >
            <Award size={20} />
          </span>
          <div>
            <div
              className={cn(
                "flex items-center gap-2.5 text-[11.5px] font-semibold tracking-[0.07em] uppercase mb-[5px]",
                r.needsHumanApproval ? "text-st-warn" : "text-forest",
              )}
            >
              Patty&apos;s recommendation
              <ConfidenceBadge level={r.confidence} size="sm" full />
            </div>
            <h3 className="font-serif text-[24px] font-medium tracking-[-0.015em] text-ink m-0 leading-tight">
              {r.headline}
            </h3>
          </div>
        </div>
        {r.needsHumanApproval && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white bg-st-warn rounded-full px-3 py-1.5 shadow-sh1 shrink-0">
            <Flag size={13} /> Needs human approval
          </span>
        )}
      </div>
      <p className="text-[14.5px] leading-relaxed text-ink-2 mb-[18px] max-w-[70ch]">
        {r.rationale}
      </p>
      {rec.splits.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {rec.splits.map((s) => (
            <div
              key={s.distributorId}
              className="bg-surface/75 border border-border rounded-md px-4 py-3.5"
            >
              <div className="flex items-baseline justify-between gap-2.5">
                <span className="text-[14.5px] font-medium text-ink">
                  {s.distributor?.name ?? "Distributor"}
                </span>
                <span className="font-mono text-[16px] font-medium text-forest">
                  {money(s.weeklyValue)}
                  <span className="text-faint text-[11px] font-normal">/wk</span>
                </span>
              </div>
              <div className="text-[12.5px] text-muted mt-1">{s.role}</div>
            </div>
          ))}
        </div>
      )}
      {r.gaps.length > 0 && (
        <div className="bg-surface/70 border border-dashed border-st-warn/40 rounded-md px-4 py-3.5 mb-4">
          <div className="flex items-center gap-[7px] text-[13px] font-medium text-ink mb-2.5">
            <Flag size={13} className="text-st-warn" /> {r.gaps.length} lines need a human decision
          </div>
          {r.gaps.map((g, i) => (
            <div
              key={g.item + i}
              className={cn(
                "flex items-baseline gap-3 py-1.5",
                i > 0 && "border-t border-border",
              )}
            >
              <span className="text-[13px] font-medium text-ink-2 min-w-[200px] shrink-0">
                {g.item}
              </span>
              <span className="text-[12.5px] text-muted">{g.reason}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-4 pt-4 border-t border-border">
        <div className="flex flex-col gap-[3px]">
          <span className="text-[11.5px] text-muted">Est. weekly saving vs. baseline</span>
          <span className="font-mono text-[20px] font-medium text-forest tracking-[-0.02em]">
            <CountUp value={Math.round(savings)} prefix="$" /> {baseline > 0 && (
              <span className="text-faint text-[12px] font-normal">
                of {money(baseline)}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-2">
          {approved ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-st-done">
              <Check size={14} /> Approved {r.approvedAt ? fmtDate(r.approvedAt) : ""}
            </span>
          ) : (
            <Button variant="primary" size="sm" onClick={onApprove}>
              <Check size={14} /> Review &amp; approve award
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type CompTable = NonNullable<
  ReturnType<typeof useQuery<typeof api.recommendations.comparisonTable>>
>;

function ComparisonTable({
  table,
  awardedIds,
}: {
  table: CompTable;
  awardedIds: Set<string>;
}) {
  const rows = [
    {
      k: "Total / wk",
      get: (q: CompTable[number]) =>
        q.totalPrice == null ? "–" : money(q.totalPrice),
      mono: true,
    },
    { k: "Completeness", complete: true },
    {
      k: "Delivery",
      get: (q: CompTable[number]) => q.deliveryTerms || "–",
    },
    {
      k: "Terms",
      get: (q: CompTable[number]) => q.paymentTerms || "–",
      mono: true,
    },
    {
      k: "Lead time",
      get: (q: CompTable[number]) => q.leadTime || "–",
      mono: true,
    },
  ];
  const cap = table.slice(0, 6);
  return (
    <div className="overflow-x-auto">
      <div
        className="grid bg-surface border border-border rounded-lg overflow-hidden min-w-[640px]"
        style={{
          gridTemplateColumns: `132px repeat(${cap.length}, minmax(140px,1fr))`,
        }}
      >
        <div className="bg-surface-2 border-b border-border" />
        {cap.map((q) => {
          const awarded = awardedIds.has(q.distributor._id as unknown as string);
          const nq = !q.hasQuote;
          return (
            <div
              key={q.recipientId}
              className={cn(
                "relative px-3.5 py-3 border-b border-l border-border flex flex-col gap-[3px]",
                awarded ? "bg-mint" : "bg-surface-2",
                nq && "opacity-65",
              )}
            >
              {awarded && (
                <span className="absolute top-0 right-0 text-[9.5px] font-bold tracking-wide uppercase text-white bg-forest px-2 py-[3px] rounded-bl-sm">
                  Awarded
                </span>
              )}
              <span className="text-[13.5px] font-medium text-ink pr-10 truncate">
                {q.distributor.name}
              </span>
              <span className="text-[11px] text-muted flex items-center gap-2">
                <EmailBadge status={q.emailStatus} size="sm" />
                <RecipientDots
                  emailStatus={q.emailStatus}
                  attempts={q.attempts}
                  hasQuote={q.hasQuote}
                  parsed={q.hasQuote && q.parseConfidence !== undefined}
                />
              </span>
            </div>
          );
        })}
        {rows.map((row) => (
          <React.Fragment key={row.k}>
            <div className="px-3.5 py-3 text-[12.5px] text-muted border-b border-border flex items-center bg-surface-2">
              {row.k}
            </div>
            {cap.map((q) => {
              const awarded = awardedIds.has(q.distributor._id as unknown as string);
              const nq = !q.hasQuote;
              return (
                <div
                  key={q.recipientId}
                  className={cn(
                    "px-3.5 py-3 text-[13.5px] border-b border-l border-border flex items-center",
                    awarded && "bg-mint/[0.45] font-medium",
                    nq && "text-faint",
                    row.mono && "font-mono",
                  )}
                >
                  {row.complete ? (
                    nq ? (
                      <span className="text-faint">–</span>
                    ) : (
                      <div className="flex items-center gap-2 w-full">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden min-w-[40px]">
                          <span
                            className={cn(
                              "block h-full rounded-full transition-[width] duration-700",
                              awarded ? "bg-forest" : "bg-sage",
                            )}
                            style={{ width: `${Math.min(100, q.completePct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11.5px] text-muted">
                          {q.itemsQuoted}/{q.itemsTotal}
                        </span>
                      </div>
                    )
                  ) : (
                    row.get!(q)
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {/* tag-row using CAT_DOT for categories — visual hook to design */}
      <div className="text-[11px] text-faint mt-2">
        Showing {cap.length} of {table.length} recipients.{" "}
        <span className="inline-flex items-center gap-1">
          <span className={cn("w-2 h-2 rounded-full", CAT_DOT.produce.dot)} />
        </span>
      </div>
    </div>
  );
}
