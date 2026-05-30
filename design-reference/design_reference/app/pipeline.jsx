/* ============================================================
   pipeline.jsx — LIVE PIPELINE (centerpiece)
   Timeline engine (auto-play + scrub) · 3 layout variants.
   ============================================================ */

const PSTAGES = [
  { key: "parse",        n: 1, title: "Parse Menu",       icon: "ingredients", start: 0.3,  end: 4.6,  run: "Reading the menu and extracting dishes", done: "6 dishes · 16 ingredient lines" },
  { key: "pricing",      n: 2, title: "Fetch Pricing",    icon: "tag",         start: 5.1,  end: 11.0, run: "Querying USDA market data + indices",   done: "14 priced · 2 no public data" },
  { key: "distributors", n: 3, title: "Find Distributors", icon: "pin",        start: 11.6, end: 16.2, run: "Searching verified suppliers nearby",    done: "4 distributors within 6 mi" },
  { key: "rfp",          n: 4, title: "Send RFPs",         icon: "send",        start: 16.8, end: 23.0, run: "Emailing distributors for quotes",       done: "4 sent · 2 replied · 1 bounced" },
  { key: "quotes",       n: 5, title: "Collect Quotes",    icon: "award",       start: 23.6, end: 30.0, run: "Normalizing and comparing quotes",       done: "3 quotes · recommendation ready" },
];
const PTOTAL = 30.0;

const phaseOf = (s, clock) => (clock >= s.end ? "done" : clock >= s.start ? "running" : "pending");
const fmtT = (s) => s.toFixed(1) + "s";

/* Patty narration per state */
function pattyLine(clock) {
  const running = PSTAGES.find((s) => phaseOf(s, clock) === "running");
  if (clock <= 0.001) return { live: false, text: <>Ready to run.</> };
  if (clock >= PTOTAL) return { live: false, text: <><b>Done.</b> I recommend awarding the core basket to Lombardi — 2 specialty lines need your call.</> };
  if (!running) return { live: true, text: <>Working…</> };
  const map = {
    parse: <>Reading the menu — I found <b>6 dishes</b> and I’m breaking them into ingredients.</>,
    pricing: <>Pricing the basket against <b>USDA</b> data. Two items have no public series — I’ll have distributors quote those.</>,
    distributors: <>Searching suppliers near <b>Carroll Gardens</b> and matching them by category.</>,
    rfp: <>Emailing <b>4 distributors</b> for quotes. One mailbox bounced — trying their phone.</>,
    quotes: <>Comparing replies and working out the best <b>award</b>.</>,
  };
  return { live: true, text: map[running.key] };
}

/* ---------- timeline engine hook ---------- */
function usePipelineClock(speed) {
  const KEY = "rfp.clock.v1";
  const [clock, setClock] = useState(() => {
    const v = parseFloat(localStorage.getItem(KEY));
    return isNaN(v) ? 0 : Math.min(v, PTOTAL);
  });
  const [playing, setPlaying] = useState(() => (parseFloat(localStorage.getItem(KEY)) || 0) < PTOTAL);
  const raf = useRef();
  const last = useRef();

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setClock((c) => {
        const next = c + dt * speed;
        if (next >= PTOTAL) { setPlaying(false); return PTOTAL; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);

  useEffect(() => { localStorage.setItem(KEY, String(clock)); }, [clock]);

  const play = () => { if (clock >= PTOTAL) setClock(0); setPlaying(true); };
  const pause = () => setPlaying(false);
  const replay = () => { setClock(0); setPlaying(true); };
  const scrub = (v) => { setPlaying(false); setClock(v); };
  return { clock, playing, play, pause, replay, scrub, setPlaying };
}

/* ---------- shared: controls bar ---------- */
function Controls({ engine, speed, setSpeed }) {
  const { clock, playing, play, pause, replay, scrub } = engine;
  const done = clock >= PTOTAL;
  return (
    <div className="pl-controls">
      <button className="pl-btn" onClick={done ? replay : playing ? pause : play}
        title={done ? "Replay" : playing ? "Pause" : "Play"}>
        <Icon name={done ? "replay" : playing ? "pause" : "play"} size={16} />
      </button>
      <button className="pl-btn ghost" onClick={replay} title="Restart"><Icon name="refresh" size={15} /></button>
      <div className="pl-scrub">
        <input type="range" min={0} max={PTOTAL} step={0.05} value={clock}
          onChange={(e) => scrub(parseFloat(e.target.value))}
          style={{ "--pct": (clock / PTOTAL * 100) + "%" }} />
      </div>
      <span className="pl-time mono">{clock.toFixed(1)}<span className="faint"> / {PTOTAL.toFixed(0)}s</span></span>
      <div className="pl-speed">
        {[0.5, 1, 2].map((s) => (
          <button key={s} className="sp-btn" data-active={speed === s ? "1" : undefined} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
      </div>
    </div>
  );
}

/* ---------- a single stage node ---------- */
function StageNode({ s, phase, active, onClick, layout }) {
  return (
    <button className={"snode snode-" + layout} data-phase={phase} data-active={active ? "1" : undefined}
      onClick={() => phase !== "pending" && onClick(s.key)} disabled={phase === "pending"}>
      <span className="snode-ic" data-phase={phase}>
        {phase === "done" ? <Icon name="check" size={16} stroke={2.4} />
          : phase === "running" ? <Icon name={s.icon} size={16} />
          : <Icon name={s.icon} size={16} />}
        {phase === "running" && <span className="snode-pulse" />}
      </span>
      <span className="snode-body">
        <span className="snode-kicker mono">Stage {s.n}</span>
        <span className="snode-title">{s.title}</span>
        <span className="snode-sum">{phase === "done" ? s.done : phase === "running" ? s.run : "Waiting"}</span>
      </span>
    </button>
  );
}

/* ---------- detail panel (header + the stage's output) ---------- */
function StageDetail({ s, phase, clock, run }) {
  const Panel = window.PANELS[s.key];
  const elapsed = phase === "done" ? (s.end - s.start) : phase === "running" ? Math.max(0, clock - s.start) : 0;
  return (
    <div className="card stage-detail">
      <div className="sd-head">
        <div className="row gap-12">
          <span className="sd-ic" data-phase={phase}><Icon name={s.icon} size={18} /></span>
          <div>
            <div className="sd-kicker mono">Stage {s.n} of 5</div>
            <h3 className="sd-title serif">{s.title}</h3>
          </div>
        </div>
        <div className="row gap-10">
          {phase !== "pending" && (
            <span className="sd-timer mono" data-phase={phase}>
              <Icon name="clock" size={12} /> {phase === "running" ? fmtT(elapsed) : fmtT(elapsed)}
            </span>
          )}
          <StatusBadge status={phase} />
        </div>
      </div>
      <div className="sd-body" key={s.key + "-" + phase}>
        <Panel phase={phase} run={run} />
      </div>
    </div>
  );
}

/* =================================================================
   LIVE PIPELINE
   ================================================================= */
function LivePipeline({ layout, speed, setSpeed, onRestart }) {
  const engine = usePipelineClock(speed);
  const { clock, playing } = engine;
  const [userSel, setUserSel] = useState(null);

  const phases = PSTAGES.map((s) => phaseOf(s, clock));
  const runningIdx = phases.indexOf("running");
  const lastNonPending = phases.reduce((acc, p, i) => (p !== "pending" ? i : acc), 0);
  const autoIdx = runningIdx >= 0 ? runningIdx : lastNonPending;

  // follow live unless the user pinned a (non-pending) stage
  let selIdx = autoIdx;
  if (userSel != null) {
    const i = PSTAGES.findIndex((s) => s.key === userSel);
    if (i >= 0 && phases[i] !== "pending") selIdx = i; else if (i >= 0 && phases[i] === "pending") selIdx = i;
  }
  const selStage = PSTAGES[selIdx];
  const selPhase = phases[selIdx];

  const onPick = (key) => {
    setUserSel(key);
  };
  const followLive = userSel == null;

  // auto-follow: when not pinned, selection tracks autoIdx (already does via selIdx)
  const completed = phases.filter((p) => p === "done").length;
  const overallPct = Math.min(100, (clock / PTOTAL) * 100);
  const narration = pattyLine(clock);

  const railProps = { phases, selIdx, onPick, layout };

  return (
    <div className={"pipeline pipeline-" + layout}>
      {/* header */}
      <div className="pl-header">
        <div className="plh-left">
          <div className="plh-title-row">
            <h2 className="plh-title serif">Live pipeline</h2>
            <span className="plh-count mono">{completed}/5 stages</span>
          </div>
          <div className="patty-line">
            <PattyAvatar size={28} live={narration.live} />
            <span className="pl-text">{narration.text}</span>
          </div>
        </div>
        <div className="plh-progress">
          <div className="plh-bar"><span style={{ width: overallPct + "%" }} /></div>
        </div>
      </div>

      {layout === "vertical" ? (
        <div className="pl-vert">
          <div className="pl-vrail">
            <VerticalRail {...railProps} clock={clock} />
            <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          </div>
          <StageDetail s={selStage} phase={selPhase} clock={clock} run={selPhase === "done"} />
        </div>
      ) : layout === "orbital" ? (
        <div className="pl-orbit-wrap">
          <OrbitalRail {...railProps} clock={clock} narration={narration} />
          <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          <StageDetail s={selStage} phase={selPhase} clock={clock} run={selPhase === "done"} />
        </div>
      ) : (
        <div className="pl-horiz">
          <HorizontalRail {...railProps} clock={clock} />
          <Controls engine={engine} speed={speed} setSpeed={setSpeed} />
          <StageDetail s={selStage} phase={selPhase} clock={clock} run={selPhase === "done"} />
        </div>
      )}
    </div>
  );
}

/* ---------- HORIZONTAL rail ---------- */
function HorizontalRail({ phases, selIdx, onPick, clock }) {
  return (
    <div className="hrail">
      {PSTAGES.map((s, i) => {
        const phase = phases[i];
        const connDone = clock >= s.end;
        const connActive = phase === "running";
        return (
          <React.Fragment key={s.key}>
            <StageNode s={s} phase={phase} active={i === selIdx} onClick={onPick} layout="h" />
            {i < PSTAGES.length - 1 && (
              <span className="hconn" data-done={connDone ? "1" : undefined} data-active={connActive ? "1" : undefined}>
                <span className="hconn-fill" />
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---------- VERTICAL rail ---------- */
function VerticalRail({ phases, selIdx, onPick, clock }) {
  return (
    <div className="vrail">
      {PSTAGES.map((s, i) => {
        const phase = phases[i];
        const connDone = clock >= s.end;
        const connActive = phase === "running";
        return (
          <div key={s.key} className="vrail-item">
            <StageNode s={s} phase={phase} active={i === selIdx} onClick={onPick} layout="v" />
            {i < PSTAGES.length - 1 && (
              <span className="vconn" data-done={connDone ? "1" : undefined} data-active={connActive ? "1" : undefined}>
                <span className="vconn-fill" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ORBITAL rail (agent view) ---------- */
function OrbitalRail({ phases, selIdx, onPick, clock, narration }) {
  // 5 nodes around a circle
  const R = 168, cx = 220, cy = 200;
  const angle = (i) => (-90 + i * (360 / PSTAGES.length)) * (Math.PI / 180);
  return (
    <div className="orbit">
      <svg className="orbit-rings" viewBox="0 0 440 400" aria-hidden="true">
        <circle cx={cx} cy={cy} r={R} className="orbit-ring" />
        {PSTAGES.map((s, i) => {
          const a = angle(i);
          const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
          const phase = phases[i];
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="orbit-spoke" data-phase={phase} />;
        })}
      </svg>
      <div className="orbit-core" data-live={narration.live ? "1" : undefined}>
        <Patty size={34} />
        <span className="orbit-core-label">Patty</span>
      </div>
      {PSTAGES.map((s, i) => {
        const a = angle(i);
        const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        const phase = phases[i];
        return (
          <button key={s.key} className="orbit-node" data-phase={phase} data-active={i === selIdx ? "1" : undefined}
            style={{ left: (x / 440 * 100) + "%", top: (y / 400 * 100) + "%" }}
            onClick={() => phase !== "pending" && onPick(s.key)} disabled={phase === "pending"}>
            <span className="on-ic">
              {phase === "done" ? <Icon name="check" size={15} stroke={2.4} /> : <Icon name={s.icon} size={15} />}
              {phase === "running" && <span className="snode-pulse" />}
            </span>
            <span className="on-label">{s.title}</span>
            <span className="on-num mono">{s.n}</span>
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { LivePipeline, PSTAGES, PTOTAL });
