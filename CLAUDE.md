# Pathway RFP Pipeline — Project Doctrine

> Read this first. Every contributor and every Claude subagent reads this on entry. Keep it short, current, and prescriptive.

## Product vision

A "miniature Patty" — an autonomous procurement agent for restaurants. Given a menu and address, the system parses dishes into an ingredient basket, prices it against USDA market data, finds local distributors, sends RFP emails, monitors inbound replies, follows up on silence, and recommends the best award. **Every stage runs programmatically end-to-end — nothing manual.**

Reference: [workwithpathway.com](https://workwithpathway.com) — Patty is the production product; this is a faithful smaller-scoped clone for evaluation.

## What graders care about

1. **System design & schema design** — Convex tables, enums, indices, idempotency keys.
2. **Code clarity** — small pure functions, narrow abstractions, no premature generality.
3. **Graceful failure** — vague dish names, missing prices, missing distributors, bounced emails, malformed quotes. Never crash; always advance with a degraded-but-honest result.

## Tech stack (non-negotiable)

- **Frontend:** Next.js 15 App Router, TypeScript strict, Tailwind CSS v4, deployed on Vercel.
- **Backend & DB:** Convex.dev (reactive queries, mutations, actions, httpActions, crons).
- **LLM:** Anthropic Claude via `@anthropic-ai/sdk` (menu parsing, quote parsing). Always wrap structured output with **Zod**.
- **Email:** Maileroo (`https://smtp.maileroo.com/api/v2`) for outbound + inbound webhooks. Plain `fetch`, no SDK.
- **Pricing:** USDA Market News MARS API (`marsapi.ams.usda.gov`).
- **Distributors:** Google Places API (New) Text Search; seeded mock fallback.
- **Validation:** Zod everywhere structured data crosses a boundary (LLM out, HTTP in, action args).

## Architecture (5 stages)

A `run` row owns ordered `stages[]`. Each stage transitions `pending → running → done | error` and is driven by Convex actions/crons, not the client.

1. **parse_menu** — Claude reads menu text/URL/upload → dishes + ingredients + qty estimates + confidence.
2. **fetch_pricing** — USDA MARS lookup per ingredient → price/unit/trend/provenance (`usda | estimated | no_data`).
3. **find_distributors** — Google Places Text Search filtered by category + radius; falls back to seeded mocks.
4. **send_rfps** — Maileroo Email API per distributor; thread row tracks `queued/sent/replied/followed_up/failed`.
5. **collect_quotes** — Maileroo inbound webhook → Claude parses reply → quote row; agent compares; recommendation emitted.

The UI is a near-pure render of run state. The pipeline animation in the design is replaced by **real Convex reactivity** — stages light up as the backend writes them.

## Convex patterns (use exactly these)

- **`query`** — pure reactive reads. No external IO. No `Date.now()` in returned values that the client compares.
- **`mutation`** — transactional writes. Pure functions of `(ctx, args)`. Never call external APIs.
- **`action`** — the only place external IO happens (Anthropic, USDA, Maileroo, Places). Actions call mutations to persist results.
- **`httpAction`** — webhook endpoints. Maileroo inbound posts here. Verify authenticity by calling the payload's `validation_url` exactly once before acting.
- **`cron`** — the agent loop (e.g. every 60s: scan threads needing follow-up, scan quotes pending parse).
- **Idempotency:** every external write keyed by a stable `idempotencyKey` (e.g. `${runId}:${distributorId}:rfp` for outbound email; Maileroo `message_id` for inbound). Re-running must not duplicate.
- **Schema-first:** every new field starts in `convex/schema.ts` with `v.union(v.literal(...), ...)` enums matching `design-reference/STATE_VOCABULARY.md`.

## Coding conventions

- **TypeScript strict.** No `any`. Prefer `unknown` + Zod parse at boundaries.
- **Small pure functions.** If a function does IO and computation, split it: action does IO, helper does computation, mutation persists. Pure helpers live next to their action, exported for unit reuse.
- **No premature abstraction.** Three call sites before a helper.
- **Errors as data.** Stage failure writes a `stage.status = "error"` with a human-readable `error.message`. Never throw to the client.
- **Zod schemas live in `convex/lib/schemas.ts`** and are reused by both LLM output validation and action args where natural.
- **Naming:** Convex files plural (`runs.ts`, `quotes.ts`); functions named `getRun`, `listRuns`, `startRun`, `appendStageEvent`, `sendRfp`.
- **No client → external IO.** Browser only talks to Convex.

## Environment variables

See `.env.example` for the full list with sourcing notes. Two rules:

- Keys consumed in **browser** code use `NEXT_PUBLIC_` prefix (only `NEXT_PUBLIC_CONVEX_URL`).
- Keys consumed in **Convex actions/httpActions must be set in the Convex environment** with `npx convex env set <KEY> <value>` — `.env.local` alone is not enough. Setting both is fine; the Convex env is authoritative server-side.

Required:

- `ANTHROPIC_API_KEY` — Claude (Convex env).
- `USDA_MARS_API_KEY` — USDA MARS (Convex env).
- `MAILEROO_SENDING_KEY` — Maileroo Email API (Convex env).
- `MAIL_DOMAIN` — verified sending domain in Maileroo (Convex env).
- `GOOGLE_PLACES_API_KEY` — Places New Text Search (Convex env).
- `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` — written by `npx convex dev`.

Maileroo inbound: **no signing secret exists**. Authenticity is confirmed by calling the payload's `validation_url` once. Do not invent an env var for this.

## Glossary

- **RFP (Request for Proposal):** the outbound email asking a distributor to quote specific items.
- **Distributor:** a wholesale supplier we're soliciting (e.g. Lombardi Specialty Foods).
- **Quote:** the distributor's reply with per-item pricing, terms, lead time. Parsed by Claude from free-form email.
- **Recipe / Dish:** a menu item; decomposed into ingredient lines with estimated weekly quantities.
- **Basket:** the deduped ingredient demand across all dishes — what we price and procure.
- **Provenance:** the source label on a price (`usda`, `estimated`, `no_data`) or a distributor (`verified`, `estimated`).

## Definition of done (per phase)

A phase is done when:

1. The schema deltas are merged and `npx convex dev` is green.
2. The relevant action(s) can be invoked from the Convex dashboard and produce the expected row writes.
3. The UI renders the new state reactively (no manual refresh).
4. Failure path is exercised at least once (e.g. force `no_data`, force a bounce, force a low-confidence parse) and the UI degrades gracefully.
5. `pnpm typecheck` and `pnpm lint` pass.

## What lives where

- `app/` — Next.js routes and screens.
- `components/` — pure presentational components; receive run state as props.
- `lib/data.ts` — design-reference seed data (Trattoria Lucia). Used by the "Load sample" button and tests.
- `convex/schema.ts` — single source of truth for table shapes and enums.
- `convex/<domain>.ts` — queries/mutations/actions for that domain.
- `convex/lib/` — pure helpers and external-API clients.
- `design-reference/` — untouched design package; treat as read-only.

## What NOT to do

- Don't call Anthropic / USDA / Maileroo / Places from a Convex `query` or `mutation`. Actions only.
- Don't put secrets in `NEXT_PUBLIC_*`.
- Don't import from `convex/_generated/` in non-Convex code except via the typed client.
- Don't add UI-only state to Convex (e.g. modal-open flags). Client state stays client.
- Don't duplicate the design tokens — read from `globals.css` `@theme` only.

## Build phases (post-scaffold)

Phase 1 (sequential, blocks all): schema + run lifecycle (`runs.ts`, `getRun`, `createRun`, `appendStageEvent`, "Load sample" seed).

Phases 2/3/4 can be built in parallel by subagents (disjoint files):

- Phase 2: `parse_menu` (`convex/menus.ts`, `convex/lib/anthropic.ts`, `convex/lib/schemas.ts`)
- Phase 3: `fetch_pricing` (`convex/pricing.ts`, `convex/lib/usda.ts`)
- Phase 4: `find_distributors` (`convex/distributors.ts`, `convex/lib/places.ts`)

Sequential after fan-in:

- Phase 5: `send_rfps` (`convex/emails.ts`, `convex/lib/maileroo.ts`) — depends on 2 + 4.
- Phase 6: inbound + quote parsing + cron agent (`convex/http.ts`, `convex/quotes.ts`, `convex/agent.ts`, `convex/crons.ts`) — depends on 5.
- Phase 7: wire design components to live state, ApproveModal mutation, Vercel deploy, README.
