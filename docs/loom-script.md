# Loom script · Pathway RFP Pipeline walkthrough

A 5-minute (±15 s) recorded design review. Cold open on the live pipeline, then 30 to 45 seconds per stage narrating the design decision behind it, closing on the autonomous agent and how it maps to what Pathway is building.

**Pacing rules:**
- Each section's VO is the spoken line. Read at ~150 wpm; clip the secondary sentence if you start sliding past the timestamp.
- The phrase "miniature Patty" appears in the cold open and nowhere else.
- If a stage runs long, trim Stage 4 first; the most important design beat is Stage 5.
- No em dashes in the spoken text. Use periods or commas.

---

## 0:00 to 0:15 · Cold open (15 s)

**On screen.** Black for half a second, then hard cut into the live app already mid-run. All five stages animating. Real reactive Convex state, not a mock. No cursor visible.

**VO.** "This is a miniature Patty. A menu went in, RFP emails went out to real local distributors, and quotes are coming back. I will show you how it is built in five minutes."

---

## 0:15 to 0:35 · Framing (20 s)

**On screen.** Split: the Pathway product page on the left, the live app on the right. Briefly hover the "what Patty does" sidebar.

**VO.** "Pathway's Staff Engineer role is about agents that take procurement decisions to the door of execution. I built a smaller-scoped version that runs end to end against real services: Anthropic Claude for parsing, USDA MARS for prices, Google Places for distributors, and Maileroo for outbound and inbound email. The design priority was graceful failure and an honest provenance signal at every boundary."

---

## 0:35 to 1:15 · Stage 1 · parse_menu (40 s)

**On screen.** Cut to the start screen. Paste the Trattoria Lucia sample, click Run. The Stage 1 card opens. Hover one of the parsed dishes to show the per-ingredient breakdown and the confidence pill.

**VO.** "Stage one parses the menu. Claude runs under forced tool use with a Zod-validated output schema. The action tries Haiku 4.5 first, and falls back to Sonnet 4.6 only if structured output fails. Low-confidence rows are flagged for human review rather than dropped, because a missing dish is worse than a flagged one. URL inputs are fetched, stripped to text under a 40 KB cap, and run through the same pipeline."

**File callout.** `convex/pipeline/parseMenu.ts`, `convex/lib/schemas.ts`.

---

## 1:15 to 1:55 · Stage 2 · fetch_pricing (40 s)

**On screen.** Stage 2 card fills with prices. Hover a provenance pill to surface the report slug and prior date. Hover an `estimated` row to show the category fallback note.

**VO.** "Stage two prices the basket against USDA MARS. The hard part is that USDA reports at commodity granularity, not SKU. There is no clean row for, say, 'San Marzano tomato'. So each ingredient maps to a curated commodity slug, fuzzy-matches with fuzzball, and goes through a pack-unit normalizer so we can compare per-pound apples to apples. If no match, we fall back to a category estimate. If even that fails, we tag the row no data and the UI renders an en dash. The provenance pill on every row is the user-visible output of that tradeoff."

**File callout.** `convex/lib/usda.ts`, `convex/lib/units.ts`.

---

## 1:55 to 2:35 · Stage 3 · find_distributors (40 s)

**On screen.** Stage 3 map fills with real Brooklyn distributors around the seeded address. Hover a pin to show name, website, and scraped email.

**VO.** "Stage three finds distributors. Address is geocoded through Nominatim. Google Places is queried per category around that point. Distributor websites are scraped for the first mailto link, then a contact page fallback. Anything without a discoverable email becomes contact status needs enrichment and is skipped at send time. Earlier versions of this stage had a mock distributor catalog as a fallback. I removed it because fake distributors poison the recommendation engine downstream. A quieter Stage 4 is more honest than a confidently wrong one."

**File callout.** `convex/lib/places.ts`, `convex/lib/emailScrape.ts`.

---

## 2:35 to 3:15 · Stage 4 · send_rfps (40 s)

**On screen.** Stage 4 card. Per-distributor RFP rows transition from queued to sent. If the Maileroo dashboard is open in another tab, briefly cut to it to show the real delivery; otherwise stay in the app.

**VO.** "Stage four sends the RFPs through Maileroo. Each outbound email is keyed by a deterministic idempotency string, run ID plus distributor ID plus the literal RFP, so a re-run never double-sends. For grading there is a DEMO REDIRECT INBOX env that routes the actual mail to a single inbox you control, with the real distributor surfaced in the UI under a 'via demo redirect' overlay. So you can watch real emails land without ever bothering an actual business."

**File callout.** `convex/emails.ts`, `convex/lib/maileroo.ts`.

---

## 3:15 to 4:00 · Stage 5 · collect_quotes (45 s)

**On screen.** Stage 5 panel. Comparison table fills with totals, lead times, and terms across distributors. Recommendation card renders at the bottom with the headline, rationale, and the Approve modal trigger.

**VO.** "Stage five is the design beat I care about most. Inbound is the actually-hard part of an RFP loop, not outbound. Maileroo POSTs replies to a Convex httpAction, which validates authenticity by calling the payload's validation URL once. Claude parses the free-form reply into Zod-validated line items, lead time, and terms. The recommendation query joins quotes against the basket and derives a weekly total from price times quantity when the distributor did not state one. When lead time is missing, the UI shows an en dash instead of guessing. Honesty is the recommendation engine's biggest input. The whole UI is just a reactive view over Convex state. I am not refreshing anything; the rows are pushed."

**File callout.** `convex/http.ts`, `convex/quotes.ts`, `convex/recommendations.ts`.

---

## 4:00 to 4:50 · The autonomous agent and how this maps to Pathway (50 s)

**On screen.** Zoom out to the pipeline summary. Then cut to the Convex dashboard, agentEvents table, scrolling through `tick_scan`, `follow_up_sent`, `nudge_sent`, `quote_received`, `quote_parsed`, `recommendation_written`. Cut back to the UI for the Approve modal.

**VO.** "The 5-minute cron drives an autonomous agent that scans for silence, sends follow-ups, parses inbound, and writes the recommendation. The boundary that mattered most to design is that the agent is autonomous for everything reversible, and humans gate the award. The Approve modal is the only thing that flips needsHumanApproval. That is the production posture Patty already runs. Where I would take this next: first, simulation and what-if so a buyer can swap a distributor or weight differently without re-sending RFPs; second, a typed safe-execution layer that can actually place the order inside an approved envelope. Those are the two threads I read into the Pathway role, moving from agent-recommends to agent-executes-within-envelope."

---

## 4:50 to 5:00 · Close (10 s)

**On screen.** Open the README in a browser tab. Scroll past the architecture and ER diagrams. Show the repo URL in the address bar.

**VO.** "Full architecture, schema, and design tradeoffs are in the README. Thanks for watching."

---

## Pre-record checklist

- `AGENT_TIME_SCALE=60` set in the Convex env so follow-ups and nudges fire in seconds.
- `DEMO_REDIRECT_INBOX` set to your own Maileroo-routable inbox.
- Maileroo dashboard tab pre-opened (used briefly in Stage 4).
- Convex dashboard pinned to `agentEvents` (used briefly in the closing section).
- Browser zoomed so the live pipeline plus the right sidebar fit one screen at 1080p.
- A fresh, clean pipeline run pre-staged about 5 seconds in, so the cold open is genuinely mid-run.
- Trim Stage 4 first if total clock runs long.
