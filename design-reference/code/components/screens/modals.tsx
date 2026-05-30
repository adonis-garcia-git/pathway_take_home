"use client";
// components/screens/modals.tsx — ApproveModal + BasketModal
import React, { useEffect, useState } from "react";
import { Award, Sprout, Check, Send, Flag, Clock, LoaderCircle, Minus, Plus } from "lucide-react";
import { cn, Modal, ModalHead, ModalFoot, Button, Patty, CAT_DOT } from "@/components/ui";
import { RECOMMENDATION, RESTAURANT, INGREDIENTS, distributorById as dist } from "@/lib/data";

const money = (n: number) => "$" + Math.round(n).toLocaleString();

/* ───────────── ApproveModal: review → sending → done ───────────── */
const DECISIONS = [
  { v: "hold", label: "Hold for reply", note: "Patty retries Costiera and notifies you." },
  { v: "manual", label: "Source manually", note: "Assign to a buyer to handle off-platform." },
  { v: "drop", label: "Drop this week", note: "Remove the line from this week’s order." },
];

export function ApproveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rec = RECOMMENDATION;
  const [step, setStep] = useState<"review" | "sending" | "done">("review");
  const [decisions, setDecisions] = useState<string[]>(rec.gaps.map(() => "hold"));
  const [ack, setAck] = useState(false);

  useEffect(() => { if (open) { setStep("review"); setDecisions(rec.gaps.map(() => "hold")); setAck(false); } }, [open]);

  const total = rec.splits.reduce((a, s) => a + s.value, 0);
  const pos = rec.splits.map((s, i) => ({ ...s, po: "PO-44" + (71 + i), ds: dist(s.id)!, terms: s.id === "hudson" ? "COD" : "Net-30" }));
  const held = decisions.filter((d) => d === "hold").length;
  const manual = decisions.filter((d) => d === "manual").length;
  const dropped = decisions.filter((d) => d === "drop").length;
  const send = () => { setStep("sending"); setTimeout(() => setStep("done"), 1200); };

  return (
    <Modal open={open} onClose={onClose} dismissable={step !== "sending"} label="Review and approve award">
      {step === "review" && (
        <>
          <ModalHead Icon={Award} kicker={`Approve award · ${RESTAURANT.name}`} title="Review & approve award" onClose={onClose} />
          <div className="px-[22px] py-5 overflow-y-auto">
            <Label>Purchase orders to send</Label>
            <div className="flex flex-col gap-2">
              {pos.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-3.5 py-3 bg-surface-2 border border-border rounded-md">
                  <span className="w-[26px] h-[26px] rounded-full shrink-0 inline-flex items-center justify-center bg-mint text-forest border border-forest/20"><Check size={14} strokeWidth={2.4} /></span>
                  <div className="flex-1"><div className="text-[14px] font-medium text-ink">{p.ds.name}</div><div className="text-[12px] text-muted mt-px">{p.role}</div></div>
                  <div className="flex flex-col items-end gap-0.5"><span className="font-mono text-[14.5px] font-medium text-forest">{money(p.value)}<span className="text-faint text-[11px]">/wk</span></span><span className="font-mono text-[11px] text-muted">{p.terms}</span></div>
                </div>
              ))}
              <div className="flex items-center justify-between px-3.5 pt-1.5 text-[13px] text-ink-2"><span>Total committed weekly</span><span className="font-mono text-[16px] font-medium text-ink">{money(total)}</span></div>
            </div>

            <Label className="mt-5"><Flag size={13} className="text-st-warn" /> Decide on {rec.gaps.length} unquoted lines</Label>
            <div className="flex flex-col gap-3">
              {rec.gaps.map((g, i) => (
                <div key={g.item} className="p-3.5 border border-dashed border-st-warn/40 rounded-md bg-st-warn-bg/35">
                  <div className="mb-2.5"><div className="text-[13.5px] font-medium text-ink">{g.item}</div><div className="text-[12px] text-muted mt-px leading-snug">{g.reason}</div></div>
                  <div className="flex gap-[3px] p-[3px] bg-surface border border-border rounded-sm">
                    {DECISIONS.map((o) => (
                      <button key={o.v} onClick={() => setDecisions((d) => d.map((x, j) => (j === i ? o.v : x)))}
                        className={cn("flex-1 text-[12px] font-medium rounded-[7px] px-1.5 py-[7px] whitespace-nowrap transition", decisions[i] === o.v ? "bg-forest text-white shadow-sh1" : "text-muted hover:text-ink")}>{o.label}</button>
                    ))}
                  </div>
                  <div className="text-[11.5px] text-muted mt-2 pl-0.5">{DECISIONS.find((o) => o.v === decisions[i])!.note}</div>
                </div>
              ))}
            </div>

            <label className="flex items-start gap-2.5 mt-[18px] p-3.5 border border-border rounded-md cursor-pointer select-none">
              <input type="checkbox" className="sr-only" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span className={cn("w-5 h-5 shrink-0 rounded-[6px] border-[1.5px] inline-flex items-center justify-center mt-px transition", ack ? "bg-forest border-forest text-white" : "border-border-strong bg-surface text-transparent")}><Check size={13} strokeWidth={3} /></span>
              <span className="text-[13px] leading-relaxed text-ink-2">I authorize Patty to send these purchase orders on behalf of {RESTAURANT.name}.</span>
            </label>
          </div>
          <ModalFoot>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><Patty size={14} /> Patty will keep watching for the held replies.</span>
            <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" disabled={!ack} onClick={send}><Send size={14} /> Approve &amp; send {pos.length} POs</Button></div>
          </ModalFoot>
        </>
      )}

      {step === "sending" && (
        <div className="flex flex-col items-center text-center gap-1.5 px-7 pt-10 pb-7">
          <span className="text-st-running mb-1.5"><LoaderCircle size={26} className="animate-[spin_0.9s_linear_infinite]" /></span>
          <div className="text-[19px] font-medium text-ink">Sending purchase orders…</div>
          <div className="text-[13.5px] text-muted max-w-[42ch] leading-relaxed">Notifying {pos.map((p) => p.ds.name.split(" ")[0]).join(" & ")} and logging the held lines.</div>
        </div>
      )}

      {step === "done" && (
        <>
          <div className="flex flex-col items-center text-center gap-1.5 px-7 pt-10 pb-6">
            <span className="w-14 h-14 rounded-full inline-flex items-center justify-center bg-st-done-bg text-st-done mb-2 animate-rise"><Check size={28} strokeWidth={2.6} /></span>
            <div className="text-[19px] font-medium text-ink">{pos.length} purchase orders sent</div>
            <div className="text-[13.5px] text-muted max-w-[42ch] leading-relaxed">Patty emailed the awarded distributors and started tracking confirmations.</div>
          </div>
          <div className="px-[22px] pb-1">
            <div className="flex flex-col gap-2">
              {pos.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-3.5 py-3 bg-surface-2 border border-border rounded-md">
                  <span className="w-[26px] h-[26px] rounded-full shrink-0 inline-flex items-center justify-center bg-st-done-bg text-st-done border border-st-done/30"><Check size={14} strokeWidth={2.4} /></span>
                  <div className="flex-1"><div className="text-[14px] font-medium text-ink">{p.ds.name}</div><div className="text-[12px] text-muted mt-px font-mono">{p.po} · sent {p.ds.contact}</div></div>
                  <span className="font-mono text-[14.5px] font-medium text-forest">{money(p.value)}<span className="text-faint text-[11px]">/wk</span></span>
                </div>
              ))}
              <div className="flex gap-2.5 items-start mt-3.5 px-[15px] py-[13px] rounded-md text-[13px] leading-relaxed text-ink-2 bg-st-warn-bg/50 border border-st-warn/30">
                <Clock size={14} className="text-st-warn shrink-0 mt-px" />
                <span>{held > 0 && <><b className="text-ink font-medium">{held} line{held > 1 ? "s" : ""} held</b> for Costiera — Patty will retry and alert you on reply. </>}{manual > 0 && <><b className="text-ink font-medium">{manual} assigned</b> to a buyer. </>}{dropped > 0 && <><b className="text-ink font-medium">{dropped} dropped</b> from this week. </>}</span>
              </div>
            </div>
          </div>
          <ModalFoot><span className="text-[12.5px] text-muted">Award reference · <span className="font-mono">RFP-2418</span></span><Button variant="primary" size="sm" onClick={onClose}><Check size={14} /> Done</Button></ModalFoot>
        </>
      )}
    </Modal>
  );
}

/* ───────────── BasketModal: edit ingredient basket ───────────── */
export function BasketModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (s: { changes: number; removed: number }) => void }) {
  const mk = () => INGREDIENTS.map((i) => ({ id: i.id, name: i.name, cat: i.cat, qty: i.qty, unit: i.unit, on: true }));
  const [lines, setLines] = useState(mk);
  useEffect(() => { if (open) setLines(mk()); }, [open]);

  const setLine = (id: string, patch: Partial<typeof lines[number]>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const stepBy = (u: string) => (u === "doz" || u === "gal" ? 1 : 5);
  const removed = lines.filter((l) => !l.on).length;
  const requantified = lines.filter((l, i) => l.on && l.qty !== INGREDIENTS[i].qty).length;
  const changes = removed + requantified;
  const active = lines.filter((l) => l.on).length;

  return (
    <Modal open={open} onClose={onClose} label="Adjust basket">
      <ModalHead Icon={Sprout} kicker={`Adjust basket · ${RESTAURANT.name}`} title="Edit the ingredient basket" onClose={onClose} iconClass="bg-mint text-forest" />
      <div className="px-[22px] py-5 overflow-y-auto">
        <p className="text-[12.5px] text-muted leading-relaxed mb-3.5">Toggle lines in or out and tune weekly quantities. Patty re-prices and re-sends only the affected RFPs.</p>
        <div className="flex flex-col gap-0.5">
          {lines.map((l) => (
            <div key={l.id} className={cn("flex items-center gap-2.5 px-2.5 py-[9px] rounded-sm transition hover:bg-surface-2", !l.on && "opacity-50")}>
              <button onClick={() => setLine(l.id, { on: !l.on })} aria-label={l.on ? "Remove" : "Add"}
                className={cn("w-[22px] h-[22px] shrink-0 rounded-[6px] border-[1.5px] inline-flex items-center justify-center transition", l.on ? "bg-forest border-forest text-white" : "border-border-strong bg-surface text-muted")}>
                {l.on ? <Check size={13} strokeWidth={3} /> : <span className="text-[13px] leading-none">+</span>}
              </button>
              <span className={cn("w-[7px] h-[7px] rounded-full shrink-0", CAT_DOT[l.cat].dot)} />
              <span className="flex-1 text-[13.5px] text-ink min-w-0">{l.name}</span>
              <div className={cn("inline-flex items-center gap-0.5 bg-surface-2 border border-border rounded-sm p-0.5", !l.on && "opacity-40 pointer-events-none")}>
                <button onClick={() => setLine(l.id, { qty: Math.max(0, +(l.qty - stepBy(l.unit)).toFixed(2)) })} disabled={!l.on || l.qty <= 0} className="w-[26px] h-[26px] rounded-[6px] inline-flex items-center justify-center text-ink-2 hover:bg-surface-3 disabled:text-faint disabled:cursor-not-allowed"><Minus size={13} strokeWidth={2.6} /></button>
                <span className="min-w-[58px] text-center font-mono text-[13px] font-medium text-ink">{l.qty}<span className="text-faint font-normal text-[11.5px]"> {l.unit}</span></span>
                <button onClick={() => setLine(l.id, { qty: +(l.qty + stepBy(l.unit)).toFixed(2) })} disabled={!l.on} className="w-[26px] h-[26px] rounded-[6px] inline-flex items-center justify-center text-ink-2 hover:bg-surface-3 disabled:text-faint disabled:cursor-not-allowed"><Plus size={13} strokeWidth={2.6} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <ModalFoot>
        <span className="font-mono text-[12.5px] text-muted">{active} lines · {changes === 0 ? "no changes" : `${changes} change${changes > 1 ? "s" : ""}`}</span>
        <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" disabled={changes === 0} onClick={() => { onApply({ changes, removed }); onClose(); }}><Check size={14} /> Apply &amp; re-price</Button></div>
      </ModalFoot>
    </Modal>
  );
}

const Label = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <div className={cn("flex items-center gap-[7px] text-[11.5px] font-semibold tracking-[0.05em] uppercase text-muted mb-2.5", className)}>{children}</div>;
