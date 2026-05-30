"use client";
// components/screens/modals.tsx — ApproveModal (wired to approveRecommendation).
import React, { useEffect, useState } from "react";
import { Award, Check, Send, Flag, Clock, LoaderCircle, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn, Modal, ModalHead, ModalFoot, Button, Patty, ReviewStrip } from "@/components/ui";

const money = (n: number) => "$" + Math.round(n).toLocaleString();

const DECISIONS = [
  { v: "hold", label: "Hold for reply", note: "Patty retries silent distributors and notifies you." },
  { v: "manual", label: "Source manually", note: "Assign to a buyer to handle off-platform." },
  { v: "drop", label: "Drop this week", note: "Remove the line from this week's order." },
];

export interface ApproveModalSplit {
  distributorName: string;
  role: string;
  weeklyValue: number;
}
export interface ApproveModalGap {
  item: string;
  reason: string;
}

export function ApproveModal({
  open,
  onClose,
  recommendationId,
  restaurantName,
  splits,
  gaps,
}: {
  open: boolean;
  onClose: () => void;
  recommendationId: Id<"recommendations"> | undefined;
  restaurantName: string;
  splits: ApproveModalSplit[];
  gaps: ApproveModalGap[];
}) {
  const approve = useMutation(api.recommendations.approveRecommendation);
  const [step, setStep] = useState<"review" | "sending" | "done">("review");
  const [decisions, setDecisions] = useState<string[]>(gaps.map(() => "hold"));
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("review");
      setDecisions(gaps.map(() => "hold"));
      setAck(false);
      setError(null);
    }
  }, [open, gaps]);

  const total = splits.reduce((a, s) => a + s.weeklyValue, 0);
  const pos = splits.map((s, i) => ({ ...s, po: `PO-${4471 + i}` }));
  const held = decisions.filter((d) => d === "hold").length;
  const manual = decisions.filter((d) => d === "manual").length;
  const dropped = decisions.filter((d) => d === "drop").length;

  const send = async () => {
    if (!recommendationId) {
      setError("Recommendation not yet ready");
      return;
    }
    setError(null);
    setStep("sending");
    try {
      await approve({ recommendationId });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("review");
    }
  };

  return (
    <Modal open={open} onClose={onClose} dismissable={step !== "sending"} label="Review and approve award">
      {step === "review" && (
        <>
          <ModalHead
            Icon={Award}
            kicker={`Approve award · ${restaurantName}`}
            title="Review & approve award"
            onClose={onClose}
          />
          <div className="px-[22px] py-5 overflow-y-auto">
            <Label>Purchase orders to send</Label>
            <div className="flex flex-col gap-2">
              {pos.map((p) => (
                <div
                  key={p.po}
                  className="flex items-center gap-3 px-3.5 py-3 bg-surface-2 border border-border rounded-md"
                >
                  <span className="w-[26px] h-[26px] rounded-full shrink-0 inline-flex items-center justify-center bg-mint text-forest border border-forest/20">
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                  <div className="flex-1">
                    <div className="text-[14px] font-medium text-ink">{p.distributorName}</div>
                    <div className="text-[12px] text-muted mt-px">{p.role}</div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-[14.5px] font-medium text-forest">
                      {money(p.weeklyValue)}
                      <span className="text-faint text-[11px]">/wk</span>
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-3.5 pt-1.5 text-[13px] text-ink-2">
                <span>Total committed weekly</span>
                <span className="font-mono text-[16px] font-medium text-ink">{money(total)}</span>
              </div>
            </div>

            {gaps.length > 0 && (
              <>
                <Label className="mt-5">
                  <Flag size={13} className="text-st-warn" /> Decide on {gaps.length} unquoted lines
                </Label>
                <div className="flex flex-col gap-3">
                  {gaps.map((g, i) => (
                    <div
                      key={g.item}
                      className="p-3.5 border border-dashed border-st-warn/40 rounded-md bg-st-warn-bg/35"
                    >
                      <div className="mb-2.5">
                        <div className="text-[13.5px] font-medium text-ink">{g.item}</div>
                        <div className="text-[12px] text-muted mt-px leading-snug">{g.reason}</div>
                      </div>
                      <div className="flex gap-[3px] p-[3px] bg-surface border border-border rounded-sm">
                        {DECISIONS.map((o) => (
                          <button
                            key={o.v}
                            onClick={() => setDecisions((d) => d.map((x, j) => (j === i ? o.v : x)))}
                            className={cn(
                              "flex-1 text-[12px] font-medium rounded-[7px] px-1.5 py-[7px] whitespace-nowrap transition",
                              decisions[i] === o.v
                                ? "bg-forest text-white shadow-sh1"
                                : "text-muted hover:text-ink",
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      <div className="text-[11.5px] text-muted mt-2 pl-0.5">
                        {DECISIONS.find((o) => o.v === decisions[i])!.note}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label className="flex items-start gap-2.5 mt-[18px] p-3.5 border border-border rounded-md cursor-pointer select-none">
              <input
                type="checkbox"
                className="sr-only"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span
                className={cn(
                  "w-5 h-5 shrink-0 rounded-[6px] border-[1.5px] inline-flex items-center justify-center mt-px transition",
                  ack
                    ? "bg-forest border-forest text-white"
                    : "border-border-strong bg-surface text-transparent",
                )}
              >
                <Check size={13} strokeWidth={3} />
              </span>
              <span className="text-[13px] leading-relaxed text-ink-2">
                I authorize Patty to send these purchase orders on behalf of {restaurantName}.
              </span>
            </label>
            {error && (
              <div className="mt-3">
                <ReviewStrip Icon={X} tone="error">
                  <b className="text-ink font-medium">Approval failed.</b> {error}
                </ReviewStrip>
              </div>
            )}
          </div>
          <ModalFoot>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Patty size={14} /> Patty will keep watching for held replies.
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!ack || !recommendationId}
                onClick={send}
              >
                <Send size={14} /> Approve &amp; send {pos.length} POs
              </Button>
            </div>
          </ModalFoot>
        </>
      )}

      {step === "sending" && (
        <div className="flex flex-col items-center text-center gap-1.5 px-7 pt-10 pb-7">
          <span className="text-st-running mb-1.5">
            <LoaderCircle size={26} className="animate-[spin_0.9s_linear_infinite]" />
          </span>
          <div className="text-[19px] font-medium text-ink">Sending purchase orders…</div>
          <div className="text-[13.5px] text-muted max-w-[42ch] leading-relaxed">
            Recording award decision and notifying the distributors.
          </div>
        </div>
      )}

      {step === "done" && (
        <>
          <div className="flex flex-col items-center text-center gap-1.5 px-7 pt-10 pb-6">
            <span className="w-14 h-14 rounded-full inline-flex items-center justify-center bg-st-done-bg text-st-done mb-2 animate-rise">
              <Check size={28} strokeWidth={2.6} />
            </span>
            <div className="text-[19px] font-medium text-ink">
              {pos.length} purchase order{pos.length === 1 ? "" : "s"} sent
            </div>
            <div className="text-[13.5px] text-muted max-w-[42ch] leading-relaxed">
              Patty emailed the awarded distributors and is tracking confirmations.
            </div>
          </div>
          <div className="px-[22px] pb-1">
            <div className="flex flex-col gap-2">
              {pos.map((p) => (
                <div
                  key={p.po}
                  className="flex items-center gap-3 px-3.5 py-3 bg-surface-2 border border-border rounded-md"
                >
                  <span className="w-[26px] h-[26px] rounded-full shrink-0 inline-flex items-center justify-center bg-st-done-bg text-st-done border border-st-done/30">
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                  <div className="flex-1">
                    <div className="text-[14px] font-medium text-ink">{p.distributorName}</div>
                    <div className="text-[12px] text-muted mt-px font-mono">{p.po}</div>
                  </div>
                  <span className="font-mono text-[14.5px] font-medium text-forest">
                    {money(p.weeklyValue)}
                    <span className="text-faint text-[11px]">/wk</span>
                  </span>
                </div>
              ))}
              {(held > 0 || manual > 0 || dropped > 0) && (
                <div className="flex gap-2.5 items-start mt-3.5 px-[15px] py-[13px] rounded-md text-[13px] leading-relaxed text-ink-2 bg-st-warn-bg/50 border border-st-warn/30">
                  <Clock size={14} className="text-st-warn shrink-0 mt-px" />
                  <span>
                    {held > 0 && (
                      <>
                        <b className="text-ink font-medium">{held} held</b> for reply.{" "}
                      </>
                    )}
                    {manual > 0 && (
                      <>
                        <b className="text-ink font-medium">{manual} assigned</b> to a buyer.{" "}
                      </>
                    )}
                    {dropped > 0 && (
                      <>
                        <b className="text-ink font-medium">{dropped} dropped</b> from this week.{" "}
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
          <ModalFoot>
            <span className="text-[12.5px] text-muted">Recommendation approved · saved to DB</span>
            <Button variant="primary" size="sm" onClick={onClose}>
              <Check size={14} /> Done
            </Button>
          </ModalFoot>
        </>
      )}
    </Modal>
  );
}

const Label = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center gap-[7px] text-[11.5px] font-semibold tracking-[0.05em] uppercase text-muted mb-2.5",
      className,
    )}
  >
    {children}
  </div>
);
