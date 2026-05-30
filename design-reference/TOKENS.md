# Design Tokens — Pathway RFP Pipeline

Source of truth for the rebuild. Values are pulled verbatim from the prototype CSS (`app/tokens.css`). Where a color was authored in `oklch`, the oklch value is canonical (Tailwind v4 supports it directly); the hex is a sRGB fallback for v3 / other tooling.

A ready-to-paste **Tailwind v4 `@theme` block** is at the bottom (and in `code/app/globals.css`).

---

## 1. Colors

### 1.1 Surfaces & structure (semantic)

| Semantic name | Token | Value | Hex | Usage |
|---|---|---|---|---|
| `background` | `--cream` | `#FFFBEB` | `#FFFBEB` | App page background (warm) |
| `surface` | `--paper` | `#FFFFFF` | `#FFFFFF` | Cards, panels, inputs |
| `surface-2` | `--paper-2` | `#FCFCFA` | `#FCFCFA` | Table heads, faint panels, sticky email head |
| `surface-3` | `--paper-3` | `#F7F6F1` | `#F7F6F1` | Segmented track, chips, ingredient chips |
| `border` | `--border` | `#E9E5DA` | `#E9E5DA` | Default hairline border |
| `border-strong` | `--border-2` / `--border-strong` | `#DED9CC` / `#CABFAD` | — | Input borders / dropzone & stepper |
| `text-primary` | `--ink` | `#16130D` | `#16130D` | Headlines, primary text (warm near-black) |
| `text-secondary` | `--ink-2` | `#3A352C` | `#3A352C` | Body emphasis, table cells |
| `text-muted` | `--muted` | `#6B6256` | `#6B6256` | Secondary copy, captions |
| `text-faint` | `--faint` | `#B8B0A2` | `#B8B0A2` | Placeholders, units, de-emphasis |

### 1.2 Brand / accent

| Semantic name | Token | Value | Hex | Usage |
|---|---|---|---|---|
| `accent` (primary) | `--forest` | `oklch(25% 0.08 152)` | `#16432B` | Primary buttons, active rings, awarded states, links-on-hover |
| `accent-hover` | `--forest-hi` | `oklch(31% 0.085 152)` | `#1E5638` | Primary button hover |
| `accent-pressed` | `--forest-lo` | `oklch(20% 0.07 152)` | `#0F3221` | Deepest forest (selection text) |
| `accent-foreground` | — | `#FFFFFF` | `#FFFFFF` | Text/icons on `accent` |
| `patty` | `--patty` | `#57BD86` | `#57BD86` | The sparkle mark accent; progress-bar gradient tip; live pulses |
| `patty-ink` | `--patty-ink` | `#3F9E6A` | `#3F9E6A` | Patty green as readable text on light (kickers) |
| `sage` | `--sage` | `oklch(80% 0.08 152)` | `#A8D9BE` | Selection highlight; non-awarded completeness bars |
| `mint` | `--mint` | `oklch(96.5% 0.018 152)` | `#F1F7F3` | Tinted green surface (secondary buttons, badges, icon chips) |
| `mint-deep` | `--mint-deep` | `#E6F3E6` | `#E6F3E6` | Secondary button hover |

> **Rule of thumb:** white/cream surface, near-black text, deep-forest primary actions, `#57BD86` sparkle accents only. Never a multi-color rainbow.

### 1.3 Status color sets

Each status has a **foreground** (icon + label + border) and a **tint background** (filled badge fill). Backgrounds are intentionally light for AA text contrast with the foreground laid over them.

**Pipeline stage status**

| State | FG token | FG hex | BG token | BG hex |
|---|---|---|---|---|
| `pending` | `--st-pending` | `#94908A` | `--st-pending-bg` | `#F1EFEA` |
| `running` | `--st-running` | `#2E8FD6` | `--st-running-bg` | `#E8F3FC` |
| `done` | `--st-done` | `#2E9E6B` | `--st-done-bg` | `#E7F5EE` |
| `error` | `--st-error` | `#D6492E` | `--st-error-bg` | `#FBEAE6` |
| `warn` (attention) | `--st-warn` | `#C0820B` | `--st-warn-bg` | `#FBF2DC` |

**Email / RFP status** (reuses the pipeline set + warn)

| State | FG hex | BG hex |
|---|---|---|
| `queued` | `#94908A` | `#F1EFEA` |
| `sent` | `#2E8FD6` | `#E8F3FC` |
| `replied` | `#2E9E6B` | `#E7F5EE` |
| `followed_up` | `#C0820B` | `#FBF2DC` |
| `failed` | `#D6492E` | `#FBEAE6` |

**Pricing provenance**

| State | FG hex | BG hex | Notes |
|---|---|---|---|
| `usda` / `verified` | `#2E9E6B` | `#E7F5EE` | "USDA verified" |
| `estimated` | `#8A6FB0` | `#F1ECF7` | Violet — deliberately distinct from status greens |
| `no_data` | `#94908A` | `#F1EFEA` | "No data" |
| `mock` | — | — | **Not depicted in design** — see STATE_VOCABULARY.md. Recommend reusing the `estimated` violet with a "mock" label, or a dashed-outline treatment. |

**Confidence**

| Level | FG hex | Pips lit (of 3) |
|---|---|---|
| `high` | `#2E9E6B` | 3 |
| `medium` | `#C0820B` | 2 |
| `low` | `#D6492E` | 1 |

### 1.4 Trend (price movement, buyer's POV)

| Direction | Token | Hex | Meaning |
|---|---|---|---|
| up | `--trend-up` | `#D6492E` | Price ↑ = **bad** for buyer → red |
| down | `--trend-down` | `#2E9E6B` | Price ↓ = **good** → green |
| flat | `--trend-flat` | `#94908A` | No change → grey |

### 1.5 Category tags (ingredient / distributor categories)

| Category | Hex |
|---|---|
| `produce` | `#3F9E6A` |
| `dairy` | `#C0820B` |
| `meat` | `#B5524A` |
| `seafood` | `#2E8FD6` |
| `drygoods` (dry goods) | `#8A6FB0` |

---

## 2. Typography

Three families, mapped by role. All load from Google Fonts (`next/font/google`) — see Assets note in README.

| Family | Token | Role |
|---|---|---|
| **Geist** | `--font-ui` | Body, UI, labels, buttons, form fields |
| **Geist Mono** | `--font-mono` | Numbers, prices, IDs, timers, code, table data (`font-variant-numeric: tabular-nums`) |
| **Newsreader** | `--font-serif` | Display & headlines, dish names, recommendation headline, section titles |

Fallback stacks:
```
--font-ui:    "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono:  "Geist Mono", ui-monospace, "SFMono-Regular", monospace;
--font-serif: "Newsreader", ui-serif, Georgia, serif;
```

### 2.1 Type scale (role → family / size / weight / line-height / tracking)

| Role | Family | Size | Weight | Line-height | Letter-spacing | Where |
|---|---|---|---|---|---|---|
| `display` | Newsreader | 46px (mobile 36px) | 500 | 1.08 | -0.022em | Start hero H1 |
| `h1` | Newsreader | 26px | 500 | 1.1 | -0.02em | "Live pipeline" title |
| `h2` | Newsreader | 22px | 500 | 1.15 | -0.01em | Panel titles |
| `h3` | Newsreader | 21px | 500 | 1.2 | -0.01em | Stage-detail title; rec headline = 24px |
| `h4 / dish` | Newsreader | 18px | 500 | 1.2 | -0.01em | Dish names, comparison-table title |
| `body` | Geist | 14.5px | 400 | 1.55 | 0 | Default paragraph / lede 16.5px |
| `body-strong` | Geist | 14px | 540* | 1.4 | 0 | Names, list titles |
| `body-sm` | Geist | 13px | 400 | 1.5 | 0 | Secondary copy |
| `caption` | Geist | 12–12.5px | 400 | 1.45 | 0 | Help text, metadata |
| `label` / `kicker` | Geist | 11px | 600 | 1 | 0.06–0.09em, UPPERCASE | Eyebrows, table heads, field labels |
| `button` | Geist | 14px (sm 12.5 / lg 16) | 540* | 1 | 0.005em | All buttons |
| `mono-data` | Geist Mono | 13px | 500 | 1 | 0 | Prices, terms, IDs (tabular-nums) |
| `mono-sm` | Geist Mono | 11–11.5px | 400–500 | 1 | 0 | Timestamps, source notes, attributions |
| `stat-number` | Geist Mono | 24px | 500 | 1 | -0.02em | Big metric numbers |
| `big-value` | Geist Mono | 20–22px | 500 | 1 | -0.02em | Basket total, savings |

\* **Weights 540/560** are optical mid-weights from the prototype. Geist ships variable; if you can't hit 540, use **500**; for 560 use **600**. Document choice once and stay consistent. Available Geist weights to load: 300, 400, 500, 600, 700.

---

## 3. Spacing

Base unit **4px** (Tailwind default scale covers most). The prototype also uses a few **odd values** — extend the scale or use arbitrary values:

`2, 3, 4, 5, 6, 7*, 8, 9*, 10, 11*, 12, 13*, 14, 16, 18*, 20, 22*, 24, 26*, 28, 36, 40, 44, 64, 80` (px). Starred = not on the default 4px grid.

| Use | Value |
|---|---|
| Card padding | 20px (`card-pad`); modal body 20–22px |
| Panel inner gap | 12–16px |
| Section vertical rhythm | 16–22px between blocks; 26px before comparison table |
| Page gutter (container) | 28px horizontal; max-width **1280px** |
| Start screen wrap | max-width 1040px; 64px top / 80px bottom |
| Topbar height | 60px; sticky offsets use `top: 76px` |
| Touch target (mobile) | ≥ 44px |

---

## 4. Border radius

| Token | Value | Usage |
|---|---|---|
| `--r-xs` | 7px | Inner chips, small buttons (sm) |
| `--r-sm` | 10px | Icon chips, segmented inner, steppers |
| `--r-md` | 14px | Buttons, inputs, cards (small), badges-on-cards |
| `--r-lg` | 18px | Cards, panels, map |
| `--r-xl` | 24px | Recommendation card, modal |
| `--r-pill` | 999px | Badges, chips, pills, avatars |

> Brand baseline radius is generous (≥12px on most components). Pills/avatars are fully round.

---

## 5. Shadows / elevation

| Token | Value | Usage |
|---|---|---|
| `--sh-1` | `0 1px 2px rgba(22,19,13,.04), 0 1px 1px rgba(22,19,13,.03)` | Resting cards, chips |
| `--sh-2` | `0 2px 4px rgba(22,19,13,.05), 0 4px 12px rgba(22,19,13,.04)` | Hover lift, primary button hover |
| `--sh-3` | `0 8px 24px rgba(22,19,13,.08), 0 2px 6px rgba(22,19,13,.05)` | Input card, recommendation card |
| `--sh-pop` | `0 18px 48px rgba(22,19,13,.16), 0 4px 12px rgba(22,19,13,.08)` | Modals |
| focus `--ring` | `0 0 0 3px color-mix(in oklch, var(--forest) 22%, transparent)` | Focus-visible ring on inputs/buttons |

Shadows are **soft, warm, low-spread** — never harsh black. The base shadow color is the ink (`22,19,13`) at low alpha.

---

## 6. Motion

| Token | Value | Usage |
|---|---|---|
| ease-standard | `cubic-bezier(.22,.61,.36,1)` | Entrance "rise" |
| durations | 120ms (micro), 150–180ms (hover/state), 300–420ms (entrance), 500ms (connector fill), 800ms (completeness bar) | — |
| `rise` | translateY(9px → 0), 420ms | Panel/card entrance (transform-only, never opacity-gates content) |
| `pulse-ring` | expanding box-shadow, 1.6–2s loop | Running stage, live Patty avatar, "you are here" map pin |
| count-up | 700ms cubic ease-out | Numbers settling in (guard with reduced-motion / visibility) |
| shimmer | 1.4s loop | Skeleton loaders |
| `dash-flow` | stroke-dashoffset loop, ~14s | Orbital active spoke |

> **Important porting note:** entrance reveals must **not** gate visibility on opacity (a paused/occluded tab freezes CSS animations at frame 0). Use transform-only entrances and initialize count-up numbers to their final value, animating down from 0 only when `document.visibilityState === 'visible'` and `prefers-reduced-motion: no-preference`.

---

## 7. Tailwind v4 `@theme` drop-in

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  /* surfaces */
  --color-background: #FFFBEB;
  --color-surface: #FFFFFF;
  --color-surface-2: #FCFCFA;
  --color-surface-3: #F7F6F1;
  --color-border: #E9E5DA;
  --color-border-strong: #CABFAD;

  /* text */
  --color-ink: #16130D;
  --color-ink-2: #3A352C;
  --color-muted: #6B6256;
  --color-faint: #B8B0A2;

  /* brand */
  --color-forest: oklch(25% 0.08 152);     /* #16432B */
  --color-forest-hi: oklch(31% 0.085 152); /* #1E5638 */
  --color-forest-lo: oklch(20% 0.07 152);  /* #0F3221 */
  --color-patty: #57BD86;
  --color-patty-ink: #3F9E6A;
  --color-sage: #A8D9BE;
  --color-mint: #F1F7F3;
  --color-mint-deep: #E6F3E6;

  /* status — foreground / background pairs */
  --color-st-pending: #94908A;   --color-st-pending-bg: #F1EFEA;
  --color-st-running: #2E8FD6;   --color-st-running-bg: #E8F3FC;
  --color-st-done: #2E9E6B;      --color-st-done-bg: #E7F5EE;
  --color-st-error: #D6492E;     --color-st-error-bg: #FBEAE6;
  --color-st-warn: #C0820B;      --color-st-warn-bg: #FBF2DC;

  /* provenance */
  --color-pv-verified: #2E9E6B;  --color-pv-verified-bg: #E7F5EE;
  --color-pv-estimated: #8A6FB0; --color-pv-estimated-bg: #F1ECF7;
  --color-pv-nodata: #94908A;    --color-pv-nodata-bg: #F1EFEA;

  /* confidence */
  --color-cf-high: #2E9E6B;
  --color-cf-med: #C0820B;
  --color-cf-low: #D6492E;

  /* trend */
  --color-trend-up: #D6492E;
  --color-trend-down: #2E9E6B;
  --color-trend-flat: #94908A;

  /* category */
  --color-cat-produce: #3F9E6A;
  --color-cat-dairy: #C0820B;
  --color-cat-meat: #B5524A;
  --color-cat-seafood: #2E8FD6;
  --color-cat-drygoods: #8A6FB0;

  /* fonts */
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --font-serif: "Newsreader", ui-serif, Georgia, serif;

  /* radii */
  --radius-xs: 7px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;

  /* shadows */
  --shadow-sh1: 0 1px 2px rgb(22 19 13 / .04), 0 1px 1px rgb(22 19 13 / .03);
  --shadow-sh2: 0 2px 4px rgb(22 19 13 / .05), 0 4px 12px rgb(22 19 13 / .04);
  --shadow-sh3: 0 8px 24px rgb(22 19 13 / .08), 0 2px 6px rgb(22 19 13 / .05);
  --shadow-pop: 0 18px 48px rgb(22 19 13 / .16), 0 4px 12px rgb(22 19 13 / .08);
}

@layer base {
  body { background: var(--color-background); color: var(--color-ink); font-family: var(--font-sans); }
  .tnum { font-variant-numeric: tabular-nums; }
}
```

Usage examples: `bg-background`, `bg-surface`, `text-ink`, `text-muted`, `border-border`, `bg-forest text-white`, `bg-mint text-forest`, `text-patty-ink`, `rounded-lg`, `shadow-sh1`, `font-serif`, `font-mono tnum`, and status via `text-st-running bg-st-running-bg`.
