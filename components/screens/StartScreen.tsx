"use client";
// components/screens/StartScreen.tsx
import React, { useRef, useState } from "react";
import { Link2, AlignLeft, Upload, MapPin, Play, FileText, Sprout, Tag, Send, Award } from "lucide-react";
import { cn, Button, IconField, TextArea, Segmented, LinkButton, Patty, PattyAvatar } from "@/components/ui";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DevPipelineStatus } from "@/components/DevPipelineStatus";

const SAMPLE_MENU = `TRATTORIA LUCIA — Menu

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

export function StartScreen({ onRun }: { onRun: () => void }) {
  const [mode, setMode] = useState("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // TODO(phase 7): remove this dev-only block.
  const seed = useMutation(api.seed.seedTrattoriaLucia);
  const start = useMutation(api.pipelineRuns.startPipeline);
  const [devRunId, setDevRunId] = useState<Id<"pipelineRuns"> | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const runSkeleton = async () => {
    setDevError(null);
    try {
      const { runId } = await seed();
      setDevRunId(runId);
      await start({ runId });
    } catch (e) {
      setDevError(e instanceof Error ? e.message : String(e));
    }
  };

  const hasMenu = (mode === "url" && url.trim()) || (mode === "text" && text.trim()) || (mode === "upload" && file);
  const ready = hasMenu && address.trim();

  const steps = [{ ic: Sprout, t: "Parse menu" }, { ic: Tag, t: "Fetch pricing" }, { ic: MapPin, t: "Find distributors" }, { ic: Send, t: "Send RFPs" }, { ic: Award, t: "Collect quotes" }];

  return (
    <div className="max-w-[1040px] mx-auto px-7 pt-16 pb-20">
      <div className="text-center mb-11">
        <div className="inline-flex items-center gap-[7px] text-[12.5px] font-medium text-forest bg-mint border border-patty/40 rounded-full pl-2.5 pr-3 py-1.5 mb-[22px] whitespace-nowrap"><Patty size={15} /> Patty · RFP Pipeline</div>
        <h1 className="font-serif text-[46px] max-md:text-[36px] leading-[1.08] font-medium tracking-[-0.022em] text-ink mb-[18px] text-balance">Turn your menu into the<br />best suppliers — automatically.</h1>
        <p className="text-[16.5px] leading-relaxed text-muted max-w-[60ch] mx-auto text-pretty">Patty parses your menu into an ingredient basket, prices it against market data, finds local distributors, sends the RFPs, and brings back a recommendation. Give her a menu and an address.</p>
      </div>

      <div className="grid grid-cols-[1fr_312px] max-md:grid-cols-1 gap-6 items-start">
        <div className="bg-surface border border-border rounded-lg shadow-sh3 p-5 animate-rise max-md:order-2">
          <div className="flex items-center justify-between text-[13px] font-semibold text-ink mb-2.5"><span>Menu</span><LinkButton onClick={() => { setMode("text"); setText(SAMPLE_MENU); setAddress("214 Court St, Carroll Gardens, Brooklyn, NY 11231"); }}>Use sample · Trattoria Lucia</LinkButton></div>
          <Segmented value={mode} onChange={setMode} options={[
            { value: "url", label: "Paste URL", icon: <Link2 size={15} /> },
            { value: "text", label: "Paste text", icon: <AlignLeft size={15} /> },
            { value: "upload", label: "Upload", icon: <Upload size={15} /> },
          ]} />
          <div className="mt-3.5">
            {mode === "url" && <div className="flex flex-col gap-2"><IconField icon={<Link2 size={16} />} className="font-mono" placeholder="https://trattorialucia.example/menu" value={url} onChange={(e) => setUrl(e.target.value)} /><p className="text-[12.5px] text-muted leading-relaxed">We’ll fetch the page and read the menu. Most restaurant sites and PDFs work.</p></div>}
            {mode === "text" && <div className="flex flex-col gap-2"><TextArea rows={8} placeholder="Paste your menu here — dish names and descriptions are enough." value={text} onChange={(e) => setText(e.target.value)} /><p className="text-[12.5px] text-muted">{text.trim() ? `${text.trim().split(/\n/).length} lines` : "Dishes, sections, descriptions — Patty handles the rest."}</p></div>}
            {mode === "upload" && (
              <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
                className={cn("flex flex-col items-center justify-center gap-2.5 px-5 py-[30px] border-[1.5px] border-dashed rounded-md cursor-pointer text-center transition", file ? "border-patty/45 bg-mint" : "border-border-strong bg-surface-2 hover:border-patty hover:bg-mint")}>
                <input ref={fileRef} type="file" accept="image/*,.pdf" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <span className="w-[42px] h-[42px] rounded-full inline-flex items-center justify-center bg-surface text-forest border border-border">{file ? <FileText size={20} /> : <Upload size={20} />}</span>
                {file ? <div className="flex flex-col items-center gap-0.5"><span className="font-medium text-[14px]">{file.name}</span><span className="text-[12.5px] text-muted">{(file.size / 1024).toFixed(0)} KB · click to replace</span></div>
                  : <div className="flex flex-col items-center gap-0.5"><span className="font-medium text-[14px]">Drop a photo or PDF of the menu</span><span className="text-[12.5px] text-muted">PNG · JPG · PDF — or click to browse</span></div>}
              </div>
            )}
          </div>

          <div className="flex items-center text-[13px] font-semibold text-ink mt-5 mb-2.5">Restaurant address</div>
          <IconField icon={<MapPin size={16} />} placeholder="Street, city, state ZIP" value={address} onChange={(e) => setAddress(e.target.value)} />
          <p className="text-[12.5px] text-muted mt-[7px]">Used to find distributors that deliver to you.</p>

          <Button variant="primary" size="lg" block className="mt-[22px]" disabled={!ready} onClick={onRun}><Play size={15} /> Run RFP Pipeline</Button>
          <div className="flex items-center gap-3 justify-center mt-3.5"><span className="text-[12.5px] text-muted">Typical run · ~40s</span><span className="w-[3px] h-[3px] rounded-full bg-faint" /><span className="text-[12.5px] text-muted">5 stages · 4 distributors contacted</span></div>
        </div>

        <aside className="bg-surface border border-border rounded-lg p-5 shadow-sh1 max-md:order-1">
          <div className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted mb-4">What Patty does</div>
          <ol className="list-none m-0 p-0 flex flex-col gap-0.5">
            {steps.map((s, i) => (
              <li key={s.t} className="relative flex items-center gap-3 py-[9px]">
                <span className="font-mono text-[11.5px] text-faint w-[18px] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span className="w-[30px] h-[30px] rounded-sm shrink-0 z-[1] inline-flex items-center justify-center bg-mint text-forest border border-forest/10"><s.ic size={15} /></span>
                <span className="text-[14px] font-medium text-ink">{s.t}</span>
                {i < steps.length - 1 && <span className="absolute left-[33px] top-[38px] -bottom-0.5 w-[1.5px] bg-border-strong" />}
              </li>
            ))}
          </ol>
          <div className="flex gap-3 items-start mt-[18px] pt-[18px] border-t border-border">
            <PattyAvatar size={28} />
            <p className="m-0 text-[13px] leading-relaxed text-muted">Every number is tagged with where it came from — <b className="text-ink font-medium">USDA-verified</b>, <b className="text-ink font-medium">estimated</b>, or <b className="text-ink font-medium">no data</b>. Patty flags anything that needs a human.</p>
          </div>
        </aside>
      </div>

      {/* TODO(phase 7): remove. Dev verification for Phase 1 orchestration. */}
      <div className="mt-10 pt-8 border-t border-dashed border-border-strong/40">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted">
              Dev · Phase 1 verification
            </div>
            <p className="text-[13px] text-muted mt-1">
              Seeds a Trattoria Lucia restaurant + pipelineRun, then schedules the 5 stage stubs.
              Watch the steps transition pending → running → done in real time via Convex reactivity.
            </p>
          </div>
          <Button variant="primary" size="md" onClick={runSkeleton}>
            <Play size={14} /> Run skeleton pipeline
          </Button>
        </div>
        {devError && <p className="text-[13px] text-st-error mb-2">{devError}</p>}
        {devRunId && <DevPipelineStatus runId={devRunId} />}
      </div>
    </div>
  );
}
