# State Vocabulary — Pathway RFP Pipeline

A flat list of **every status/label the design actually depicts**, grouped by category, with suggested backend enum keys (snake_case). Use this to reconcile against Convex schema enums. ⚠️ marks gaps/mismatches to resolve.

---

## 1. Pipeline stage status
Per-stage lifecycle in the live pipeline.

| UI label | Suggested enum | Notes |
|---|---|---|
| Pending | `pending` | Not started; node dimmed, non-interactive |
| Running | `running` | Exactly one active at a time in the demo; UI animates it |
| Done | `done` | Terminal success |
| Error | `error` | Terminal failure (no per-stage error is *shown* in the demo flow, but the badge + EmptyState `error` tone exist and must be supported) |

The 5 stages themselves (ordered):
`parse_menu` → `fetch_pricing` → `find_distributors` → `send_rfps` → `collect_quotes`.
Each stage carries: `status`, a one-line `summary` (e.g. "14 priced · 2 no public data"), and a `durationMs` / running elapsed.

⚠️ **Consider also:** `queued`/`skipped`/`canceled` if the backend can produce stages that never run. The UI currently has no visual for these — map them to `pending` (queued) or add states.

---

## 2. Email / RFP thread status
Per-distributor outreach state in stage 4.

| UI label | Suggested enum |
|---|---|
| Queued | `queued` |
| Sent | `sent` |
| Replied | `replied` |
| Followed up | `followed_up` |
| Failed | `failed` |

Thread also carries: `sentAt`, `repliedAt?`, `attempts` (int; >1 surfaces "N attempts"), and a free-text `note` (e.g. follow-up reason, bounce reason).

⚠️ **Mismatch watch:** "Followed up" is a derived state (sent + auto-retry, no reply yet). If the backend models retries as a count rather than a status, the UI derives `followed_up` when `attempts > 1 && !repliedAt`. Decide where this lives.
⚠️ The design shows a **hard bounce** as `failed` with note "Hard bounce — mailbox unavailable." If you distinguish `bounced` vs `failed` (send error) vs `no_response` (deadline passed, never replied), add those enums; the UI currently collapses them to `failed`.

---

## 3. Pricing provenance
Source of every price.

| UI label | Suggested enum |
|---|---|
| USDA verified | `usda` (alias `verified`) |
| Estimated | `estimated` |
| No data | `no_data` |
| ⚠️ Mock | `mock` — **NOT depicted in the design** |

⚠️ **`mock` gap:** the brief's backend vocab includes `mock`, but the prototype only shows `usda` / `estimated` / `no_data`. Recommendation: add a `mock` provenance badge reusing the **estimated** violet (`#8A6FB0`) with a distinct icon (`FlaskConical`) and label "Mock", OR render it identically to `estimated` but with a dashed outline so demo/seed data is visually flagged. Do **not** silently map `mock`→`estimated` in a way that hides that it's fake. Confirm with design.

Pricing row also carries: `price` (nullable — null ⇒ render as `no_data`), `unit`, `trend` (signed % vs last period, nullable), and a `src` string (e.g. "USDA AMS · LM_XB403").

---

## 4. Confidence
On parsed dishes/ingredients and on the final recommendation.

| UI label | Suggested enum | Pips |
|---|---|---|
| High confidence | `high` | 3 |
| Medium confidence | `medium` | 2 |
| Low · needs review | `low` | 1 |

Low/medium items also trigger a per-item `flag` string ("Cut assumed", "Qty estimated", "Import grade unclear") and a panel-level "needs review" review-strip.

---

## 5. Recommendation / approval
The final award decision.

| UI concept | Suggested field |
|---|---|
| Confidence of the recommendation | `confidence` (high/medium/low — reuses §4) |
| Needs human approval | `needsApproval: boolean` |
| Awarded split (per distributor) | `splits[]` → `{ distributorId, role, weeklyValue }` |
| Unresolved lines | `gaps[]` → `{ item, reason }` |
| Estimated saving | `estSavings`, `estBaseline` |

**Approval flow states (client-side):** `review` → `sending` → `done`.
**Per-gap decision (client-side enum):** `hold` | `manual` | `drop`.
⚠️ These approval/decision states may need to persist to the backend (an `award` record with status `draft` → `sent`, and per-gap resolutions). The design treats them as a client interaction; decide if they're durable.

---

## 6. Category (ingredients & distributors)
| UI label | enum |
|---|---|
| Produce | `produce` |
| Dairy | `dairy` |
| Meat | `meat` |
| Seafood | `seafood` *(color defined; not used in trattoria demo data)* |
| Dry goods | `drygoods` |

---

## 7. Distributor provenance
Reuses the **provenance** palette but semantically means "is this a verified supplier record":
- Verified → `verified` (green, "Verified · <permit/USDA estab.>")
- Estimated → `estimated` (violet, "Estimated · listing only, unverified")

⚠️ Same vocabulary, different meaning than pricing provenance. Consider a separate enum (`supplier_verification: verified | unverified`) to avoid overloading `estimated`.

---

## 8. Trend direction (derived, not stored as enum)
`up` / `down` / `flat` — derived from the signed `trend` number; up is rendered red (bad for buyer), down green.

---

## Quick reconciliation checklist for the backend
1. Stage status enum = `{pending, running, done, error}` (+ optionally queued/skipped/canceled).
2. Email status enum = `{queued, sent, replied, followed_up, failed}` — decide if bounce/no-response are distinct.
3. Pricing provenance enum = `{usda, estimated, no_data}` **+ resolve `mock`**.
4. Confidence enum = `{high, medium, low}` (shared by parse items + recommendation).
5. Category enum = `{produce, dairy, meat, seafood, drygoods}`.
6. Distributor verification — separate from pricing provenance.
7. Nullable prices ⇒ `no_data`; nullable trend ⇒ em-dash; missing quote ⇒ no-quote column.
8. `followed_up` and the approval/decision states — decide client-derived vs. persisted.
