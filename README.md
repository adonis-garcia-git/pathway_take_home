# Pathway RFP Pipeline

An autonomous procurement agent ("mini-Patty") for restaurants. Parses a menu → prices the ingredient basket → finds local distributors → emails RFPs → monitors replies → recommends the best award. End-to-end programmatic; no manual steps.

Built with **Next.js 15 (App Router) + TypeScript + Tailwind v4 + Convex + Claude + Zod**.

## Quickstart

```bash
pnpm install
cp .env.example .env.local

# Convex (interactive: pick "create new project")
npx convex dev

# In another terminal:
pnpm dev
```

Then open <http://localhost:3000>.

Set every Convex-side key in the Convex environment too:

```bash
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set USDA_MARS_API_KEY <key>
npx convex env set MAILEROO_SENDING_KEY <key>
npx convex env set MAIL_DOMAIN <domain>
npx convex env set GOOGLE_PLACES_API_KEY <key>
```

## Docs

- **[CLAUDE.md](./CLAUDE.md)**: project doctrine: architecture, Convex patterns, coding conventions, glossary, definition-of-done.
- **[.env.example](./.env.example)**: every env var, where to get it, where it lives.
- **[design-reference/](./design-reference/)**: read-only design package: tokens, component spec, state vocabulary, seed data.

## Scripts

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Next.js dev server                      |
| `pnpm build`         | Production build                        |
| `pnpm typecheck`     | `tsc --noEmit`, strict                  |
| `pnpm lint`          | ESLint (Next + Prettier)                |
| `pnpm convex:dev`    | Convex dev deployment + codegen watcher |

## How to demo end-to-end

The pipeline is fully autonomous once a run is created. The fastest way to see all five stages plus a recommendation:

1. **Load Sample** on the start screen seeds the Trattoria Lucia menu (Lower Manhattan address) and starts a run. Stages 1 to 4 advance on their own. Watch the timeline.
2. After stage 4 (`send_rfps`) finishes, stage 5 (`collect_quotes`) waits for inbound replies. To skip the real inbound wait, open the Convex dashboard and run `email:demoReplyForRun` with `{ runId: "<latest>" }`. You can grab the runId from `pipelineRuns:latestRun`.
3. About 10 seconds later, stage 5 completes and the recommendation card renders. Open the Approve modal to finalize the award.

For visible agent behavior (follow-ups, nudges) without waiting for the 5-minute cron, open the **Demo controls** panel inside stage 5 in dev mode and click any of the three buttons.

## What's real vs. what's seeded

| Layer                              | Real | Seeded                                                                  |
| ---------------------------------- | :--: | ----------------------------------------------------------------------- |
| Menu parse (Claude)                | yes  | none                                                                    |
| USDA pricing                       | yes  | falls back to category averages if `USDA_MARS_API_KEY` is unset         |
| Google Places distributor lookup   | yes  | mock catalog fills gaps; Places does not return contact emails          |
| Maileroo outbound send             | yes  | `mock:*` sentinel ID if `MAILEROO_SENDING_KEY` or `MAIL_DOMAIN` is unset |
| Maileroo inbound webhook + DMARC   | yes  | none                                                                    |
| Quote parse (Claude)               | yes  | none                                                                    |
| Recommendation scoring             | yes  | generic weights (0.5 price, 0.35 completeness, 0.15 terms)              |
| `demoReplyForRun` action           |  no  | basket-aware reply generator used only for grading walkthroughs         |
| Demo controls (missing-info, etc.) |  no  | dev-only Convex actions, gated by `NODE_ENV !== "production"`           |

Every demo helper lives in `convex/email.ts` (`demo*` actions) or `convex/lib/demoPricing.ts`. The production webhook path (Maileroo POST → `convex/http.ts` → `recordInboundQuote` → `parseInboundQuote` → `generateRecommendation`) does not import any demo code.

## Known limitations

- **Restaurant address geocoding** uses OpenStreetMap Nominatim (free, no key). The Trattoria sample keeps a hardcoded NYC point so Load Sample never depends on a network call. Any pasted address goes through Nominatim with a 1-second timeout; on failure it falls back to (0, 0) and Places search still works off the raw address string.
- **Google Places** does not expose distributor contact emails. We scrape the distributor's website for the first `mailto:` link (homepage, then `/contact`, then `/contact-us`) and store whatever we find. Coverage depends on the site; rows where nothing is found stay as `contactStatus: "needs_enrichment"` and are skipped at send time. Set `DEMO_REDIRECT_INBOX` to a Maileroo-routable address you control so the demo never actually emails real distributors; the real email is preserved in the data model and shown in Stage 4 with a "via demo redirect" overlay.
- **Agent cadence** is cron-bound at 5 minutes. The earlier self-scheduling design caused exponential scheduled-function fan-out and was replaced with the simpler heartbeat. To exercise the follow-up and nudge paths without waiting, use the Demo controls panel.
- **USDA pack units**: MARS quotes prices in pack units that vary by report (cwt, 25 lb carton, 24 ct carton, bushel, dozen, each). We normalize the common, unambiguous packs to per-lb or per-each so the displayed weekly basket math is honest. Opaque packs (a bare `carton` with no stated size) are flagged and asked of distributors directly instead of being multiplied through. The pack table lives in `convex/lib/units.ts`. To confirm USDA report slugs against your own key, run `marsProbe:probeMarsReports` from the Convex dashboard.
