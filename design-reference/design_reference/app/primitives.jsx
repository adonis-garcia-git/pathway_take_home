/* ============================================================
   primitives.jsx — shared UI vocabulary
   Badge/status family · buttons · cards · icons · Patty · skeletons
   Exports to window at the bottom.
   ============================================================ */
const { useState, useEffect, useRef, createContext, useContext } = React;

/* ---------- Icons (simple stroke set; UI necessities) ---------- */
function Icon({ name, size = 16, stroke = 1.7, style, className }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round",
    style, className };
  const paths = {
    check: <polyline points="20 6 9 17 4 12" />,
    x: <g><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></g>,
    clock: <g><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></g>,
    alert: <g><path d="M12 3 2.5 20h19L12 3Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17.4" r="0.4" fill="currentColor"/></g>,
    spinner: <g><path d="M12 3a9 9 0 1 0 9 9" /></g>,
    mail: <g><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/></g>,
    send: <g><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></g>,
    pin: <g><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.4"/></g>,
    arrowUp: <g><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></g>,
    arrowDown: <g><line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></g>,
    minus: <line x1="5" y1="12" x2="19" y2="12"/>,
    plus: <g><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></g>,
    chevron: <polyline points="9 6 15 12 9 18"/>,
    chevronDown: <polyline points="6 9 12 15 18 9"/>,
    link: <g><path d="M9 15 15 9"/><path d="M11 6.5 12.8 4.7a4 4 0 0 1 5.6 5.6L16.6 12"/><path d="M13 17.5 11.2 19.3a4 4 0 0 1-5.6-5.6L7.4 12"/></g>,
    text: <g><line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="17" x2="13" y2="17"/></g>,
    upload: <g><path d="M12 16V5"/><polyline points="7.5 9.5 12 5 16.5 9.5"/><path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16"/></g>,
    file: <g><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><polyline points="14 3 14 8 19 8"/></g>,
    search: <g><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></g>,
    play: <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>,
    replay: <g><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/></g>,
    pause: <g><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></g>,
    dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>,
    ingredients: <g><path d="M4 19h16"/><path d="M6 19V9.5a6 6 0 0 1 12 0V19"/><line x1="12" y1="3.5" x2="12" y2="6"/></g>,
    tag: <g><path d="M3.5 11.5 11 4h6.5A2.5 2.5 0 0 1 20 6.5V13l-7.5 7.5a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1 0-2.8Z"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/></g>,
    truck: <g><path d="M2 6h11v9H2z"/><path d="M13 9h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/></g>,
    award: <g><circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5 7 22l5-2.6L17 22l-1.5-8.5"/></g>,
    phone: <path d="M5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 5.6 5.6l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5Z"/>,
    refresh: <g><path d="M21 12a9 9 0 1 1-2.6-6.3"/><polyline points="21 3 21 8 16 8"/></g>,
    flag: <g><path d="M5 21V4"/><path d="M5 4h11l-2 3.5L16 11H5"/></g>,
    sparkles: <g><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6Z" fill="currentColor" stroke="none"/></g>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

/* ---------- Patty sparkle mark (the brand asset) ---------- */
function Patty({ size = 22, style }) {
  return <img src="assets/patty.svg" width={size} height={size} alt="" aria-hidden="true"
    style={{ display: "block", ...style }} />;
}
function PathwayLogo({ height = 22, style }) {
  return <img src="assets/pathway-logo.png" alt="Pathway" style={{ height, width: "auto", display: "block", ...style }} />;
}

/* small Patty avatar chip used for agent status lines */
function PattyAvatar({ size = 26, live = false }) {
  return (
    <span className="patty-av" style={{ width: size, height: size }} data-live={live ? "1" : undefined}>
      <Patty size={size * 0.62} />
    </span>
  );
}

/* ---------- Badge style context (Tweak: filled | dots | outline) ---------- */
const BadgeStyleCtx = createContext("filled");

const STATUS_META = {
  pending:       { label: "Pending",      icon: "clock",   c: "--st-pending", bg: "--st-pending-bg" },
  running:       { label: "Running",      icon: "spinner", c: "--st-running", bg: "--st-running-bg", spin: true },
  done:          { label: "Done",         icon: "check",   c: "--st-done",    bg: "--st-done-bg" },
  error:         { label: "Error",        icon: "alert",   c: "--st-error",   bg: "--st-error-bg" },
  queued:        { label: "Queued",       icon: "clock",   c: "--st-pending", bg: "--st-pending-bg" },
  sent:          { label: "Sent",         icon: "send",    c: "--st-running", bg: "--st-running-bg" },
  replied:       { label: "Replied",      icon: "check",   c: "--st-done",    bg: "--st-done-bg" },
  "followed-up": { label: "Followed up",  icon: "refresh", c: "--st-warn",    bg: "--st-warn-bg" },
  failed:        { label: "Failed",       icon: "x",       c: "--st-error",   bg: "--st-error-bg" },
};
const PROV_META = {
  verified:  { label: "USDA verified", icon: "check", c: "--pv-verified", bg: "--pv-verified-bg" },
  estimated: { label: "Estimated",     icon: "sparkles", c: "--pv-estimated", bg: "--pv-estimated-bg" },
  nodata:    { label: "No data",       icon: "minus", c: "--pv-nodata", bg: "--pv-nodata-bg" },
};
const CONF_META = {
  high:   { label: "High confidence",   short: "High",   c: "--cf-high" },
  medium: { label: "Medium confidence", short: "Medium", c: "--cf-med" },
  low:    { label: "Low · needs review", short: "Low", c: "--cf-low" },
};

/* base badge honoring the style tweak */
function Badge({ icon, label, c, bg, spin = false, size = "md", title, dotOnly = false }) {
  const style = useContext(BadgeStyleCtx);
  const pad = size === "sm" ? "2px 7px 2px 6px" : "3px 9px 3px 7px";
  const fs = size === "sm" ? 11 : 12;
  const iconSz = size === "sm" ? 11 : 13;
  const color = `var(${c})`;

  if (style === "dots") {
    return (
      <span className="badge badge-dots" title={title || label} style={{ fontSize: fs }}>
        <span className="badge-dot" style={{ background: color }} data-spin={spin ? "1" : undefined} />
        {!dotOnly && <span className="badge-dots-label">{label}</span>}
      </span>
    );
  }
  const outline = style === "outline";
  return (
    <span className="badge" title={title || label}
      style={{
        padding: pad, fontSize: fs, color,
        background: outline ? "transparent" : `var(${bg})`,
        border: outline ? `1px solid color-mix(in oklch, ${color} 45%, transparent)` : "1px solid transparent",
      }}>
      <Icon name={icon} size={iconSz} stroke={2}
        style={spin ? { animation: "spin 0.9s linear infinite" } : undefined} />
      {!dotOnly && label}
    </span>
  );
}

function StatusBadge({ status, size, dotOnly }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return <Badge icon={m.icon} label={m.label} c={m.c} bg={m.bg} spin={m.spin} size={size} dotOnly={dotOnly} />;
}
function ProvenanceBadge({ prov, size }) {
  const m = PROV_META[prov] || PROV_META.nodata;
  return <Badge icon={m.icon} label={m.label} c={m.c} bg={m.bg} size={size} />;
}
function ConfidenceBadge({ level, size, full = false }) {
  const m = CONF_META[level] || CONF_META.low;
  const style = useContext(BadgeStyleCtx);
  // confidence reads best as a 3-pip meter + label regardless of tweak
  const pips = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="badge conf-badge" title={m.label}
      style={{ fontSize: size === "sm" ? 11 : 12, color: `var(${m.c})`,
        background: style === "outline" ? "transparent" : "transparent",
        border: style === "outline" ? `1px solid color-mix(in oklch, var(${m.c}) 40%, transparent)` : "1px solid var(--border)",
        padding: size === "sm" ? "2px 8px 2px 7px" : "3px 10px 3px 8px" }}>
      <span className="conf-pips" aria-hidden="true">
        {[0,1,2].map(i => <span key={i} className="conf-pip" style={{ background: i < pips ? `var(${m.c})` : "color-mix(in oklch, var(--muted) 22%, transparent)" }} />)}
      </span>
      {full ? m.label : m.short}
    </span>
  );
}

/* category tag (produce / dairy / meat / drygoods) */
const CAT_META = {
  produce:  { label: "Produce",   c: "#3f9e6a" },
  dairy:    { label: "Dairy",     c: "#C0820B" },
  meat:     { label: "Meat",      c: "#B5524A" },
  seafood:  { label: "Seafood",   c: "#2E8FD6" },
  drygoods: { label: "Dry goods", c: "#8A6FB0" },
};
function CatTag({ cat }) {
  const m = CAT_META[cat] || { label: cat, c: "var(--muted)" };
  return (
    <span className="cat-tag" style={{ "--cc": m.c }}>
      <span className="cat-dot" style={{ background: m.c }} />{m.label}
    </span>
  );
}

/* ---------- Trend indicator ---------- */
function Trend({ pct }) {
  if (pct === null || pct === undefined) return <span className="faint mono" style={{ fontSize: 12 }}>—</span>;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const color = flat ? "var(--trend-flat)" : up ? "var(--trend-up)" : "var(--trend-down)";
  return (
    <span className="mono" style={{ color, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 500 }}>
      <Icon name={flat ? "minus" : up ? "arrowUp" : "arrowDown"} size={12} stroke={2.4} />
      {flat ? "0.0" : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/* ---------- Skeleton helpers ---------- */
function Sk({ w = "100%", h = 12, r, style }) {
  return <span className="sk" style={{ display: "block", width: w, height: h, borderRadius: r || "var(--r-sm)", ...style }} />;
}

/* ---------- Count-up number (settles in) ---------- */
function CountUp({ value, prefix = "", suffix = "", decimals = 0, dur = 700, className, run = true }) {
  const [v, setV] = useState(value);
  const raf = useRef();
  useEffect(() => {
    if (!run || document.hidden) { setV(value); return; }
    setV(0);
    const start = performance.now();
    const from = 0, to = value;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setV(from + (to - from) * e);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // safety net: if frames never run (tab hidden), still land on the final value
    const safety = setTimeout(() => setV(value), dur + 400);
    return () => { cancelAnimationFrame(raf.current); clearTimeout(safety); };
  }, [value, run, dur]);
  const num = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
  return <span className={className}>{prefix}{num}{suffix}</span>;
}

/* ---------- Section heading ---------- */
function PanelHead({ icon, kicker, title, sub, right }) {
  return (
    <div className="panel-head">
      <div className="row gap-12" style={{ alignItems: "flex-start" }}>
        {icon && <span className="panel-head-ic"><Icon name={icon} size={18} /></span>}
        <div>
          {kicker && <div className="kicker">{kicker}</div>}
          <h3 className="panel-title serif">{title}</h3>
          {sub && <p className="panel-sub">{sub}</p>}
        </div>
      </div>
      {right && <div className="row gap-8">{right}</div>}
    </div>
  );
}

/* ---------- Empty / Error state cards ---------- */
function EmptyState({ icon = "search", title, body, tone = "neutral", action }) {
  return (
    <div className={"state-card state-" + tone}>
      <span className="state-ic"><Icon name={icon} size={20} /></span>
      <div className="state-title">{title}</div>
      {body && <div className="state-body">{body}</div>}
      {action}
    </div>
  );
}

/* expose */
Object.assign(window, {
  Icon, Patty, PathwayLogo, PattyAvatar,
  BadgeStyleCtx, Badge, StatusBadge, ProvenanceBadge, ConfidenceBadge,
  CatTag, Trend, Sk, CountUp, PanelHead, EmptyState,
  STATUS_META, PROV_META, CONF_META, CAT_META,
});
