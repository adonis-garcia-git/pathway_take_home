# Pathway RFP Pipeline

A miniature Patty. Given a restaurant menu and an address, the system parses dishes into an ingredient basket, prices them against USDA market data, finds local distributors, sends RFP emails, monitors inbound replies, follows up on silence, and recommends the best award. Every stage runs programmatically end-to-end. Nothing manual.

The production reference is [workwithpathway.com](https://workwithpathway.com). This repo is a faithful, smaller-scoped clone built for take-home evaluation.

Stack: **Next.js 15 App Router · TypeScript strict · Tailwind v4 · Convex · Anthropic Claude · Zod · Maileroo · USDA MARS · Google Places**.

---

## Links

- **Demo (Vercel):** _set after deploy_
- **Loom walkthrough:** _set after recording_
- **Loom script:** [`docs/loom-script.md`](./docs/loom-script.md)
- **Project doctrine:** [`CLAUDE.md`](./CLAUDE.md)
- **Design package:** [`design-reference/`](./design-reference/)
- **Menu source provenance:** [`docs/source.md`](./docs/source.md)

---

## The five stages

Each stage is owned by a single Convex action, persists through mutations, and surfaces in the UI through a reactive query. A `pipelineRuns` row holds an ordered `steps[]` array; each step transitions `pending → running → done | error`.

1. **parse_menu** ([`convex/pipeline/parseMenu.ts`](./convex/pipeline/parseMenu.ts), helpers in [`convex/menus.ts`](./convex/menus.ts)). Claude reads the raw menu (text, URL, image, or PDF) under forced tool use, returning a Zod-validated list of dishes with per-ingredient estimated quantities, estimated weekly servings, and a per-row confidence. URL inputs are fetched, stripped to text under a 40 KB cap, and run through Haiku 4.5 first with a Sonnet 4.6 fallback if structured output fails. Low-confidence rows are flagged `needsReview` rather than dropped.
2. **fetch_pricing** ([`convex/pricing.ts`](./convex/pricing.ts), helpers in [`convex/lib/usda.ts`](./convex/lib/usda.ts) and [`convex/lib/units.ts`](./convex/lib/units.ts)). Each canonical ingredient is mapped to a USDA MARS commodity slug (`FVWRETAIL` and `NX_FV020`), fuzzy-matched against the latest report rows with [`fuzzball`](https://www.npmjs.com/package/fuzzball), and normalized through a curated pack table to per-lb or per-each. Missing matches fall back to a category-level estimate, then to `no_data`. Every row carries a provenance pill: `usda`, `estimated`, or `no_data`.
3. **find_distributors** ([`convex/distributors.ts`](./convex/distributors.ts), helpers in [`convex/lib/places.ts`](./convex/lib/places.ts) and [`convex/lib/emailScrape.ts`](./convex/lib/emailScrape.ts)). Google Places New Text Search is queried per category around the geocoded restaurant address (Nominatim, 1-second timeout, seeded fallback for the sample). Distributor websites are scraped for the first `mailto:` link on the home page, then `/contact`, then `/contact-us`. Distributors with no email become `contactStatus: "needs_enrichment"` and are skipped at send time.
4. **send_rfps** ([`convex/emails.ts`](./convex/emails.ts), helpers in [`convex/lib/maileroo.ts`](./convex/lib/maileroo.ts) and [`convex/lib/rfpTemplate.ts`](./convex/lib/rfpTemplate.ts)). Per recipient, the system renders a plain-text RFP, computes a deterministic `mailerooMessageId` from `${runId}:${distributorId}:rfp`, and POSTs to Maileroo. Re-runs are safely idempotent. If `DEMO_REDIRECT_INBOX` is set, mail goes to that inbox with the real recipient surfaced in the UI as a "via demo redirect" overlay.
5. **collect_quotes** ([`convex/quotes.ts`](./convex/quotes.ts), webhook in [`convex/http.ts`](./convex/http.ts), recommendation engine in [`convex/recommendations.ts`](./convex/recommendations.ts), agent loop in [`convex/agent.ts`](./convex/agent.ts) and [`convex/crons.ts`](./convex/crons.ts)). Maileroo POSTs inbound replies to a Convex `httpAction`; authenticity is confirmed by calling the payload's `validation_url` exactly once. Claude parses the free-form reply into Zod-validated line items, terms, and lead time. The recommendation engine joins quotes against the basket, derives a weekly total when the distributor did not state one, and scores on price, completeness, and terms. A 5-minute cron drives follow-ups and nudges. The human gate is `approveRecommendation`.

---

## Architecture

```
+----------------------------------------------------------------------------+
|                       Browser  (Next.js 15 App Router)                     |
|   StartScreen  →  LivePipeline  →  stages/*  →  ApproveModal               |
+----------------------------------------------------------------------------+
                |  reactive Convex queries / mutations only
                v
+----------------------------------------------------------------------------+
|                                  Convex                                    |
|                                                                            |
|    queries          mutations            actions                  cron     |
|    (read-only,      (transactional       (only IO boundary)    every 5m   |
|     reactive)        writes)              calls Anthropic,       agent.tick|
|                                            USDA, Places,         scans for |
|                                            Maileroo)             silence,  |
|                                                                  nudges    |
|                                                                            |
|    httpAction                                                              |
|      /maileroo/inbound   <-- inbound webhook, validates via                |
|                              payload.validation_url                        |
|                                                                            |
|                  +------------------------------+                          |
|                  |       pipelineRuns row       |                          |
|                  |  steps[5]: parse_menu …      |                          |
|                  |  collect_quotes              |                          |
|                  +---^---^---^---^---^---^------+                          |
|   runParseMenuAction  |   |   |   |                                        |
|        runFetchPricing |   |   runSendRfps                                 |
|           runFindDistributors    runCollectQuotes                          |
+----------------------------------------------------------------------------+
   |             |               |              |                |
   v             v               v              v                v
+--------+   +--------+   +--------------+   +----------+   +-------------+
| Claude |   |  USDA  |   | Google       |   | Maileroo |   |  Maileroo   |
| (Haiku |   |  MARS  |   | Places (New) |   | Send API |   |  Inbound    |
|+Sonnet |   |        |   | + Nominatim  |   |          |   |  Webhook    |
| fall)  |   |        |   |              |   |          |   |             |
+--------+   +--------+   +--------------+   +----------+   +-------------+
```

The browser only talks to Convex. External IO only happens inside actions and `httpActions`. The cron `agent.tick` is the only autonomous loop; everything else is event-driven.

---

## Schema (ER)

```
restaurants (1) ───< (N) menus (1) ───< (N) dishes (1) ───< (N) dishIngredients
                                                                  │
                                                                  │ (N)
                                                                  v
                                                       ingredients [canonicalName: unique]
                                                                  │
                                                                  │ (1)
                                                                  v
                                                         ingredientPrices
                                                         (time-series append,
                                                          source: usda_mars |
                                                          usda_nass |
                                                          estimated | mock)

distributors (1) ───< (N) distributorCategories                  rfps (1) ──┐
   │   source: google_places | mock                                          │
   │   contactStatus: verified | needs_enrichment                           (N)
   │                                                                        v
   └────────────────────────< (N) rfpRecipients ───< (N) quotes  rfpRecipients
                              emailStatus: queued |       parsed by Claude,
                              sent | replied |            totalPrice may be
                              followed_up | failed        derived at read time

pipelineRuns (1) ───< (1) recommendations
   │   currentStep: parse_menu | … | collect_quotes | done | error
   │   steps[]: { step, status, startedAt, finishedAt, summary, error }
   │
   └────────────────────────────────────< (N) agentEvents
                                            kind: tick_scan | follow_up_sent |
                                            nudge_sent | quote_received |
                                            quote_parsed |
                                            recommendation_written |
                                            scheduled | send_failed

agentSchedule (singleton, optional debounced helper, unused in cron path)
```

Notable patterns:

- **Deduped ingredient master.** `ingredients.canonicalName` is unique. `dishIngredients` is the join row carrying the per-dish raw name, estimated quantity, and unit. Two dishes that both use "Roma tomato" share one `ingredients` row.
- **Time-series prices.** `ingredientPrices` is append-only, keyed `(ingredientId, reportDate)`. Refreshing USDA inserts; the UI always reads the latest.
- **Derived weekly total.** `quotes.totalPrice` is optional. When missing, `recommendations.comparisonTable` derives it from `Σ(line.price × basket.quantity)` over available, priced, matched lines.
- **Idempotency.** Outbound emails key on `${runId}:${distributorId}:rfp`. Inbound emails key on Maileroo's `message_id`. Re-runs do not duplicate.

The single source of truth is [`convex/schema.ts`](./convex/schema.ts).

---

## Setup

### a. Prerequisites

- Node 20+
- pnpm 11+
- A free Convex account
- The five API keys below

### b. Get the keys

| Key | Where | Free tier | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | starter credit | Menu parse, quote parse, demo reply gen. Haiku 4.5 with Sonnet 4.6 fallback. |
| `USDA_MARS_API_KEY` | [marsapi.ams.usda.gov](https://marsapi.ams.usda.gov/) | free, email signup | MARS reports `3324 FVWRETAIL` and `2315 NX_FV020`. |
| `GOOGLE_PLACES_API_KEY` | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) | $200/mo credit | Enable *Places API (New)*. Restrict to the API + your IPs in production. |
| `MAILEROO_SENDING_KEY` | [app.maileroo.com](https://app.maileroo.com) → Sending → API Keys | free dev sender | Outbound RFP emails. |
| `MAIL_DOMAIN` | Maileroo → Domains → Add | needs DNS access | Verified sending domain (e.g. `mail.yourdomain.com`). |

### c. Run it (fresh clone)

```bash
git clone <this repo>
cd pathway_take_home
pnpm install
cp .env.example .env.local

# Convex auth + deployment picker. Writes CONVEX_DEPLOYMENT
# and NEXT_PUBLIC_CONVEX_URL into .env.local.
npx convex dev

# In a second terminal, set every secret in the Convex env.
# This is authoritative for server-side keys; .env.local alone
# does not reach Convex.
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set USDA_MARS_API_KEY <key>
npx convex env set MAILEROO_SENDING_KEY <key>
npx convex env set MAIL_DOMAIN <verified-domain>
npx convex env set GOOGLE_PLACES_API_KEY <key>

# Optional demo levers
npx convex env set AGENT_TIME_SCALE 60                    # compress 30 min nudges to ~30 s
npx convex env set DEMO_REDIRECT_INBOX you@example.com    # route all outbound RFPs here

# Boot Next
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click **Use sample · Trattoria Lucia**, hit **Run RFP Pipeline**, and watch the five stages light up reactively.

### d. Configure inbound (optional for graders)

In Maileroo, point an MX-routable address at the deployed Convex HTTP endpoint `${CONVEX_SITE_URL}/maileroo/inbound`. The handler authenticates by calling the payload's `validation_url` once. There is no shared secret to set. For graders, leave inbound off and let the auto-simulator fire synthetic replies on Stage 5 entry.

---

## Menu source

The headless demo (`pnpm demo`) runs against a real, citeable restaurant:

- **Frankies 457 Spuntino**, 457 Court St, Brooklyn, NY 11231 (Carroll Gardens).
- Live menu: <https://frankies457.com/menu>
- **Wayback snapshot (recommended for graders):** <https://web.archive.org/web/2025/https://frankies457.com/menu>

The seed text in [`convex/lib/seedData.ts`](./convex/lib/seedData.ts) is a representative transcription. Full provenance, lat/lng, and reproducibility notes are in [`docs/source.md`](./docs/source.md).

The in-app **Use sample · Trattoria Lucia** button uses a short fictional menu derived from the design package so the pipeline can be exercised without leaving the browser.

---

## Design decisions and tradeoffs

### 1. Why Convex

Reactive queries replace polling, mutations are transactional, actions are the only IO boundary, `httpActions` host webhooks, crons run the agent. The pipeline animation in the design package becomes literally "watch Convex push state to the client" rather than a CSS lie. Tradeoff: more vendor lock-in than Postgres plus a queue, and less control over connection-level retry. Mitigated by keeping `convex/lib/*.ts` as pure helpers reusable elsewhere.

### 2. Document-relational schema

Convex tables are document-shaped, but I use them like a normalized relational store. `ingredients` is a deduped master keyed by `canonicalName`. `dishIngredients` is the join carrying the per-dish raw name and quantity. `ingredientPrices` is a time-series append keyed `(ingredientId, reportDate)`. This makes USDA refreshes cheap (insert, do not mutate) and lets the comparison query derive weekly totals from `price × qty` without a stored aggregate. Tradeoff: more joins at read time than a denormalized run snapshot would need. The shape pays off the moment the same ingredient recurs across runs.

### 3. USDA commodity-level granularity, fuzzy match, fallback

USDA MARS reports prices at commodity granularity (e.g. "Tomatoes, Round, Red, 25-lb carton"), not SKU. The system maps each parsed ingredient to a commodity slug via a curated table ([`convex/lib/usda.ts`](./convex/lib/usda.ts)) plus a pack-unit normalizer ([`convex/lib/units.ts`](./convex/lib/units.ts)), then fuzzy-matches with `fuzzball`. If no row, we fall back to a category-level estimate and tag `source: "estimated"`. If even that fails, we emit `source: "no_data"` and the UI renders an en dash. Tradeoff: the displayed number is honest about its provenance, at the cost of looking less "authoritative" than a black-box average would. A user can audit any row back to the report slug it came from.

### 4. Why Maileroo for send and inbound (vs React Email or Resend)

A closed-loop RFP system needs transactional send and a real inbound webhook on the same verified domain. Maileroo offers both on one free tier. Reply tracking uses a per-recipient address pattern. The inbound route deliberately runs with DKIM, SPF, and DMARC enforcement **off** at the Maileroo route level for demo reliability (grader inboxes and reply-via clients vary wildly), and instead validates authenticity *in-handler* by calling the payload's `validation_url` exactly once and reading the `is_dmarc_aligned` and `is_spam` flags. In production those filters move up to the route. Tradeoff vs React Email plus Resend: Maileroo is less polished for HTML templating, but templating is solved; inbound is the actually-hard part. Outbound bodies here are short plain-text RFPs, so React Email would buy nothing.

### 5. Distributor sourcing (no mocks)

The system hits Google Places live and scrapes the first `mailto:` link from each distributor's website, falling through to `/contact` and `/contact-us`. Distributors with no discoverable email become `contactStatus: "needs_enrichment"` and are skipped at send time. There are no mock distributors in the recommendation path. Tradeoff: a sparse Places area produces a quieter Stage 4. That is the point. Fake distributors poison the recommendation downstream.

### 6. The autonomous vs human-approval boundary

The cron-driven agent ([`convex/agent.ts`](./convex/agent.ts), 5-minute heartbeat with a per-run debounce) is autonomous for *reversible* actions: sending follow-ups on silence, parsing inbound quotes, marking stale, writing recommendations. It is **not** autonomous for the award. `recommendations.needsHumanApproval` defaults true; the UI's `ApproveModal` is the only gate that flips it. This mirrors Patty's production posture: agents do the legwork, humans authorize spend.

---

## What is real vs seeded

| Stage | Real call | Graceful fallback |
|---|---|---|
| parse_menu | Anthropic Claude (Haiku → Sonnet) | low-confidence rows flagged for review; never crashes |
| fetch_pricing | USDA MARS API | category estimate, then `no_data`; provenance pill on every row |
| find_distributors | Google Places + Nominatim + website email scrape | empty Stage 4 if no live results (no mocks) |
| send_rfps | Maileroo Email API | per-recipient `failed` status surfaced in UI; idempotency on retry |
| collect_quotes | Maileroo inbound webhook + Claude parse | auto-simulator fires synthetic replies on stage entry for grading |

`demoReplyForRun`, `demoLlmReplyForRun`, and the Demo Controls panel are dev-only Convex actions gated by `NODE_ENV !== "production"` and `DISABLE_DEMO_CONTROLS`. The production webhook path (Maileroo POST → [`convex/http.ts`](./convex/http.ts) → `recordInboundQuote` → `parseInboundQuote` → `generateRecommendation`) does not import any demo code.

---

## What I would build next

Two threads, both chosen to echo what Pathway's Staff Engineer role describes.

### A. Simulation and what-if

The current run is a single shot. The next obvious surface is *what would change* if we swap a distributor, accept a partial split, or weight on lead time vs price. Concretely: a `runSnapshots` table cloning `rfps → quotes → recommendations` at decision time, plus a what-if query that re-runs the recommendation scorer against an edited basket without re-sending RFPs. The UI would render a side-by-side under the recommendation card. This is the decision-support layer a procurement team actually opens day to day, and it is a closer match to how production Patty helps an operator think.

### B. Safe autonomous execution

Today the human gate is the award. The natural next gate is *spend itself*. Once an award is approved, the system should be able to place the order (EDI, distributor portal, or email confirmation depending on partner). The safe path: a typed action layer with explicit invariants (max order $, max delta vs baseline, freshness check on the underlying USDA row, distributor reputation floor) wrapped in a single `executeAward` action that requires a signed approval token and writes an immutable, hash-chained audit log. Schema-wise: an `awards` table with `state: proposed | approved | dispatched | confirmed | reconciled` and a kill switch on `agentSchedule`. The work mirrors what I read about Pathway's direction: from agent-recommends-human-executes to agent-executes-within-envelope-human-reviews-exceptions.

---

## Repo layout

```
app/                  Next.js routes and screens
components/           Pure presentational components; receive run state as props
convex/               Convex backend
  schema.ts           Single source of truth for tables and enums
  pipeline/*.ts       The five stage actions
  lib/*.ts            Pure helpers + external API clients
  http.ts             Maileroo inbound webhook
  crons.ts            5-minute agent heartbeat
  agent.ts            Tick logic for follow-ups, nudges, recommendations
docs/                 source.md, loom-script.md, schema.md, usda-mapping.md,
                      maileroo-setup.md, distributor-seed.md, resilience.md
design-reference/     Read-only design package (tokens, components, vocab)
lib/                  Shared client utilities
scripts/              check-em-dashes.mjs, demo.ts
```

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm convex:dev` | Convex dev deployment + codegen watcher |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm lint` | ESLint + em-dash check |
| `pnpm test` | Vitest (helpers + Convex action boundaries via `convex-test`) |
| `pnpm demo` | Headless full-pipeline run against Frankies 457 seed |

---

## Tests

`pnpm test` runs the Vitest suite covering pure helpers (USDA fuzzy match, pack normalization, recommendation scoring, demo pricing, em-dash check) and Convex action boundaries through `convex-test`. The current count is 61 passing. Test files live under `__tests__/` next to the code they exercise.

---

## Deployment

The app deploys cleanly to Vercel with platform defaults; no `vercel.json` or `vercel.ts` is needed. The flow:

1. `npx convex deploy` from the repo root. Capture the production `NEXT_PUBLIC_CONVEX_URL` from the output.
2. In Vercel, set `NEXT_PUBLIC_CONVEX_URL` as a project env var. Push the branch and Vercel will build with `pnpm build`.
3. Convex secrets stay in the Convex env (`npx convex env set …`); they are never exposed to Vercel or the browser.

---

## Acknowledgements

The Pathway team for a clear take-home brief and a tight, opinionated design package.
