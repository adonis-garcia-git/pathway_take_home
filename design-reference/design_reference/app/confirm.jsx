/* ============================================================
   confirm.jsx — "Review & approve award" confirmation flow
   review → sending → confirmed. Handles the gap decisions
   (the lines flagged "needs human approval").
   ============================================================ */

const DECISION_OPTS = [
  { v: "hold", label: "Hold for reply", note: "Patty retries Costiera and notifies you." },
  { v: "manual", label: "Source manually", note: "Assign to a buyer to handle off-platform." },
  { v: "drop", label: "Drop this week", note: "Remove the line from this week’s order." },
];

function ApproveModal({ open, onClose }) {
  const rec = RFP_DATA.recommendation;
  const dst = (id) => RFP_DATA.distributors.find((d) => d.id === id);
  const fmt = (n) => "$" + Number(n).toLocaleString();
  const [step, setStep] = React.useState("review");
  const [decisions, setDecisions] = React.useState(() => rec.gaps.map(() => "hold"));
  const [ack, setAck] = React.useState(false);

  React.useEffect(() => {
    if (open) { setStep("review"); setDecisions(rec.gaps.map(() => "hold")); setAck(false); }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape" && step !== "sending") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, step]);

  if (!open) return null;

  const total = rec.splits.reduce((a, s) => a + s.value, 0);
  const send = () => { setStep("sending"); setTimeout(() => setStep("done"), 1200); };
  const pos = rec.splits.map((s, i) => ({ ...s, po: "PO-44" + (71 + i), ds: dst(s.id), terms: dst(s.id).id === "hudson" ? "COD" : "Net-30" }));
  const heldCount = decisions.filter((d) => d === "hold").length;
  const manualCount = decisions.filter((d) => d === "manual").length;
  const droppedCount = decisions.filter((d) => d === "drop").length;

  return ReactDOM.createPortal((
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && step !== "sending") onClose(); }}>
      <div className="modal rise" role="dialog" aria-modal="true" aria-label="Review and approve award">

        {step === "review" && (
          <React.Fragment>
            <div className="modal-head">
              <div className="row gap-12">
                <span className="modal-ic"><Icon name="award" size={18} /></span>
                <div>
                  <div className="modal-kicker">Approve award · {RFP_DATA.restaurant.name}</div>
                  <h3 className="modal-title serif">Review &amp; approve award</h3>
                </div>
              </div>
              <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
            </div>

            <div className="modal-body">
              {/* awarded */}
              <div className="mblock-label">Purchase orders to send</div>
              <div className="po-list">
                {pos.map((p) => (
                  <div key={p.id} className="po-row">
                    <span className="po-pin"><Icon name="check" size={14} stroke={2.4} /></span>
                    <div className="grow">
                      <div className="po-name">{p.ds.name}</div>
                      <div className="po-role">{p.role}</div>
                    </div>
                    <div className="po-amt">
                      <span className="mono po-val">{fmt(p.value)}<span className="faint">/wk</span></span>
                      <span className="po-terms mono">{p.terms}</span>
                    </div>
                  </div>
                ))}
                <div className="po-total">
                  <span>Total committed weekly</span>
                  <span className="mono po-total-val">{fmt(total)}</span>
                </div>
              </div>

              {/* gap decisions */}
              <div className="mblock-label" style={{ marginTop: 20 }}>
                <Icon name="flag" size={13} style={{ color: "var(--st-warn)" }} /> Decide on {rec.gaps.length} unquoted lines
              </div>
              <div className="gap-decisions">
                {rec.gaps.map((g, i) => (
                  <div key={g.item} className="gd-row">
                    <div className="gd-info">
                      <div className="gd-item">{g.item}</div>
                      <div className="gd-reason">{g.reason}</div>
                    </div>
                    <div className="gd-seg">
                      {DECISION_OPTS.map((o) => (
                        <button key={o.v} className="gd-opt" data-active={decisions[i] === o.v ? "1" : undefined}
                          onClick={() => setDecisions((d) => d.map((x, j) => (j === i ? o.v : x)))}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <div className="gd-note">{DECISION_OPTS.find((o) => o.v === decisions[i]).note}</div>
                  </div>
                ))}
              </div>

              {/* ack */}
              <label className="ack-row">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span className="ack-box"><Icon name="check" size={13} stroke={3} /></span>
                <span className="ack-text">I authorize Patty to send these purchase orders on behalf of {RFP_DATA.restaurant.name}.</span>
              </label>
            </div>

            <div className="modal-foot">
              <span className="help row gap-6"><Patty size={14} /> Patty will keep watching for the held replies.</span>
              <div className="row gap-8">
                <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={!ack} onClick={send}>
                  <Icon name="send" size={14} /> Approve &amp; send {pos.length} POs
                </button>
              </div>
            </div>
          </React.Fragment>
        )}

        {step === "sending" && (
          <div className="modal-status">
            <span className="ms-spinner"><Icon name="spinner" size={26} style={{ animation: "spin 0.9s linear infinite" }} /></span>
            <div className="ms-title">Sending purchase orders…</div>
            <div className="ms-sub">Notifying {pos.map((p) => p.ds.name.split(" ")[0]).join(" & ")} and logging the held lines.</div>
          </div>
        )}

        {step === "done" && (
          <React.Fragment>
            <div className="modal-status">
              <span className="ms-check"><Icon name="check" size={28} stroke={2.6} /></span>
              <div className="ms-title">{pos.length} purchase orders sent</div>
              <div className="ms-sub">Patty emailed the awarded distributors and started tracking confirmations.</div>
            </div>
            <div className="modal-body" style={{ paddingTop: 0 }}>
              <div className="po-list">
                {pos.map((p) => (
                  <div key={p.id} className="po-row done">
                    <span className="po-pin done"><Icon name="check" size={14} stroke={2.4} /></span>
                    <div className="grow">
                      <div className="po-name">{p.ds.name}</div>
                      <div className="po-role mono">{p.po} · sent {p.ds.contact}</div>
                    </div>
                    <span className="mono po-val">{fmt(p.value)}<span className="faint">/wk</span></span>
                  </div>
                ))}
              </div>
              <div className="held-note">
                <Icon name="clock" size={14} style={{ color: "var(--st-warn)" }} />
                <span>
                  {heldCount > 0 && <><b>{heldCount} line{heldCount > 1 ? "s" : ""} held</b> for Costiera — Patty will retry and alert you on reply. </>}
                  {manualCount > 0 && <><b>{manualCount} assigned</b> to a buyer. </>}
                  {droppedCount > 0 && <><b>{droppedCount} dropped</b> from this week. </>}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <span className="help">Award reference · <span className="mono">RFP-2418</span></span>
              <button className="btn btn-primary btn-sm" onClick={onClose}><Icon name="check" size={14} /> Done</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  ), document.body);
}

window.ApproveModal = ApproveModal;

/* ============================================================
   BasketModal — edit the ingredient basket ("Adjust basket")
   ============================================================ */
function BasketModal({ open, onClose, onApply }) {
  const orig = RFP_DATA.ingredients;
  const mk = () => orig.map((i) => ({ id: i.id, name: i.name, cat: i.cat, qty: i.qty, unit: i.unit, on: true }));
  const [lines, setLines] = React.useState(mk);

  React.useEffect(() => { if (open) setLines(mk()); }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (!open) return null;

  const setLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const step = (l, d) => setLine(l.id, { qty: Math.max(0, +(l.qty + d).toFixed(2)) });
  const removed = lines.filter((l) => !l.on).length;
  const requantified = lines.filter((l, i) => l.on && l.qty !== orig[i].qty).length;
  const changes = removed + requantified;
  const activeLines = lines.filter((l) => l.on).length;

  const apply = () => { onApply({ changes, removed, requantified, activeLines }); onClose(); };

  return ReactDOM.createPortal((
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal rise" role="dialog" aria-modal="true" aria-label="Adjust basket">
        <div className="modal-head">
          <div className="row gap-12">
            <span className="modal-ic" style={{ background: "var(--mint)", color: "var(--forest)" }}><Icon name="ingredients" size={18} /></span>
            <div>
              <div className="modal-kicker">Adjust basket · {RFP_DATA.restaurant.name}</div>
              <h3 className="modal-title serif">Edit the ingredient basket</h3>
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="basket-hint help">Toggle lines in or out and tune weekly quantities. Patty re-prices and re-sends only the affected RFPs.</div>
          <div className="basket-list">
            {lines.map((l) => (
              <div key={l.id} className="basket-line" data-off={l.on ? undefined : "1"}>
                <button className="bl-toggle" data-on={l.on ? "1" : undefined} onClick={() => setLine(l.id, { on: !l.on })}
                  aria-label={l.on ? "Remove line" : "Add line"} title={l.on ? "Remove from basket" : "Add to basket"}>
                  {l.on ? <Icon name="check" size={13} stroke={3} /> : <Icon name="x" size={13} stroke={2.5} />}
                </button>
                <span className="cat-dot" style={{ background: (CAT_META[l.cat] || {}).c || "var(--muted)" }} />
                <span className="bl-name">{l.name}</span>
                <div className="bl-stepper" data-off={l.on ? undefined : "1"}>
                  <button onClick={() => step(l, l.unit === "doz" ? -1 : l.unit === "gal" ? -1 : -5)} disabled={!l.on || l.qty <= 0} aria-label="Decrease"><Icon name="minus" size={13} stroke={2.6} /></button>
                  <span className="bl-qty mono">{l.qty}<span className="bl-unit"> {l.unit}</span></span>
                  <button onClick={() => step(l, l.unit === "doz" ? 1 : l.unit === "gal" ? 1 : 5)} disabled={!l.on} aria-label="Increase"><Icon name="plus" size={13} stroke={2.6} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <span className="help mono">{activeLines} lines · {changes === 0 ? "no changes" : `${changes} change${changes > 1 ? "s" : ""}`}</span>
          <div className="row gap-8">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={changes === 0} onClick={apply}>
              <Icon name="check" size={14} /> Apply &amp; re-price
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

window.BasketModal = BasketModal;
