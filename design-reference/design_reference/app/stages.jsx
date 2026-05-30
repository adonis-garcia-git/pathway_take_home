/* ============================================================
   stages.jsx — the five stage output panels
   Each panel renders by phase: "pending" | "running" | "done".
   ============================================================ */

const D = window.RFP_DATA;
const byId = (arr, id) => arr.find((x) => x.id === id);
const dist = (id) => byId(D.distributors, id);
const ing = (id) => byId(D.ingredients, id);
const money = (n) => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/* ---------------------------------------------------------------
   1 · RECIPES & INGREDIENTS
   --------------------------------------------------------------- */
function RecipesPanel({ phase }) {
  if (phase === "pending")
    return <EmptyState icon="ingredients" title="Waiting to parse the menu"
      body="Patty will extract each dish and break it into an ingredient basket with estimated weekly quantities." />;

  if (phase === "running")
    return (
      <div className="rec-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card card-pad">
            <Sk w="42%" h={15} /><div style={{ height: 12 }} />
            <div className="row wrap gap-6">{[60, 88, 52, 74, 66].map((w, j) => <Sk key={j} w={w} h={22} r="999px" />)}</div>
          </div>
        ))}
      </div>
    );

  const lowConf = D.dishes.filter((d) => d.confidence === "low" || d.note);
  return (
    <div className="rise">
      <div className="basket-stats">
        <Stat n={<CountUp value={D.dishes.length} />} label="dishes parsed" />
        <Stat n={<CountUp value={D.ingredients.length} />} label="ingredient lines" />
        <Stat n={<CountUp value={D.ingredients.reduce((a, b) => a + (b.unit === "doz" ? 0 : b.qty), 0)} suffix=" lb" />} label="weekly volume" sub />
        <Stat n={<CountUp value={D.ingredients.filter((i) => i.confidence !== "high").length} />} label="need review" warn />
      </div>

      <div className="rec-grid" style={{ marginTop: 18 }}>
        {D.dishes.map((dsh) => (
          <div key={dsh.name} className="card card-pad dish-card">
            <div className="row between" style={{ alignItems: "flex-start", marginBottom: 11 }}>
              <div>
                <div className="dish-section">{dsh.section}</div>
                <div className="dish-name">{dsh.name}</div>
              </div>
              <ConfidenceBadge level={dsh.confidence} size="sm" />
            </div>
            <div className="row wrap gap-6">
              {dsh.ingredients.map((x) => <span key={x} className="ing-chip">{x}</span>)}
            </div>
            {dsh.note && (
              <div className="dish-note">
                <Icon name="flag" size={13} style={{ color: "var(--st-warn)" }} />
                {dsh.note}
              </div>
            )}
          </div>
        ))}
      </div>

      {lowConf.length > 0 && (
        <div className="review-strip">
          <Icon name="flag" size={15} style={{ color: "var(--st-warn)" }} />
          <span><b>{lowConf.length} items flagged for review.</b> Quantities for low-confidence dishes are estimated from short menu descriptions — confirm before ordering.</span>
        </div>
      )}
    </div>
  );
}
function Stat({ n, label, sub, warn }) {
  return (
    <div className="stat">
      <div className={"stat-n mono" + (warn ? " stat-warn" : "")}>{n}</div>
      <div className="stat-l">{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   2 · PRICING
   --------------------------------------------------------------- */
function PricingPanel({ phase }) {
  if (phase === "pending")
    return <EmptyState icon="tag" title="Pricing not started"
      body="Each ingredient will be priced against USDA market data where available, with estimates and gaps clearly labeled." />;

  if (phase === "running")
    return (
      <div className="card price-tbl" style={{ overflow: "hidden" }}>
        <div className="tbl-row tbl-head"><span>Ingredient</span><span>Qty</span><span>Price</span><span>Trend</span><span>Source</span></div>
        {D.pricing.rows.slice(0, 8).map((r, i) => (
          <div key={i} className="tbl-row"><Sk w="72%" h={13} /><Sk w="70%" h={13} /><Sk w="56px" h={13} /><Sk w="40px" h={13} /><Sk w="82%" h={13} /></div>
        ))}
      </div>
    );

  const priced = D.pricing.rows.filter((r) => r.price !== null);
  const noData = D.pricing.rows.filter((r) => r.price === null);
  const weekly = priced.reduce((a, r) => {
    const it = ing(r.id); return a + (it ? it.qty * r.price : 0);
  }, 0);

  return (
    <div className="rise">
      <div className="row between wrap gap-12" style={{ marginBottom: 14 }}>
        <div className="row gap-8 wrap">
          <span className="chip"><Icon name="check" size={13} style={{ color: "var(--pv-verified)" }} />{priced.length} priced</span>
          <span className="chip"><Icon name="sparkles" size={13} style={{ color: "var(--pv-estimated)" }} />{priced.filter(r=>r.prov==="estimated").length} estimated</span>
          <span className="chip"><Icon name="minus" size={13} style={{ color: "var(--pv-nodata)" }} />{noData.length} no data</span>
        </div>
        <div className="basket-est">
          <span className="be-label">Est. weekly basket <span className="faint">(priced items)</span></span>
          <span className="be-val mono"><CountUp value={weekly} prefix="$" /></span>
        </div>
      </div>

      <div className="card price-tbl" style={{ overflow: "hidden" }}>
        <div className="tbl-row tbl-head">
          <span>Ingredient</span><span>Qty</span><span>Unit price</span><span>Trend<span className="faint" style={{fontWeight:400}}> · vs last wk</span></span><span>Provenance</span>
        </div>
        {D.pricing.rows.map((r, i) => {
          const it = ing(r.id);
          const noData = r.price === null;
          return (
            <div key={r.id} className="tbl-row price-row" data-nodata={noData ? "1" : undefined} style={{ animationDelay: (i * 28) + "ms" }}>
              <span className="pr-name">{it?.name || r.id}{it?.flag && <span className="pr-flag" title={it.flag}><Icon name="flag" size={11} /></span>}</span>
              <span className="mono pr-qty">{it ? `${it.qty} ${it.unit}` : "—"}</span>
              <span className="mono pr-price">{noData ? <span className="faint">—</span> : <>${r.price.toFixed(2)}<span className="pr-unit">/{r.unit}</span></>}</span>
              <span><Trend pct={r.trend} /></span>
              <span className="pr-prov"><ProvenanceBadge prov={r.prov} size="sm" /><span className="pr-src">{r.src}</span></span>
            </div>
          );
        })}
      </div>

      {noData.length > 0 && (
        <div className="review-strip">
          <Icon name="minus" size={15} style={{ color: "var(--pv-nodata)" }} />
          <span><b>{noData.length} items have no public pricing.</b> Mozzarella di bufala and fresh tagliatelle aren’t in any commodity series — Patty will ask distributors to quote them directly rather than guess.</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   3 · DISTRIBUTORS  (+ stylized map)
   --------------------------------------------------------------- */
function DistributorsPanel({ phase }) {
  if (phase === "pending")
    return <EmptyState icon="pin" title="No distributors yet"
      body="Patty will search verified suppliers near the restaurant and match them to the ingredient basket by category." />;

  if (phase === "running")
    return (
      <div className="dist-layout">
        <div className="col gap-12">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card card-pad"><Sk w="50%" h={15} /><div style={{height:9}}/><Sk w="80%" h={12} /><div style={{height:12}}/><div className="row gap-6"><Sk w={64} h={20} r="999px"/><Sk w={54} h={20} r="999px"/></div></div>
          ))}
          <div className="widening"><Icon name="search" size={14} /> Widening search radius…</div>
        </div>
        <div className="card map-card"><div className="sk" style={{ position: "absolute", inset: 0, borderRadius: "var(--r-lg)" }} /></div>
      </div>
    );

  return (
    <div className="dist-layout rise">
      <div className="col gap-12">
        {D.distributors.map((ds) => (
          <div key={ds.id} className="card card-pad dist-card">
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div className="row gap-10" style={{ alignItems: "flex-start" }}>
                <span className="dist-pin"><Icon name="pin" size={15} /></span>
                <div>
                  <div className="dist-name">{ds.name}</div>
                  <div className="dist-meta mono">{ds.dist} away</div>
                </div>
              </div>
              <ProvenanceBadge prov={ds.prov} size="sm" />
            </div>
            <p className="dist-blurb">{ds.blurb}</p>
            <div className="row wrap gap-6" style={{ marginBottom: 11 }}>
              {ds.cats.map((c) => <CatTag key={c} cat={c} />)}
            </div>
            <div className="dist-contact">
              <span className="row gap-6"><Icon name="mail" size={13} style={{ color: "var(--muted)" }} /><span className="mono">{ds.contact}</span></span>
              <span className="row gap-6"><Icon name="phone" size={13} style={{ color: "var(--muted)" }} /><span className="mono">{ds.phone}</span></span>
            </div>
          </div>
        ))}
      </div>

      {/* stylized map */}
      <div className="card map-card">
        <div className="map-grid" />
        <div className="map-roads" />
        <div className="map-legend">
          <span className="row gap-6"><span className="map-dot you" />Restaurant</span>
          <span className="row gap-6"><span className="map-dot sup" />Distributor</span>
        </div>
        <div className="map-pin you" style={{ left: "50%", top: "54%" }} title={D.restaurant.name}>
          <span className="mp-ring" />
        </div>
        {D.distributors.map((ds) => (
          <div key={ds.id} className="map-pin sup" style={{ left: ds.lat + "%", top: ds.lng + "%" }} title={ds.name}>
            <Icon name="pin" size={13} />
            <span className="mp-label">{ds.name.split(" ")[0]}</span>
          </div>
        ))}
        <div className="map-attr mono">map · illustrative</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   4 · RFP EMAILS
   --------------------------------------------------------------- */
function RfpPanel({ phase }) {
  if (phase === "pending")
    return <EmptyState icon="send" title="No RFPs sent yet"
      body="Patty will email each distributor a request for quote with the relevant ingredient lines, quantities, and a reply deadline." />;

  if (phase === "running")
    return (
      <div className="rfp-layout">
        <div className="col gap-8">
          {D.emails.threads.map((t, i) => (
            <div key={i} className="card card-pad row between"><Sk w="46%" h={14} /><Sk w={64} h={22} r="999px" /></div>
          ))}
        </div>
        <div className="card card-pad email-preview"><Sk w="60%" h={14}/><div style={{height:10}}/><Sk w="90%" h={11}/><div style={{height:6}}/><Sk w="84%" h={11}/><div style={{height:6}}/><Sk w="70%" h={11}/></div>
      </div>
    );

  return <RfpDone />;
}

const RFP_EMAILS = {
  lombardi: { rfp: "LMB", subject: "RFQ · Weekly dairy, dry goods & produce — Trattoria Lucia",
    items: ["san-marzano","parm","pecorino","bufala","mascarpone","tagliatelle","spaghetti","evoo","tomatoes","soffritto","eggs"] },
  gotham: { rfp: "GTH", subject: "RFQ · Weekly produce — Trattoria Lucia",
    items: ["tomatoes","soffritto","basil","san-marzano"] },
  hudson: { rfp: "HDS", subject: "RFQ · Weekly meat incl. veal shank — Trattoria Lucia",
    items: ["ground-beef","ground-pork","veal-shank"] },
  costiera: { rfp: "CST", subject: "RFQ · DOP specialty imports — Trattoria Lucia",
    items: ["san-marzano","evoo","spaghetti","espresso"] },
};

function RfpDone() {
  const [sel, setSel] = React.useState("lombardi");
  const t = D.emails.threads.find((x) => x.id === sel);
  const ds = dist(sel);
  const cfg = RFP_EMAILS[sel];
  const greeting = ds.name.split(" ")[0];

  return (
    <div className="rfp-layout rise">
      <div className="col gap-8">
        <div className="rfp-deadline">
          <Icon name="clock" size={14} style={{ color: "var(--muted)" }} />
          Reply deadline · <b>{D.emails.deadline}</b>
        </div>
        {D.emails.threads.map((th) => {
          const d = dist(th.id);
          return (
            <button key={th.id} className="card card-pad thread-row" data-status={th.status}
              data-active={sel === th.id ? "1" : undefined} onClick={() => setSel(th.id)}>
              <div className="row between">
                <div className="row gap-10">
                  <span className="thread-pin" data-status={th.status}><Icon name="mail" size={14} /></span>
                  <div className="col" style={{ alignItems: "flex-start" }}>
                    <div className="thread-name">{d.name}</div>
                    <div className="thread-time mono">
                      sent {th.sentAt}{th.repliedAt ? ` · replied ${th.repliedAt}` : ""}{th.attempts > 1 ? ` · ${th.attempts} attempts` : ""}
                    </div>
                  </div>
                </div>
                <div className="row gap-8">
                  <StatusBadge status={th.status} size="sm" />
                  <Icon name="chevron" size={14} style={{ color: "var(--faint)" }} />
                </div>
              </div>
              {th.note && <div className={"thread-note" + (th.status === "failed" ? " err" : "")}>{th.note}</div>}
            </button>
          );
        })}
      </div>

      {/* actual RFP email preview — follows selected thread */}
      <div className="card email-card" key={sel}>
        {t.status === "failed" && (
          <div className="email-bounce">
            <Icon name="alert" size={14} /> <span><b>Delivery failed</b> — mailbox unavailable. Patty is trying {ds.phone}.</span>
          </div>
        )}
        <div className="email-head">
          <div className="email-row"><span className="eh-k">From</span><span className="eh-v mono">patty@trattorialucia.pathway.app</span></div>
          <div className="email-row"><span className="eh-k">To</span><span className="eh-v mono">{ds.contact}</span></div>
          <div className="email-row"><span className="eh-k">Subject</span><span className="eh-v"><b>{cfg.subject}</b></span></div>
        </div>
        <div className="email-body">
          <p>Hi {greeting} team,</p>
          <p>Trattoria Lucia (214 Court St) is requesting a quote for the following weekly items. Please reply with unit pricing, delivery days, and terms by <b>Fri May 30, 5:00 PM ET</b>.</p>
          <table className="email-tbl mono">
            <thead><tr><th>Item</th><th>Qty / wk</th></tr></thead>
            <tbody>
              {cfg.items.map((id) => {
                const it = ing(id); return <tr key={id}><td>{it.name}</td><td>{it.qty} {it.unit}</td></tr>;
              })}
            </tbody>
          </table>
          <p className="email-sign">Thank you,<br/>Patty · procurement, on behalf of Trattoria Lucia</p>
        </div>
        <div className="email-foot">
          <Patty size={14} />
          <span>{t.status === "replied" ? "Replied " + t.repliedAt : t.status === "followed-up" ? "Awaiting reply · followed up" : t.status === "failed" ? "Bounced · retrying by phone" : "Sent autonomously by Patty"} · <span className="mono">RFP-2418-{cfg.rfp}</span></span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   5 · QUOTES & RECOMMENDATION
   --------------------------------------------------------------- */
function QuotesPanel({ phase, run = true }) {
  const [approve, setApprove] = React.useState(false);
  const [adjustOpen, setAdjustOpen] = React.useState(false);
  const [adjusted, setAdjusted] = React.useState(null);
  if (phase === "pending")
    return <EmptyState icon="award" title="No quotes collected yet"
      body="As distributors reply, Patty normalizes their quotes into one comparison and recommends an award." />;

  if (phase === "running")
    return (
      <div>
        <EmptyState icon="clock" tone="running" title="Awaiting replies…"
          body="2 of 4 distributors have responded. Patty is normalizing line items and will recommend an award once quotes settle." />
        <div className="card price-tbl" style={{ marginTop: 16, overflow: "hidden" }}>
          {[0,1,2,3].map(i => <div key={i} className="tbl-row"><Sk w="60%" h={13}/><Sk w="70%" h={13}/><Sk w="56px" h={13}/><Sk w="60px" h={13}/><Sk w="50%" h={13}/></div>)}
        </div>
      </div>
    );

  const rec = D.recommendation;
  const quotes = D.quotes;
  const cols = quotes.filter((q) => q.total !== null);
  const noQuote = quotes.filter((q) => q.total === null);
  const rows = [
    { k: "Total / wk", get: (q) => q.total === null ? "—" : money(q.total), mono: true },
    { k: "Completeness", get: (q) => q, render: "complete" },
    { k: "Delivery", get: (q) => q.delivery || "—" },
    { k: "Terms", get: (q) => q.terms || "—", mono: true },
    { k: "Lead time", get: (q) => q.lead || "—", mono: true },
  ];

  return (
    <div className="rise quotes-wrap">
      {adjusted && (
        <div className="adjust-banner">
          <span className="row gap-8"><PattyAvatar size={24} live /> <span><b>Basket updated · {adjusted.changes} change{adjusted.changes > 1 ? "s" : ""}.</b> Patty is re-pricing the affected lines and will re-send {adjusted.removed > 0 ? "the remaining " : ""}RFPs — quotes refresh shortly.</span></span>
          <button className="banner-x" onClick={() => setAdjusted(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
        </div>
      )}
      {/* Recommendation */}
      <div className={"rec-card" + (rec.needsApproval ? " needs-approval" : "")}>
        <div className="rec-top">
          <div className="row gap-12" style={{ alignItems: "flex-start" }}>
            <span className="rec-award"><Icon name="award" size={20} /></span>
            <div>
              <div className="rec-kicker">
                Patty’s recommendation
                <ConfidenceBadge level={rec.confidence} size="sm" full />
              </div>
              <h3 className="rec-headline serif">{rec.headline}</h3>
            </div>
          </div>
          {rec.needsApproval && (
            <span className="approval-pill"><Icon name="flag" size={13} /> Needs human approval</span>
          )}
        </div>

        <p className="rec-rationale">{rec.rationale}</p>

        <div className="rec-splits">
          {rec.splits.map((s) => {
            const ds = dist(s.id);
            return (
              <div key={s.id} className="split">
                <div className="split-head">
                  <span className="split-name">{ds.name}</span>
                  <span className="split-val mono">{money(s.value)}<span className="faint">/wk</span></span>
                </div>
                <div className="split-role">{s.role}</div>
              </div>
            );
          })}
        </div>

        {/* gaps → needs approval detail */}
        {rec.gaps.length > 0 && (
          <div className="rec-gaps">
            <div className="gaps-title"><Icon name="flag" size={13} style={{ color: "var(--st-warn)" }} /> {rec.gaps.length} lines need a human decision</div>
            {rec.gaps.map((g) => (
              <div key={g.item} className="gap-row">
                <span className="gap-item">{g.item}</span>
                <span className="gap-reason">{g.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div className="rec-foot">
          <div className="rec-savings">
            <span className="rs-label">Est. weekly saving vs. baseline</span>
            <span className="rs-val mono"><CountUp value={rec.estSavings} prefix="$" run={run} /> <span className="rs-base faint">of {money(rec.estBaseline)}</span></span>
          </div>
          <div className="row gap-8">
            <button className="btn btn-ghost btn-sm" onClick={() => setAdjustOpen(true)}>Adjust basket</button>
            <button className="btn btn-primary btn-sm" onClick={() => setApprove(true)}><Icon name="check" size={14} /> Review &amp; approve award</button>
          </div>
        </div>
      </div>

      {/* Comparison table */}
      <div className="cmp-head">
        <h4 className="cmp-title">Quote comparison</h4>
        <span className="help">{cols.length} quotes · {noQuote.length} no response</span>
      </div>
      <div className="cmp-scroll">
        <div className="cmp-tbl" style={{ "--cols": quotes.length }}>
          <div className="cmp-corner" />
          {quotes.map((q) => {
            const ds = dist(q.id);
            const isRec = rec.splits.some((s) => s.id === q.id);
            const noQ = q.total === null;
            return (
              <div key={q.id} className={"cmp-col-head" + (isRec ? " rec" : "") + (noQ ? " noq" : "")}>
                {isRec && <span className="cmp-tag">Awarded</span>}
                <span className="cmp-dname">{ds.name}</span>
                <span className="cmp-dcat">{ds.cats.map(c=>CAT_META[c]?.label).join(" · ")}</span>
              </div>
            );
          })}
          {rows.map((row) => (
            <React.Fragment key={row.k}>
              <div className="cmp-rk">{row.k}</div>
              {quotes.map((q) => {
                const isRec = rec.splits.some((s) => s.id === q.id);
                const noQ = q.total === null;
                if (row.render === "complete") {
                  return (
                    <div key={q.id} className={"cmp-cell" + (isRec ? " rec" : "") + (noQ ? " noq" : "")}>
                      {noQ ? <span className="faint">—</span> : (
                        <div className="comp-meter">
                          <div className="comp-bar"><span style={{ width: q.complete + "%" }} /></div>
                          <span className="mono comp-pct">{q.itemsQuoted}/{q.itemsTotal}</span>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={q.id} className={"cmp-cell" + (isRec ? " rec" : "") + (noQ ? " noq" : "") + (row.mono ? " mono" : "")}>
                    {row.get(q)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {noQuote.length > 0 && (
        <div className="review-strip">
          <Icon name="x" size={15} style={{ color: "var(--st-error)" }} />
          <span><b>{noQuote.map(q=>dist(q.id).name).join(", ")} did not quote.</b> The RFP email hard-bounced — Patty held the specialty-import lines out of the award rather than guess a price.</span>
        </div>
      )}
      <ApproveModal open={approve} onClose={() => setApprove(false)} />
      <BasketModal open={adjustOpen} onClose={() => setAdjustOpen(false)} onApply={(s) => setAdjusted(s)} />
    </div>
  );
}

window.PANELS = {
  parse: RecipesPanel,
  pricing: PricingPanel,
  distributors: DistributorsPanel,
  rfp: RfpPanel,
  quotes: QuotesPanel,
};
Object.assign(window, { RecipesPanel, PricingPanel, DistributorsPanel, RfpPanel, QuotesPanel });
