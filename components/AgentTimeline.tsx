"use client";
import React, { useEffect, useState } from "react";
import {
  Search, Send, Bell, MailCheck, FileText, Award, Clock, X, type LucideIcon,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn, Patty } from "@/components/ui";

type AgentKind =
  | "tick_scan"
  | "follow_up_sent"
  | "nudge_sent"
  | "quote_received"
  | "quote_parsed"
  | "recommendation_written"
  | "scheduled"
  | "send_failed";

const ICON: Record<AgentKind, LucideIcon> = {
  tick_scan: Search,
  follow_up_sent: Send,
  nudge_sent: Bell,
  quote_received: MailCheck,
  quote_parsed: FileText,
  recommendation_written: Award,
  scheduled: Clock,
  send_failed: X,
};

const TONE: Record<AgentKind, string> = {
  tick_scan: "text-muted bg-surface-3 border-border",
  follow_up_sent: "text-st-running bg-st-running-bg border-st-running/30",
  nudge_sent: "text-st-warn bg-st-warn-bg border-st-warn/30",
  quote_received: "text-st-done bg-st-done-bg border-st-done/30",
  quote_parsed: "text-forest bg-mint border-forest/15",
  recommendation_written: "text-forest bg-mint border-forest/30",
  scheduled: "text-faint bg-surface-3 border-border",
  send_failed: "text-st-error bg-st-error-bg border-st-error/30",
};

function fmtAgo(deltaMs: number): string {
  if (deltaMs < 5000) return "just now";
  const s = Math.round(deltaMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function fmtAbs(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export function AgentTimeline({
  runId,
  limit = 30,
  emptyHint,
}: {
  runId: Id<"pipelineRuns">;
  limit?: number;
  emptyHint?: string;
}) {
  const events = useQuery(api.agent.getRecentEventsForRun, { runId, limit });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  if (events === undefined) {
    return (
      <div className="flex flex-col gap-2.5 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[34px] rounded-md bg-surface-3 animate-pulse" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2.5 py-4 px-3 text-[13px] text-muted bg-surface-3 border border-border rounded-md">
        <Patty size={18} className="opacity-60" />
        <span>{emptyHint ?? "Nothing to report yet. Patty is waiting for replies."}</span>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5 list-none m-0 p-0">
      {events.map((e) => {
        const kind = e.kind as AgentKind;
        const Ic = ICON[kind] ?? Search;
        return (
          <li
            key={e._id}
            className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-md hover:bg-surface-3 transition-colors"
          >
            <span
              className={cn(
                "w-[26px] h-[26px] rounded-sm shrink-0 inline-flex items-center justify-center border",
                TONE[kind] ?? TONE.tick_scan,
              )}
            >
              <Ic size={13} />
            </span>
            <span className="text-[13px] text-ink-2 leading-snug flex-1 min-w-0 truncate">
              {e.summary}
            </span>
            <span
              className="font-mono text-[11px] text-faint shrink-0"
              title={fmtAbs(e.at)}
            >
              {fmtAgo(now - e.at)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Per-recipient micro-timeline. Four dots, each filled when its event has
 * fired for this recipient. Tooltip on the dot describes the moment.
 *
 *   ● ● ○ ○   sent · nudged · replied · parsed
 */
export function RecipientDots({
  emailStatus,
  attempts,
  hasQuote,
  parsed,
}: {
  emailStatus: "queued" | "sent" | "replied" | "followed_up" | "failed";
  attempts: number;
  hasQuote: boolean;
  parsed: boolean;
}) {
  const sent = emailStatus !== "queued";
  const nudged = attempts >= 2 || emailStatus === "followed_up";
  const replied = emailStatus === "replied" || hasQuote;
  const failed = emailStatus === "failed";

  const dot = (filled: boolean, tone: "default" | "error" = "default") =>
    cn(
      "w-1.5 h-1.5 rounded-full inline-block",
      filled
        ? tone === "error"
          ? "bg-st-error"
          : "bg-forest"
        : "bg-border-strong/50",
    );

  return (
    <span className="inline-flex items-center gap-1" aria-label="Recipient timeline">
      <span className={dot(sent, failed ? "error" : "default")} title={sent ? "RFP sent" : "Not sent yet"} />
      <span className="w-2 h-px bg-border-strong/40" />
      <span className={dot(nudged)} title={nudged ? "Nudged" : "Has not been nudged"} />
      <span className="w-2 h-px bg-border-strong/40" />
      <span className={dot(replied)} title={replied ? "Replied" : "No reply yet"} />
      <span className="w-2 h-px bg-border-strong/40" />
      <span className={dot(parsed)} title={parsed ? "Quote parsed" : "Quote not parsed"} />
    </span>
  );
}

export function Countdown({ deadlineMs }: { deadlineMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = deadlineMs - now;
  if (left <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-st-error bg-st-error-bg border border-st-error/30 rounded-full px-2.5 py-1">
        <Clock size={12} /> Deadline passed. Patty is finalizing the award.
      </span>
    );
  }

  const s = Math.floor(left / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const label =
    h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;

  const urgency =
    left < 5 * 60 * 1000
      ? "text-st-error bg-st-error-bg border-st-error/30 font-semibold"
      : left < 30 * 60 * 1000
        ? "text-st-warn bg-st-warn-bg border-st-warn/30"
        : "text-muted bg-surface-3 border-border";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[12px] rounded-full px-2.5 py-1 border",
        urgency,
      )}
    >
      <Clock size={12} /> Quotes close in {label}.
    </span>
  );
}
