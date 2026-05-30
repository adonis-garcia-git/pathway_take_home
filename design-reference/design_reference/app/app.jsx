/* ============================================================
   app.jsx — root: state machine · topbar · tweaks · mobile
   ============================================================ */
const { useState: uS, useEffect: uE } = React;

const ACCENTS = {
  forest: { "--forest": "oklch(25% 0.08 152)", "--forest-hi": "oklch(31% 0.085 152)", "--forest-lo": "oklch(20% 0.07 152)" },
  pine:   { "--forest": "oklch(26% 0.066 178)", "--forest-hi": "oklch(32% 0.07 178)", "--forest-lo": "oklch(21% 0.058 178)" },
  olive:  { "--forest": "oklch(30% 0.062 128)", "--forest-hi": "oklch(36% 0.066 128)", "--forest-lo": "oklch(24% 0.054 128)" },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "pipelineLayout": "vertical",
  "badgeStyle": "filled",
  "speed": 1,
  "accent": "forest",
  "device": "desktop"
}/*EDITMODE-END*/;

/* ---------------- Topbar ---------------- */
function Topbar({ screen, onNewRun, device }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <PathwayLogo height={20} />
        {screen === "pipeline" && (
          <React.Fragment>
            <span className="topbar-divider" />
            <span className="run-chip">
              <Patty size={16} />
              <span className="col" style={{ gap: 1, lineHeight: 1.2 }}>
                <span className="rc-name">{RFP_DATA.restaurant.name}</span>
                <span className="rc-id mono">RFP-2418 · {RFP_DATA.restaurant.address.split(",")[1]?.trim()}</span>
              </span>
            </span>
          </React.Fragment>
        )}
      </div>
      <div className="topbar-right">
        {screen === "pipeline" && device === "desktop" && (
          <button className="btn btn-ghost btn-sm" onClick={onNewRun}><Icon name="refresh" size={14} /> New run</button>
        )}
        <span className="chip"><span className="map-dot" style={{ background: "var(--patty)", width: 8, height: 8 }} /> Demo · synthetic data</span>
      </div>
    </header>
  );
}

/* ---------------- Mobile screens ---------------- */
function MobileStart() {
  return (
    <div className="m-screen">
      <div className="m-pad">
        <div className="start-badge" style={{ marginBottom: 14 }}><Patty size={13} /> Patty · RFP</div>
        <h1 className="serif" style={{ fontSize: 27, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, margin: "0 0 10px" }}>Your menu, sourced automatically.</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>Give Patty a menu and an address. She prices the basket, finds distributors, and brings back a recommendation.</p>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className="seg-tab"><Icon name="link" size={14} />URL</button>
          <button className="seg-tab" data-active="1"><Icon name="text" size={14} />Text</button>
          <button className="seg-tab"><Icon name="upload" size={14} />Upload</button>
        </div>
        <div className="field" style={{ minHeight: 96, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.5 }}>
          TRATTORIA LUCIA — Menu<br />· Tagliatelle al Ragù…<br />· Cacio e Pepe…
        </div>
        <div className="url-field" style={{ marginTop: 12 }}><Icon name="pin" size={15} style={{ color: "var(--muted)" }} /><span className="url-input" style={{ fontSize: 13.5, color: "var(--ink-2)", padding: "11px 0" }}>214 Court St, Brooklyn</span></div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }}><Icon name="play" size={14} /> Run RFP Pipeline</button>
      </div>
    </div>
  );
}

function MobilePipeline() {
  // mid-run snapshot: 1-2 done, 3 running, 4-5 pending
  const snap = ["done", "done", "running", "pending", "pending"];
  return (
    <div className="m-screen">
      <div className="m-pad">
        <div className="row between" style={{ marginBottom: 4 }}>
          <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Live pipeline</h2>
          <span className="plh-count mono">2/5</span>
        </div>
        <div className="patty-line" style={{ marginBottom: 16 }}>
          <PattyAvatar size={24} live /><span className="pl-text" style={{ fontSize: 12.5 }}>Pricing the basket against <b>USDA</b> data…</span>
        </div>
        <div className="plh-bar" style={{ marginBottom: 18 }}><span style={{ width: "44%" }} /></div>
        <div className="vrail">
          {PSTAGES.map((s, i) => (
            <div key={s.key} className="vrail-item">
              <div className={"snode snode-v"} data-phase={snap[i]} data-active={i === 2 ? "1" : undefined}>
                <span className="snode-ic" data-phase={snap[i]}>
                  {snap[i] === "done" ? <Icon name="check" size={15} stroke={2.4} /> : <Icon name={s.icon} size={15} />}
                  {snap[i] === "running" && <span className="snode-pulse" />}
                </span>
                <span className="snode-body">
                  <span className="snode-title" style={{ fontSize: 13.5 }}>{s.title}</span>
                  <span className="snode-sum">{snap[i] === "done" ? s.done : snap[i] === "running" ? s.run : "Waiting"}</span>
                </span>
                <span style={{ marginLeft: "auto" }}><StatusBadge status={snap[i]} size="sm" dotOnly /></span>
              </div>
              {i < 4 && <span className="vconn" data-done={i < 2 ? "1" : undefined} data-active={i === 2 ? "1" : undefined}><span className="vconn-fill" /></span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileResult() {
  const rec = RFP_DATA.recommendation;
  return (
    <div className="m-screen">
      <div className="m-pad">
        <div className="row between" style={{ marginBottom: 16 }}>
          <h2 className="serif" style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Recommendation</h2>
          <StatusBadge status="done" size="sm" />
        </div>
        <div className="rec-card needs-approval" style={{ padding: 16, borderRadius: "var(--r-lg)" }}>
          <div className="rec-kicker" style={{ marginBottom: 8 }}>Patty recommends</div>
          <h3 className="rec-headline serif" style={{ fontSize: 18, marginBottom: 10 }}>Award the core basket to Lombardi</h3>
          <span className="approval-pill" style={{ fontSize: 11 }}><Icon name="flag" size={12} /> Needs human approval</span>
          <div className="rec-savings" style={{ marginTop: 14 }}>
            <span className="rs-label">Est. weekly saving</span>
            <span className="rs-val mono">${rec.estSavings}</span>
          </div>
        </div>
        <div className="rec-gaps" style={{ marginTop: 14 }}>
          <div className="gaps-title"><Icon name="flag" size={13} style={{ color: "var(--st-warn)" }} /> 2 lines need a decision</div>
          {rec.gaps.map((g) => (
            <div key={g.item} className="gap-row" style={{ flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
              <span className="gap-item" style={{ minWidth: 0 }}>{g.item}</span>
              <span className="gap-reason">{g.reason}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }}><Icon name="check" size={14} /> Review &amp; approve</button>
      </div>
    </div>
  );
}

function MobileGallery() {
  const frames = [
    { title: "Start", node: <MobileStart /> },
    { title: "Live pipeline · running", node: <MobilePipeline /> },
    { title: "Recommendation · needs approval", node: <MobileResult /> },
  ];
  return (
    <div className="m-gallery-wrap">
      <div className="m-gallery-head">
        <h2 className="plh-title serif" style={{ fontSize: 24 }}>Key mobile states</h2>
        <p className="help">Desktop-first, but the core flow holds up on a phone — start, watch, approve.</p>
      </div>
      <div className="m-gallery">
        {frames.map((f) => (
          <div key={f.title} className="m-frame">
            <IOSDevice width={372} height={760}>{f.node}</IOSDevice>
            <div className="m-frame-label">{f.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- App root ---------------- */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = uS(() => localStorage.getItem("rfp.screen") || "start");

  uE(() => { localStorage.setItem("rfp.screen", screen); }, [screen]);

  const run = () => setScreen("pipeline");
  const newRun = () => { localStorage.setItem("rfp.clock.v1", "0"); setScreen("start"); };

  const accentVars = ACCENTS[t.accent] || ACCENTS.forest;
  const mobile = t.device === "mobile";

  return (
    <BadgeStyleCtx.Provider value={t.badgeStyle}>
      <div className="app" style={accentVars}>
        <Topbar screen={screen} onNewRun={newRun} device={t.device} />
        <main className="page">
          {mobile ? (
            <MobileGallery />
          ) : screen === "start" ? (
            <StartScreen onRun={run} />
          ) : (
            <LivePipeline layout={t.pipelineLayout} speed={t.speed}
              setSpeed={(s) => setTweak("speed", s)} onRestart={newRun} />
          )}
        </main>

        <TweaksPanel>
          <TweakSection label="Pipeline" />
          <TweakRadio label="Layout" value={t.pipelineLayout}
            options={["horizontal", "vertical", "orbital"]}
            onChange={(v) => setTweak("pipelineLayout", v)} />
          <TweakRadio label="Play speed" value={String(t.speed)}
            options={["0.5", "1", "2"]}
            onChange={(v) => setTweak("speed", parseFloat(v))} />

          <TweakSection label="Status badges" />
          <TweakRadio label="Style" value={t.badgeStyle}
            options={["filled", "dots", "outline"]}
            onChange={(v) => setTweak("badgeStyle", v)} />

          <TweakSection label="Identity" />
          <TweakColor label="Primary accent" value={accentSwatch(t.accent)}
            options={[accentSwatch("forest"), accentSwatch("pine"), accentSwatch("olive")]}
            onChange={(hex) => setTweak("accent", accentName(hex))} />

          <TweakSection label="Preview" />
          <TweakRadio label="Device" value={t.device}
            options={["desktop", "mobile"]}
            onChange={(v) => setTweak("device", v)} />
          {!mobile && screen === "pipeline" && (
            <TweakButton label="Restart run" onClick={newRun} />
          )}
          {!mobile && screen === "start" && (
            <TweakButton label="Skip to live pipeline" onClick={run} />
          )}
        </TweaksPanel>
      </div>
    </BadgeStyleCtx.Provider>
  );
}

/* accent <-> swatch helpers (TweakColor wants hex values) */
const ACCENT_SWATCH = { forest: "#16432B", pine: "#0f4540", olive: "#2f4a1f" };
function accentSwatch(name) { return ACCENT_SWATCH[name] || ACCENT_SWATCH.forest; }
function accentName(hex) { return Object.keys(ACCENT_SWATCH).find((k) => ACCENT_SWATCH[k] === hex) || "forest"; }

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
