# Resilience matrix

Every external call goes through `convex/lib/net.ts` with an `AbortController` timeout, a conservative retry policy, and a documented degradation path so a single API outage never stops the pipeline.

## Per-service policy

| Service | File | Timeout | Retry | Outage degrades to |
|---|---|---:|---|---|
| Anthropic (Claude) | `convex/lib/anthropic.ts` | 30s | 1 retry on 529 / 5xx / timeout; existing 1 Zod-failure retry | Stage marked `error` with the Anthropic message; pipeline stops at that stage and the UI surfaces it. Quote-parse failures additionally degrade to `parsedLineItems:[], parseConfidence:"low", missingInfo:true` so the cron follow-up handles it. |
| USDA MARS | `convex/lib/usda.ts` | 10s per request | 1 retry on 429 / 5xx / timeout | Category averages with `source: "estimated"` or `"mock"` (when no key). Pipeline never blocks; provenance badge tells the truth. |
| Google Places (New) | `convex/lib/places.ts` | 10s per request | 1 retry on 429 / 5xx / timeout. Plus a one-shot **widen-radius** (8 km → 25 km) when a category returns < 3 results. | Per-category failures logged and skipped. Hard outage → mock catalog (40+ NYC distributors seeded by `seedDistributors`). |
| Maileroo Send | `convex/lib/maileroo.ts` | 8s | 1 retry on 5xx / timeout. **No retry on 4xx** (bounce is terminal). | Per-recipient failure marks `rfpRecipients.emailStatus = "failed"` and the rest continue. No-key mode writes a `mock:` `sentMessageId` so the rest of the pipeline can run. |
| Maileroo inbound validation | `convex/lib/maileroo.ts` | 5s per method (GET, then POST) | 0 — Maileroo redelivers on a non-2xx so retrying here just delays the loop. | Failed validation → 401 response → Maileroo's own retry schedule (5/10/15/30 min, then 1/2/4/6 h). |
| Menu URL fetch | `convex/lib/fetchUrl.ts` | 15s | 1 retry on 429 / 5xx / timeout | parse_menu stage marks `error` and stops; users can switch to "Paste text" mode to bypass. |

## Idempotency keys (so retries are safe)

| Surface | Key | Notes |
|---|---|---|
| `seedFrankies457` | `restaurants.externalId = "demo:frankies-457"` | Replay returns the existing row + the most recent non-terminal run. |
| `recordInboundQuote` | `quotes.mailerooMessageId` | Duplicate webhook payloads are no-ops. |
| `runSendRfps` | `pipelineRuns.rfpId` presence | Pre-attempt check resumes; never creates a 2nd RFP. |
| `attachRfpToRun` | overwrite guard | Re-attaching the same id is a no-op; a different id is rejected. |
| `sendMissingInfoFollowUp` | `quotes.missingInfoFollowUpSentAt` | Marker set **before** the Maileroo call — tradeoff: under-nudge on a failed send, never double-nudge on a crashed action. |
| `markRecipientSent` / `markRecipientFailed` | `emailStatus === "queued"` guard | State machine prevents redundant transitions. |
| `upsertForRun` (recommendations) | `by_runId` index | Single recommendation row per run, updated in place. |
| `upsertIngredientPrice` | `(ingredientId, reportDate)` | One price row per ingredient per USDA report date. |

## What's NOT hardened (out of scope)

- **No circuit breaker.** A repeatedly-down service still gets a request per stage invocation. Acceptable because actions are throttled by the scheduler and pipeline runs are user-driven.
- **Anthropic API throttling beyond 1 retry.** A sustained 529 wave will fail the stage; user can re-run.
- **No queueing of follow-ups.** The agent cron processes up to 10/tick — a backlog of 100 would clear over 20 minutes.
