# Handoff: Pathway RFP Pipeline

An autonomous procurement agent ("Patty") for restaurants. The user provides a menu + address; the app parses the menu into an ingredient basket, prices it against market data, finds local distributors, emails them RFPs, and collects/compares quotes into a recommendation — with a human-approval step.

This package is the **design + spec** for rebuilding the prototype in **Next.js (App Router) + Tailwind CSS + Convex**.

---

## What's in this package

```
design_handoff_rfp_pipeline/
├── README.md                  ← you are here
├── TOKENS.md                  ← #2 design tokens (colors, type, spacing, radii, shadows) + Tailwind @theme
├── COMPONENT_SPEC.md          ← #3 every primitive's variants/usage; full status-badge family
├── STATE_VOCABULARY.md        ← #4 flat list of all states by category + backend reconciliation notes
├── code/                      ← #1 ported React + Tailwind component code (copy-pasteable)
│   ├── app/
│   │   ├── globals.css        ← Tailwind v4 @theme drop-in (the token source of truth)
│   │   ├── layout.tsx         ← next/font wiring (Geist · Geist Mono · Newsreader)
│   │   └── page.tsx           ← state machine (start → pipeline) + topbar
│   ├── lib/data.ts            ← TypeScript types + demo/seed data (mirror onto Convex schema)
│   ├── components/ui.tsx      ← ALL shared primitives (badges, buttons, cards, inputs, table, modal…)
│   └── components/screens/
│       ├── StartScreen.tsx
│       ├── LivePipeline.tsx   ← timeline engine + 3 layouts (horizontal/vertical/orbital)
│       ├── stages.tsx         ← the 5 stage panels, each with pending/running/done states
│       └── modals.tsx         ← ApproveModal (review→sending→done) + BasketModal
│   └── public/                ← brand assets (patty.svg, pathway-logo.png)
└── design_reference/          ← the original working HTML prototype (open in a browser)
    ├── RFP Pipeline.html
    ├── app/                   (prototype source — reference only)
    └── assets/
```

## About the design files
`design_reference/` is the **HTML prototype** — the canonical look & behavior. Open `RFP Pipeline.html` in a browser to interact with it. It is a reference, **not** code to ship.

The files in `code/` are a **faithful port to React + Tailwind** to save you transcription time. They assume the target stack below. Treat them as a strong starting point — wire the data to Convex, adjust to your project conventions, and verify against the prototype + TOKENS.md for pixel fidelity.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are final. Recreate pixel-perfectly using the tokens in `TOKENS.md` / `globals.css`. Don't invent values — every color, size, and state is documented.

---

## Target stack notes
- **Next.js App Router + Tailwind CSS.** `code/app/globals.css` is Tailwind **v4** (`@import "tailwindcss"` + `@theme`). If you're on Tailwind v3, port the `@theme` vars into `theme.extend` in `tailwind.config.ts` (same names, same values). All custom utilities used (`bg-forest`, `text-ink`, `shadow-sh1`, `rounded-lg`, `font-serif`, etc.) come from those tokens.
- **Minimal dependencies.** Only runtime dep beyond React/Next/Tailwind is **`lucide-react`** for icons (`npm i lucide-react`). Everything else is plain Tailwind utilities. No CSS-in-JS, no UI kit.
- **Fonts (install):** **Geist**, **Geist Mono**, **Newsreader** — all on Google Fonts via `next/font/google` (see `app/layout.tsx`; they expose CSS vars the theme reads). No licensed fonts required.
- **Assets (install):** copy `code/public/patty.svg` (the `#57BD86` sparkle mark) and `code/public/pathway-logo.png` (wordmark) into your Next `public/`. The components reference `/patty.svg` and `/pathway-logo.png`. The Patty sparkle should appear at least once per screen.
- **`@/` import alias** assumes `baseUrl`/`paths` → project root (standard Next setup). Adjust imports if your alias differs.
- **Convex:** `lib/data.ts` is fixture data with the exact TS types to mirror onto your schema. See `STATE_VOCABULARY.md` for the enums to reconcile (⚠️ note the `mock` provenance gap and the `followed_up`/approval-state questions).

---

## Screens & states

| Screen | States built |
|---|---|
| **Start / Input** | URL / paste-text / upload modes; address; validation-gated Run; sample loader |
| **Live Pipeline** (centerpiece) | auto-play + pause/replay/scrub + 0.5/1/2× speed; per-stage pending→running→done; 3 layouts (horizontal, **vertical=default**, orbital agent-view); live Patty narration |
| **Stage 1 · Recipes** | pending / loading (skeleton) / done (dishes + ingredient chips + confidence + flags) |
| **Stage 2 · Pricing** | pending / loading / done (table w/ provenance, trend, no-data rows) |
| **Stage 3 · Distributors** | pending / loading ("widening search") / done (cards + stylized map) |
| **Stage 4 · RFP Emails** | pending / loading / done (per-distributor threads + live email preview + bounce banner) |
| **Stage 5 · Quotes** | pending / loading ("awaiting replies") / done (comparison table + recommendation) |
| **Recommendation** | default + **needs-human-approval** treatment; awarded splits; gap lines |
| **ApproveModal** | review → sending → confirmed (PO list, per-gap decisions, ack gate) |
| **BasketModal** | editable lines (toggle + qty stepper), change tracking, apply→banner |
| **Mobile** | key states (start, live pipeline, recommendation) — see prototype's Mobile tweak |

## Interactions & behavior
- **Pipeline engine:** a clock (seconds) advances via `requestAnimationFrame` while playing; each stage derives `pending/running/done` from `clock` vs its `start/end`. Persisted to `localStorage` (`rfp.clock.v1`). In production, drive this from real Convex subscription state instead of the demo timeline — the stage components are pure functions of `phase`.
- **Selection:** the detail panel follows the running stage unless the user pins one (click any non-pending node).
- **Motion (critical):** entrance reveals are **transform-only** (never opacity-gated) and `CountUp` initializes to its final value, animating from 0 only when visible + `prefers-reduced-motion: no-preference`. This prevents content from being invisible if a tab is backgrounded. Keep this property in the rebuild. See TOKENS §6.
- **Modals** must be **portaled to `document.body`** (parent panels use transforms that would trap `position: fixed`). `components/ui.tsx`'s `<Modal>` already does this.

## State management
- Client: `screen` (start|pipeline), pipeline `clock`/`playing`/`speed`, selected stage, modal open flags, basket edits, approval step + per-gap decisions. All local React state in the prototype.
- Server (Convex, to build): a `run` with ordered `stages[]`, `ingredients[]`, `prices[]`, `distributors[]`, `emailThreads[]`, `quotes[]`, and a `recommendation`. Enums per `STATE_VOCABULARY.md`. The UI is a near-pure render of that document + a few client interactions (approve/adjust) you may choose to persist.

## Assets
- `patty.svg` — single-path sparkle, fill `#57BD86`. App icon / accent / agent avatar.
- `pathway-logo.png` — wordmark for the topbar.
Both included in `code/public/` and `design_reference/assets/`.
