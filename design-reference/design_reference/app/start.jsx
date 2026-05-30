/* ============================================================
   start.jsx — Start / Input screen
   Three input modes (URL · text · upload) + address + Run.
   ============================================================ */

const SAMPLE_MENU_URL = "https://trattorialucia.example/menu";
const SAMPLE_MENU_TEXT = `TRATTORIA LUCIA — Menu

ANTIPASTI
· Insalata Caprese — mozzarella di bufala, heirloom tomato, basil, EVOO
· Bruschetta al Pomodoro — rustic bread, tomato, garlic, basil

PRIMI
· Tagliatelle al Ragù — beef & pork ragù, San Marzano, parmigiano
· Cacio e Pepe — spaghetti, pecorino romano, black pepper

SECONDI
· Osso Buco alla Milanese — veal shank, soffritto, white wine

DOLCI
· Tiramisù della Casa — mascarpone, espresso, savoiardi, cocoa`;

function ModeTab({ id, icon, label, active, onClick }) {
  return (
    <button className="seg-tab" data-active={active ? "1" : undefined} onClick={() => onClick(id)} type="button">
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

function StartScreen({ onRun }) {
  const [mode, setMode] = useState("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [address, setAddress] = useState("");
  const fileRef = useRef();

  const hasMenu = (mode === "url" && url.trim()) || (mode === "text" && text.trim()) || (mode === "upload" && file);
  const ready = hasMenu && address.trim();

  const fillSample = () => {
    setMode("text"); setText(SAMPLE_MENU_TEXT);
    setAddress("214 Court St, Carroll Gardens, Brooklyn, NY 11231");
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const steps = [
    { ic: "ingredients", t: "Parse menu" },
    { ic: "tag", t: "Fetch pricing" },
    { ic: "pin", t: "Find distributors" },
    { ic: "send", t: "Send RFPs" },
    { ic: "award", t: "Collect quotes" },
  ];

  return (
    <div className="start-wrap">
      <div className="start-hero">
        <div className="start-badge">
          <Patty size={15} /> Patty · RFP Pipeline
        </div>
        <h1 className="start-h1 serif">
          Turn your menu into the<br />best suppliers — automatically.
        </h1>
        <p className="start-lede">
          Patty parses your menu into an ingredient basket, prices it against market data,
          finds local distributors, sends the RFPs, and brings back a recommendation.
          Give her a menu and an address.
        </p>
      </div>

      <div className="start-grid">
        {/* Input card */}
        <div className="card card-pad start-card rise">
          <div className="field-label">
            <span>Menu</span>
            <button className="link-btn" type="button" onClick={fillSample}>Use sample · Trattoria Lucia</button>
          </div>

          <div className="seg" role="tablist" aria-label="Menu input mode">
            <ModeTab id="url" icon="link" label="Paste URL" active={mode === "url"} onClick={setMode} />
            <ModeTab id="text" icon="text" label="Paste text" active={mode === "text"} onClick={setMode} />
            <ModeTab id="upload" icon="upload" label="Upload" active={mode === "upload"} onClick={setMode} />
          </div>

          <div className="seg-body">
            {mode === "url" && (
              <div className="col gap-8 fade">
                <div className="url-field">
                  <Icon name="link" size={16} style={{ color: "var(--muted)" }} />
                  <input className="url-input mono" placeholder={SAMPLE_MENU_URL}
                    value={url} onChange={(e) => setUrl(e.target.value)} />
                </div>
                <p className="help">We’ll fetch the page and read the menu. Most restaurant sites and PDFs work.</p>
              </div>
            )}
            {mode === "text" && (
              <div className="col gap-8 fade">
                <textarea className="field" rows={8} placeholder="Paste your menu here — dish names and descriptions are enough."
                  value={text} onChange={(e) => setText(e.target.value)} />
                <p className="help">{text.trim() ? `${text.trim().split(/\n/).length} lines` : "Dishes, sections, descriptions — Patty handles the rest."}</p>
              </div>
            )}
            {mode === "upload" && (
              <div className="col gap-8 fade">
                <div className="dropzone" data-has={file ? "1" : undefined}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
                  <input ref={fileRef} type="file" accept="image/*,.pdf" hidden
                    onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <span className="dz-ic"><Icon name={file ? "file" : "upload"} size={20} /></span>
                  {file ? (
                    <div className="col" style={{ alignItems: "center", gap: 2 }}>
                      <span style={{ fontWeight: 560, fontSize: 14 }}>{file.name}</span>
                      <span className="help">{(file.size / 1024).toFixed(0)} KB · click to replace</span>
                    </div>
                  ) : (
                    <div className="col" style={{ alignItems: "center", gap: 2 }}>
                      <span style={{ fontWeight: 540, fontSize: 14 }}>Drop a photo or PDF of the menu</span>
                      <span className="help">PNG · JPG · PDF — or click to browse</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="field-label" style={{ marginTop: 20 }}><span>Restaurant address</span></div>
          <div className="url-field">
            <Icon name="pin" size={16} style={{ color: "var(--muted)" }} />
            <input className="url-input" placeholder="Street, city, state ZIP"
              value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <p className="help" style={{ marginTop: 7 }}>Used to find distributors that deliver to you.</p>

          <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 22 }}
            disabled={!ready}
            onClick={() => onRun({ mode, url, text, file, address })}>
            <Icon name="play" size={15} /> Run RFP Pipeline
          </button>
          <div className="run-meta">
            <span className="help">Typical run · ~40s</span>
            <span className="dot-sep" />
            <span className="help">5 stages · 4 distributors contacted</span>
          </div>
        </div>

        {/* Side: how it works */}
        <aside className="start-aside">
          <div className="aside-label">What Patty does</div>
          <ol className="flow-list">
            {steps.map((s, i) => (
              <li key={s.t} className="flow-item">
                <span className="flow-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="flow-ic"><Icon name={s.ic} size={15} /></span>
                <span className="flow-t">{s.t}</span>
                {i < steps.length - 1 && <span className="flow-rail" />}
              </li>
            ))}
          </ol>
          <div className="aside-note">
            <PattyAvatar size={28} />
            <p>Every number is tagged with where it came from — <b>USDA-verified</b>, <b>estimated</b>, or <b>no data</b>. Patty flags anything that needs a human.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

window.StartScreen = StartScreen;
