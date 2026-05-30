# Component Spec — Pathway RFP Pipeline

Every shared primitive, its variants, props, and usage. Status badges are spec'd exhaustively (color + icon + label + which vocabulary). Icons reference **lucide-react** names.

Reference implementations are in `code/components/ui.tsx` (primitives) and `code/components/screens/*` (screens). This doc is the contract; the code is one faithful realization of it.

---

## A. Status-badge family ⭐ (the core system)

All badges share one base (`<Badge>`): a pill with `icon + label`, foreground color = the state's FG token, and (in the default *filled* style) a tinted background = the state's BG token. They differ only in which **vocabulary** they express.

The prototype supports **three visual styles** (a global preference; pick ONE default for the rebuild — recommend **filled**):
- **filled** *(default)* — tinted bg, colored icon + label.
- **outline** — transparent bg, 1px border in the FG color @ ~45% mix, colored icon + label.
- **dots** — a colored dot + neutral (`ink-2`) label, no fill. Running state's dot gets a pulsing ring.

Sizes: `sm` (11px text, 11px icon, 2–7px pad) and `md` (12px text, 13px icon, 3–9px pad). A `dotOnly` option renders icon/dot with no label (used in dense mobile rows).

### A1. Pipeline status — vocabulary `pipeline`

| Variant | Label | lucide icon | FG / BG |
|---|---|---|---|
| `pending` | "Pending" | `Clock` | `#94908A` / `#F1EFEA` |
| `running` | "Running" | `LoaderCircle` (spinning) | `#2E8FD6` / `#E8F3FC` |
| `done` | "Done" | `Check` | `#2E9E6B` / `#E7F5EE` |
| `error` | "Error" | `TriangleAlert` | `#D6492E` / `#FBEAE6` |

`running` spins its icon (0.9s linear) and, in dots style, pulses the dot.

### A2. Email / RFP status — vocabulary `email`

| Variant | Label | lucide icon | FG / BG |
|---|---|---|---|
| `queued` | "Queued" | `Clock` | `#94908A` / `#F1EFEA` |
| `sent` | "Sent" | `Send` | `#2E8FD6` / `#E8F3FC` |
| `replied` | "Replied" | `Check` | `#2E9E6B` / `#E7F5EE` |
| `followed_up` | "Followed up" | `RefreshCw` | `#C0820B` / `#FBF2DC` |
| `failed` | "Failed" | `X` | `#D6492E` / `#FBEAE6` |

### A3. Pricing provenance — vocabulary `provenance`

| Variant | Label | lucide icon | FG / BG |
|---|---|---|---|
| `usda` / `verified` | "USDA verified" | `Check` | `#2E9E6B` / `#E7F5EE` |
| `estimated` | "Estimated" | `Sparkles` | `#8A6FB0` / `#F1ECF7` |
| `no_data` | "No data" | `Minus` | `#94908A` / `#F1EFEA` |
| `mock` *(backend-only)* | "Mock" | `FlaskConical` (suggested) | reuse estimated violet | **Not in current design** — add per STATE_VOCABULARY.md |

### A4. Confidence — vocabulary `confidence`

Rendered as a **3-pip meter + label** (not a plain pill), regardless of badge style. Pips lit = high 3 / medium 2 / low 1, colored in the level FG; unlit pips are `muted @ 22%`. Border: `border` (filled/dots) or FG @ 40% (outline).

| Variant | Short label | Full label | FG |
|---|---|---|---|
| `high` | "High" | "High confidence" | `#2E9E6B` |
| `medium` | "Medium" | "Medium confidence" | `#C0820B` |
| `low` | "Low" | "Low · needs review" | `#D6492E` |

`full` prop switches short↔full label.

### A5. Needs-approval — vocabulary `approval`

A standalone **solid amber pill** (not the Badge base): bg `#C0820B`, white text + `Flag` icon, label **"Needs human approval"**. Used on the recommendation card header and mobile result. Drives the warn-tinted treatment of the whole recommendation card (amber border + amber gradient wash + amber award icon).

### A6. Category tag — vocabulary `category`

Neutral chip (`surface-3` bg, `border`, `ink-2` text) with a leading colored dot per category color (§1.5 in TOKENS). Labels: Produce / Dairy / Meat / Seafood / Dry goods.

---

## B. Trend indicator

Inline mono value with arrow. `up` → `ArrowUp` red `#D6492E`; `down` → `ArrowDown` green `#2E9E6B`; flat (≈0) → `Minus` grey. Shows `±X.X%`. Null/unknown → faint em-dash. 12px, weight 500, tabular-nums. **Semantics are buyer-oriented: a price increase is red (bad).**

---

## C. Buttons

Base: `inline-flex items-center gap-2`, `rounded-md` (14px), font 14/540, focus-visible ring (`--ring`), `:active` translateY(.5px). Sizes: `sm` (12.5px / rounded-sm), default (14px), `lg` (16px / rounded-lg / 15×24 pad). `block` → full width + centered.

| Variant | Resting | Hover | Notes |
|---|---|---|---|
| `primary` | `bg-forest text-white`, sh-1 | `bg-forest-hi`, sh-2 | Run pipeline, approve, apply. **Disabled:** `#B9C4BC` bg / `#EEF2EF` text, no shadow, not-allowed |
| `secondary` | `bg-mint text-forest`, border forest@12% | `bg-mint-deep` | Pale-green tint |
| `ghost` | transparent, `text-ink-2`, `border-border` | `bg-surface-3`, border-strong | Cancel, adjust basket, "New run" |
| `quiet` | transparent, `text-muted`, tight pad | `bg-surface-3 text-ink` | Icon/toolbar actions |
| `destructive` *(implied)* | `bg-st-error text-white` | darken | **Not used in design**; provide for delete/abort. |

Link button (text-only): `text-patty-ink`, 12.5/540, underline-on-hover. Used for "Use sample" and inline actions.

---

## D. Cards & surfaces

- **Card**: `bg-surface border border-border rounded-lg shadow-sh1`. `card-pad` = 20px. `card-flush` = no shadow.
- **Elevated card** (input card, recommendation, modal): `shadow-sh3` / `shadow-pop`.
- **PanelHead**: optional icon chip (36px, `bg-mint text-forest`, rounded-md) + kicker (uppercase patty-ink) + serif title (`h2`) + muted sub; optional right-aligned actions slot.
- **EmptyState card**: centered, `border-dashed border-border-strong`, `bg-surface-2`, 36×28 pad; 40px round icon chip; 15/560 title + 13/muted body; tones: `neutral` (default), `warn` (amber dashed + amber icon), `error` (solid red-tinted), `running` (blue icon). Used for all pending/empty/awaiting/error states.
- **Review strip**: full-width inline callout below a panel — amber-tinted (`st-warn-bg @ 50%`), 1px amber border, leading icon, 13px text with bold lead. Honest "X flagged / no data / didn't quote" messaging.

---

## E. Tables

- **Generic row** (`tbl-row`): CSS grid, 11×18 pad, 1px bottom border, 13.5px. **Head row** (`tbl-head`): 11px uppercase muted on `surface-2`.
- **Pricing table**: 5 columns `1.7fr 0.8fr 1fr 1fr 1.6fr` → Ingredient · Qty · Unit price · Trend · Provenance(+source note). No-data rows get a faint `surface-3@60%` wash and an em-dash price. Flagged ingredients show a small amber `Flag` after the name.
- **Comparison table** (quotes): CSS grid `132px repeat(N, minmax(120px,1fr))`. Sticky-feel column heads on `surface-2`; **awarded** column tinted `mint` with a forest "Awarded" corner tag; **no-quote** column at 65% opacity. Row keys on `surface-2`. Completeness rendered as a meter (forest bar on awarded, sage otherwise) + `quoted/total` mono. Horizontal-scroll wrapper, min-width 640px.

---

## F. Inputs

- **Field** (`field`): `bg-surface border border-border-strong rounded-md`, 12×14 pad, 14.5px; focus → forest border + ring. Textarea variant: vertical resize, lh 1.55.
- **Icon field** (`url-field`): leading lucide icon (`Link2`/`MapPin`) + borderless input inside a bordered, focus-within-ringed shell. Used for URL and address.
- **Dropzone**: dashed `border-strong`, `bg-surface-2`, centered icon chip + label + hint; hover → patty border + mint bg; filled state → solid patty border + mint bg + filename. Drag-over and click-to-browse.
- **Stepper** (basket qty): `surface-2` shell, minus/plus buttons (26px), centered mono value + faint unit. Disabled when line excluded or at 0.
- **Toggle pill** (basket include/exclude): 22px square, `rounded-[6px]`; on = `bg-forest text-white` Check; off = bordered grey X. Excluded line dims to 50%.
- **Checkbox** (approval ack): hidden native input + 20px custom box; checked = `bg-forest border-forest` white Check.

---

## G. Input-mode segmented control

The Start screen's menu-input switcher. Track: `bg-surface-3 border border-border rounded-md`, 3px pad, full width, 3 equal tabs. Tab: `flex-1`, icon + label, 13/540, `text-muted`; hover → `text-ink`; **active** → `bg-surface text-forest shadow-sh1` (a raised "pill" that slides under the active tab). Three tabs: **Paste URL** (`Link2`), **Paste text** (`AlignLeft`), **Upload** (`Upload`).

> The same segmented pattern is reused for: the **gap-decision** control in the Approve modal (Hold / Source manually / Drop), and the **Tweaks** layout/badge/speed switchers. Build it once as `<Segmented options value onChange>`.

---

## H. Brand marks

- **Patty sparkle** — `patty.svg` (single-path mark, `#57BD86`). Use as `<img>` / inline SVG. Sizes 13–34px. Appears in: logo lockup, the start badge, agent avatar (in a mint ring that pulses when "live"), orbital core, email footers, banners. **At least one Patty sparkle must appear per screen.**
- **Pathway wordmark** — `pathway-logo.png` in the topbar (~20px tall).
- **PattyAvatar** — sparkle centered in a 24–28px mint circle with a patty@40% border; `live` → `pulse-ring` animation. Precedes agent narration lines ("Patty is pricing the basket…").

---

## I. Live-pipeline specific

- **StageNode**: card with status icon chip + "Stage N" kicker + title + one-line summary. States drive the chip color (pending grey / running blue+pulse / done green-check). `active` (selected) → forest 2px ring. Pending nodes are 55% opacity and non-clickable.
- **Connector**: between nodes; fills green when the prior stage is done; the active connector shimmers blue.
- **Controls bar**: play/pause/replay buttons (forest primary + ghost), a scrubber (`<input range>` with forest fill track + white thumb), `elapsed / total` mono readout, and a 0.5×/1×/2× speed segmented.
- **Three layouts** (a tweak; default **vertical**): `horizontal` (row of nodes + connectors, detail below), `vertical` (sticky left stepper rail + detail right; stacks under 960px), `orbital` (Patty core with 5 nodes on a dashed ring, animated spoke to the running node, detail below).

---

## J. Modals

Shared shell: fixed full-viewport overlay (`ink @ 38%` + `blur(3px)`), centered card max-width 560px, `rounded-xl`, `shadow-pop`, `max-height: calc(100vh - 48px)`, scrollable body. **Must be rendered via a portal to `document.body`** (the panels use CSS transforms that would otherwise trap `position: fixed`). Head = icon chip + kicker + serif title + close X. Foot = left helper text + right actions, on `surface-2`.

- **ApproveModal** — steps `review → sending → done`. Review: PO list (awarded splits + total), per-gap **Segmented** decision (Hold / Source manually / Drop) with a note line, an authorization checkbox gating the primary button. Sending: spinner + status copy. Done: green check, sent PO list with refs/emails, amber "held lines" note, Done button.
- **BasketModal** — editable 16-line list: include/exclude toggle + category dot + name + qty stepper. Footer shows live `N lines · M changes`; "Apply & re-price" disabled until a change. On apply → parent shows a mint "Basket updated" banner.
