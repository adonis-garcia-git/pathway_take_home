# End-to-end test plan for the Pathway RFP Pipeline

Run these in order. Each block lists the command, what to look for, and what it proves.

---

## 0. Prerequisites

```bash
pnpm install
cp .env.example .env.local      # if not already done
```

Fill in `.env.local` with at minimum `NEXT_PUBLIC_CONVEX_URL` (written by `npx convex dev` on first run). For the live demo paths (steps 7 to 11) you also need:

- `ANTHROPIC_API_KEY`
- `USDA_MARS_API_KEY`
- `MAILEROO_SENDING_KEY` and `MAIL_DOMAIN` (verified sender)
- `GOOGLE_PLACES_API_KEY`

Set these on the Convex side too (Convex env is authoritative server-side):

```bash
npx convex env set ANTHROPIC_API_KEY <key>
npx convex env set USDA_MARS_API_KEY <key>
npx convex env set MAILEROO_SENDING_KEY <key>
npx convex env set MAIL_DOMAIN <domain>
npx convex env set GOOGLE_PLACES_API_KEY <key>
```

---

## 1. Static checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expect:
- `pnpm typecheck` exits 0 with no errors.
- `pnpm lint` runs `next lint` then `node scripts/check-em-dashes.mjs`. Only the two pre-existing `<img>` warnings on `components/ui.tsx` lines 19 and 22 should appear. Exit 0.
- `pnpm build` ends with "Compiled successfully".

Proves: types, lint, typography rule, and production bundle are clean.

---

## 2. Unit + integration tests

```bash
pnpm test
```

Expect: 47 of 47 tests pass across 5 files (units, fuzzy, aggregate, recommendation, pipeline.integration).

Proves: aggregation, USDA fuzzy match, recommendation scoring, and the end-to-end Convex pipeline (with external calls mocked) all work.

---

## 3. Typography lint regression

Insert a real em dash into a scoped file, then revert:

```bash
node -e "const fs=require('fs');const f='components/ui.tsx';fs.appendFileSync(f,'\nexport const _canary = \"violation \\u2014 here\";\n');"
pnpm lint ; echo "exit=$?"
git checkout components/ui.tsx
pnpm lint ; echo "exit=$?"
```

Expect: first run prints `✖ 1 em-dash violation` with `components/ui.tsx:NNN: ...` and exits 1. After revert, exit 0.

Proves: the rule actively guards user-facing code.

---

## 4. Opt-out annotation still works

```bash
grep -n "allow-em-dash" convex/lib/anthropic.ts
```

Expect: one match on the `NO_EM_DASH_RULE` constant line.

```bash
sed -i.bak 's| // allow-em-dash||' convex/lib/anthropic.ts
pnpm lint ; echo "exit=$?"
mv convex/lib/anthropic.ts.bak convex/lib/anthropic.ts
pnpm lint ; echo "exit=$?"
```

Expect: violation reported while annotation is missing, clean once restored.

Proves: opt-out is explicit and traceable, not silent magic.

---

## 5. Start the dev environment

In one terminal:

```bash
npx convex dev
```

In another:

```bash
pnpm dev
```

Open http://localhost:3000.

---

## 6. Visual + copy checks on the Start screen

Verify the following without clicking anything:

- **Sidebar rail**: one thin centered vertical line behind the icon column. The line ends exactly at the top and bottom icon centers. The mint icon chips visually segment the line into clean breaks. No off-center gaps.
- **Hero**: "Turn your menu into the best suppliers, automatically."
- **Textarea placeholder**: "Paste your menu here. Dish names and descriptions are enough."
- **Helper text under the textarea**: "Dishes, sections, descriptions. Patty handles the rest."
- **Upload tab label**: "PNG · JPG · PDF. Click to browse."
- **Sidebar paragraph**: "Every number is tagged with where it came from: USDA-verified, estimated, or no data."

Click **"Use sample · Trattoria Lucia"**. The textarea fills with dish lines using `:` separators (e.g. `· Insalata Caprese: mozzarella di bufala, heirloom tomato, basil, EVOO`). No em dashes anywhere.

Proves: Phase 9 visual + copy fixes landed.

---

## 7. Kick off a full run (parse menu)

Click **"Start the pipeline"** with the sample loaded.

Expect:
- Convex creates a `runs` row and a `stages` row for `parse_menu` in status `running`.
- The topbar narration cycles to "Reading the menu. Extracting dishes into an ingredient basket."
- Within ~5 to 15 seconds the Recipes stage transitions to `done` and the panel lists ~7 dishes with ingredients, quantities, and confidence chips.
- Dishes with sparse descriptions show the "Needs review. Quantities estimated from a short menu description." strip.
- No em dashes in any rendered text.

Proves: Claude menu parsing, Zod validation, ingredient aggregation, UI reactivity.

---

## 8. Pricing stage (USDA)

Watch the Pricing stage activate next.

Expect:
- Per ingredient: a USD price, unit, source tag (`USDA`, `estimated`, or `no data`), and a trend arrow or en dash `–` for no-data rows.
- At least one row should be `estimated` (fuzzy fallback) or `no data`. The UI must render gracefully.
- Stage transitions to `done` even when some rows are `no_data`.

Proves: USDA MARS lookup with fuzzy match, category fallback, and graceful degradation.

---

## 9. Distributors stage (Places)

Expect:
- 3 to 8 distributor cards with name, category badges, distance, and a `verified` or `estimated` provenance tag.
- If Google Places returns zero in the 8 km radius, the action widens to 25 km, then falls back to seeded mocks. A "seeded fallback" hint shows.

Proves: Places New Text Search with widen-radius fallback and mock seed.

---

## 10. RFPs sent (Maileroo outbound)

Expect:
- A thread row per distributor with status `queued` then `sent`.
- The email preview panel shows the subject `RFP: weekly produce and dry goods for Trattoria Lucia` and body with `Patty, on behalf of Trattoria Lucia` signature (no leading em dash).
- Distributors with no listed email get a thread in status `failed` with `note: "no email. Places discovery"`.
- Rerunning the action does not produce duplicate `sent` events (idempotency by `${runId}:${distributorId}:rfp`).

Proves: Maileroo Email API integration, idempotent send, graceful handling of missing addresses.

---

## 11. Quote ingestion (inbound webhook simulation)

In a Convex dashboard function runner, call `email:simulateInboundReply` with one of the open threads' `message_id` to fake a distributor reply. Or, with a real verified sender, reply to the RFP from the inbox the RFP was sent to.

Expect:
- The httpAction verifies authenticity by calling `validation_url` once.
- Quote parsing runs via Claude; a `quotes` row appears with per-line prices, terms, lead time, and a `parseConfidence` chip.
- Re-firing the same inbound payload does NOT create a second quote (dedupe by `message_id`).
- If the quote is missing line info, the cron triggers ONE follow-up (`Re: RFP: a few missing prices for Trattoria Lucia`).
- If a distributor never replies, the cron sends ONE nudge after 30 minutes (`Re: RFP: quick nudge for Trattoria Lucia`). Capped at 1 to 2 follow-ups total.

Proves: validation_url verification, idempotent inbound handling, LLM quote parsing, agent cron logic.

---

## 12. Recommendation

Once enough quotes land:

Expect:
- A QuotesPanel comparison table. Empty cells render as en dash `–`, not em dash.
- A `recommendations` row appears with a headline (≤ 90 chars), 2 to 3 sentence rationale, primary award, optional complementary splits, gaps, estimated savings vs USDA baseline.
- If margins are thin or completeness is low, the rationale names the reason and `needsHumanApproval` is `true`.
- Click **Approve**: the mutation flips the run to `awarded`, the approval animation fires.
- Headline and rationale text contain zero em dashes.

Proves: scoring, recommendation writeup, approval flow, em-dash discipline in LLM output.

---

## 13. Failure-path spot checks

Force each of these once, watching the UI degrade honestly:

1. **Vague dish input**: replace the textarea with one line "Chef special" and run. Expect `confidence: low`, `needsReview: true`, ReviewStrip rendered, no crash.
2. **No data ingredient**: pick a fictional ingredient ("dragonfruit zest"). Pricing row should be `no_data` with `–` trend; aggregate still completes.
3. **Zero distributors**: temporarily set the restaurant address to a remote area in seed data and run. Expect mock seed fallback + a banner.
4. **Bounced email**: simulate a 5xx from Maileroo via dashboard. Thread should land in `failed`, run continues.
5. **Malformed quote reply**: simulate inbound with body "see attached". `parseConfidence: low`, missing-info follow-up triggered.

Proves: graceful degradation across the five stages, the third pillar graders care about.

---

## 14. CLAUDE.md and one-command demo

```bash
grep -nA8 "^## Typography" CLAUDE.md
```

Expect: the Typography section is present under "Coding conventions".

```bash
pnpm demo
```

Expect: with env vars set, this runs the seed script end-to-end against the Frankies 457 menu and prints the final recommendation. The headline and rationale lines contain no em dashes.

Proves: doctrine is in place and a grader can reproduce the full flow with one command.

---

## What "all green" looks like at the end

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`: all exit 0.
- Start screen rail centered with clean breaks.
- A full run progresses parse_menu → fetch_pricing → find_distributors → send_rfps → collect_quotes → recommendation reactively, with no manual refresh.
- Forced failures degrade gracefully; nothing crashes the client.
- Every user-facing string (UI, emails, LLM output) is em-dash-free.
