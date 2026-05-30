"use client";
// components/screens/StartScreen.tsx
import React, { useRef, useState } from "react";
import {
  Link2, AlignLeft, Upload, MapPin, Play, FileText, Sprout, Tag, Send, Award, Store, Loader2, X,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cn, Button, IconField, TextArea, Segmented, LinkButton, Patty, PattyAvatar, ReviewStrip,
} from "@/components/ui";

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

const SAMPLE_NAME = "Trattoria Lucia";
const SAMPLE_ADDRESS = "214 Court St, Carroll Gardens, Brooklyn, NY 11231";

export function StartScreen({ onRun }: { onRun: (runId: Id<"pipelineRuns">) => void }) {
  const [mode, setMode] = useState<"url" | "text" | "upload">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const createFromMenu = useMutation(api.menus.createFromMenu);
  const generateUploadUrl = useMutation(api.menus.generateUploadUrl);
  const startPipeline = useMutation(api.pipelineRuns.startPipeline);

  const hasMenu =
    (mode === "url" && url.trim()) ||
    (mode === "text" && text.trim()) ||
    (mode === "upload" && file);
  const ready = !!hasMenu && address.trim() && restaurantName.trim() && !submitting;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      let runId: Id<"pipelineRuns">;
      if (mode === "url") {
        const r = await createFromMenu({
          sourceType: "url",
          rawSource: url.trim(),
          restaurantName: restaurantName.trim(),
          address: address.trim(),
          sourceUrl: url.trim(),
        });
        runId = r.runId;
      } else if (mode === "text") {
        const r = await createFromMenu({
          sourceType: "text",
          rawSource: text.trim(),
          restaurantName: restaurantName.trim(),
          address: address.trim(),
        });
        runId = r.runId;
      } else {
        // upload
        if (!file) throw new Error("No file selected");
        const uploadUrl = await generateUploadUrl();
        const postRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!postRes.ok) throw new Error(`Upload failed: ${postRes.status}`);
        const { storageId } = (await postRes.json()) as { storageId: string };
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const r = await createFromMenu({
          sourceType: isPdf ? "pdf" : "image",
          rawSource: storageId,
          restaurantName: restaurantName.trim(),
          address: address.trim(),
        });
        runId = r.runId;
      }
      await startPipeline({ runId });
      onRun(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const steps = [
    { ic: Sprout, t: "Parse menu" },
    { ic: Tag, t: "Fetch pricing" },
    { ic: MapPin, t: "Find distributors" },
    { ic: Send, t: "Send RFPs" },
    { ic: Award, t: "Collect quotes" },
  ];

  return (
    <div className="max-w-[1040px] mx-auto px-7 pt-16 pb-20">
      <div className="text-center mb-11">
        <div className="inline-flex items-center gap-[7px] text-[12.5px] font-medium text-forest bg-mint border border-patty/40 rounded-full pl-2.5 pr-3 py-1.5 mb-[22px] whitespace-nowrap">
          <Patty size={15} /> Patty · RFP Pipeline
        </div>
        <h1 className="font-serif text-[46px] max-md:text-[36px] leading-[1.08] font-medium tracking-[-0.022em] text-ink mb-[18px] text-balance">
          Turn your menu into the<br />best suppliers — automatically.
        </h1>
        <p className="text-[16.5px] leading-relaxed text-muted max-w-[60ch] mx-auto text-pretty">
          Patty parses your menu into an ingredient basket, prices it against market data, finds local distributors, sends the RFPs, and brings back a recommendation. Give her a menu and an address.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_312px] max-md:grid-cols-1 gap-6 items-start">
        <div className="bg-surface border border-border rounded-lg shadow-sh3 p-5 animate-rise max-md:order-2">
          <div className="flex items-center justify-between text-[13px] font-semibold text-ink mb-2.5">
            <span>Menu</span>
            <LinkButton
              onClick={() => {
                setMode("text");
                setText(SAMPLE_MENU);
                setRestaurantName(SAMPLE_NAME);
                setAddress(SAMPLE_ADDRESS);
              }}
            >
              Use sample · Trattoria Lucia
            </LinkButton>
          </div>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            options={[
              { value: "url", label: "Paste URL", icon: <Link2 size={15} /> },
              { value: "text", label: "Paste text", icon: <AlignLeft size={15} /> },
              { value: "upload", label: "Upload", icon: <Upload size={15} /> },
            ]}
          />
          <div className="mt-3.5">
            {mode === "url" && (
              <div className="flex flex-col gap-2">
                <IconField
                  icon={<Link2 size={16} />}
                  className="font-mono"
                  placeholder="https://trattorialucia.example/menu"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-[12.5px] text-muted leading-relaxed">
                  We&apos;ll fetch the page and read the menu. Most restaurant sites and PDFs work.
                </p>
              </div>
            )}
            {mode === "text" && (
              <div className="flex flex-col gap-2">
                <TextArea
                  rows={8}
                  placeholder="Paste your menu here — dish names and descriptions are enough."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <p className="text-[12.5px] text-muted">
                  {text.trim() ? `${text.trim().split(/\n/).length} lines` : "Dishes, sections, descriptions — Patty handles the rest."}
                </p>
              </div>
            )}
            {mode === "upload" && (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2.5 px-5 py-[30px] border-[1.5px] border-dashed rounded-md cursor-pointer text-center transition",
                  file
                    ? "border-patty/45 bg-mint"
                    : "border-border-strong bg-surface-2 hover:border-patty hover:bg-mint",
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <span className="w-[42px] h-[42px] rounded-full inline-flex items-center justify-center bg-surface text-forest border border-border">
                  {file ? <FileText size={20} /> : <Upload size={20} />}
                </span>
                {file ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="font-medium text-[14px]">{file.name}</span>
                    <span className="text-[12.5px] text-muted">
                      {(file.size / 1024).toFixed(0)} KB · click to replace
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="font-medium text-[14px]">Drop a photo or PDF of the menu</span>
                    <span className="text-[12.5px] text-muted">PNG · JPG · PDF — or click to browse</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center text-[13px] font-semibold text-ink mt-5 mb-2.5">
            Restaurant
          </div>
          <IconField
            icon={<Store size={16} />}
            placeholder="Restaurant name"
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
          />
          <div className="h-2" />
          <IconField
            icon={<MapPin size={16} />}
            placeholder="Street, city, state ZIP"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-[12.5px] text-muted mt-[7px]">
            Address is used to find distributors that deliver to you.
          </p>

          <Button
            variant="primary"
            size="lg"
            block
            className="mt-[22px]"
            disabled={!ready}
            onClick={onSubmit}
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{" "}
            {submitting ? "Starting pipeline…" : "Run RFP Pipeline"}
          </Button>

          {error && (
            <div className="mt-4">
              <ReviewStrip Icon={X} tone="error">
                <b className="text-ink font-medium">Couldn&apos;t start the run.</b> {error}
              </ReviewStrip>
            </div>
          )}

          <div className="flex items-center gap-3 justify-center mt-3.5">
            <span className="text-[12.5px] text-muted">Typical run · ~40s</span>
            <span className="w-[3px] h-[3px] rounded-full bg-faint" />
            <span className="text-[12.5px] text-muted">5 stages · live Convex reactivity</span>
          </div>
        </div>

        <aside className="bg-surface border border-border rounded-lg p-5 shadow-sh1 max-md:order-1">
          <div className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted mb-4">
            What Patty does
          </div>
          <ol className="list-none m-0 p-0 flex flex-col gap-0.5">
            {steps.map((s, i) => (
              <li key={s.t} className="relative flex items-center gap-3 py-[9px]">
                <span className="font-mono text-[11.5px] text-faint w-[18px] shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="w-[30px] h-[30px] rounded-sm shrink-0 z-[1] inline-flex items-center justify-center bg-mint text-forest border border-forest/10">
                  <s.ic size={15} />
                </span>
                <span className="text-[14px] font-medium text-ink">{s.t}</span>
                {i < steps.length - 1 && (
                  <span className="absolute left-[33px] top-[38px] -bottom-0.5 w-[1.5px] bg-border-strong" />
                )}
              </li>
            ))}
          </ol>
          <div className="flex gap-3 items-start mt-[18px] pt-[18px] border-t border-border">
            <PattyAvatar size={28} />
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              Every number is tagged with where it came from — <b className="text-ink font-medium">USDA-verified</b>, <b className="text-ink font-medium">estimated</b>, or <b className="text-ink font-medium">no data</b>. Patty flags anything that needs a human.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
