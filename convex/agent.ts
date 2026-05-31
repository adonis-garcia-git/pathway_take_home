// The autonomous quote-collection agent.
//
// Two responsibilities:
//   1. `tick` — cron-driven, runs every 2 minutes. Two scan passes:
//        Pass A: quotes with missingInfo=true AND missingInfoFollowUpSentAt=null
//                → send targeted follow-up naming only the missing lines.
//        Pass B: rfpRecipients still "sent" past NUDGE_DELAY_MS AND under the
//                attempt cap → send a one-line nudge.
//      Both passes are idempotent (markers + status transitions) and capped
//      to 10 per tick to avoid hammering Maileroo or the LLM.
//
//   2. `generateRecommendation` — orchestrates the recommendation engine:
//      load all quotes + basket + USDA price map → pure scoreQuotes →
//      Claude rationale → upsertForRun. Called BOTH after every parsed reply
//      (debounced 5s by parseInboundQuote) AND once at deadline by
//      checkCollectQuotesDone. Idempotent: upserts on by_runId.
//
// Caps documented as constants at the top so they're easy to dial down for
// demos (e.g. NUDGE_DELAY_MS = 30s if you want to see the cron fire live).

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { optional } from "./lib/env";
import { sendBasicEmail } from "./lib/maileroo";
import { replyAddressFor } from "./lib/replyAddress";
import {
  buildMissingInfoHtml,
  buildMissingInfoSubject,
  buildNudgeHtml,
  buildNudgeSubject,
  type RfpLine,
} from "./lib/rfpTemplate";
import {
  scoreQuotes,
  type BasketLine as RecBasketLine,
  type QuoteInput,
} from "./lib/recommendation";
import { writeRecommendationRationale } from "./lib/anthropic";
import {
  NUDGE_DELAY_MS,
  MAX_ATTEMPTS,
  BATCH_LIMIT,
} from "./lib/agentConstants";

// ── Event log helpers ──────────────────────────────────────────────

const kindValidator = v.union(
  v.literal("tick_scan"),
  v.literal("follow_up_sent"),
  v.literal("nudge_sent"),
  v.literal("quote_received"),
  v.literal("quote_parsed"),
  v.literal("recommendation_written"),
  v.literal("scheduled"),
  v.literal("send_failed"),
);

export const appendAgentEvent = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    kind: kindValidator,
    summary: v.string(),
    recipientId: v.optional(v.id("rfpRecipients")),
    distributorName: v.optional(v.string()),
    nextTickAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentEvents", { ...args, at: Date.now() });
  },
});

export const getRecentEventsForRun = query({
  args: { runId: v.id("pipelineRuns"), limit: v.optional(v.number()) },
  handler: async (ctx, { runId, limit = 50 }) => {
    return await ctx.db
      .query("agentEvents")
      .withIndex("by_runId_and_at", (q) => q.eq("runId", runId))
      .order("desc")
      .take(limit);
  },
});

/** Surfaces the RFP deadline for the countdown chip in stage 5. */
export const getRunDeadline = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<number | null> => {
    const run = await ctx.db.get(runId);
    if (!run?.rfpId) return null;
    const rfp = await ctx.db.get(run.rfpId);
    return rfp?.deadline ?? null;
  },
});

function fmtRel(ms: number): string {
  if (ms < 1000) return "moments";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r === 0 ? `${m}m` : `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Optional helper for a future event-driven scheduler. Computes when the
 * next agent action becomes eligible across all runs and schedules a
 * single one-shot tick at that moment, deduping via the agentSchedule
 * singleton. Not wired into the shipping agent (which runs from cron);
 * kept here so the pattern is available when needed.
 */
export const scheduleNextTick = internalMutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    let earliest = Number.POSITIVE_INFINITY;

    // (a) Quote with missingInfo=true and no follow-up yet → eligible NOW.
    const allQuotes = await ctx.db.query("quotes").collect();
    if (
      allQuotes.some(
        (q) => q.missingInfo && q.missingInfoFollowUpSentAt === undefined,
      )
    ) {
      earliest = now;
    }

    // (b) Recipient still "sent" past sentAt + NUDGE_DELAY_MS, under attempts cap.
    if (earliest > now) {
      const recipients = await ctx.db.query("rfpRecipients").collect();
      for (const r of recipients) {
        if (r.emailStatus !== "sent") continue;
        if (r.attempts >= MAX_ATTEMPTS) continue;
        if (!r.sentAt) continue;
        const eligible = r.sentAt + NUDGE_DELAY_MS;
        if (eligible < earliest) earliest = eligible;
      }
    }

    if (!Number.isFinite(earliest)) return;
    const targetAt = Math.max(now, earliest);

    // Singleton dedup. If a tick is already scheduled at or before the new
    // target, our work is redundant. Mutations are serializable, so
    // concurrent callers all read the latest singleton state.
    const singleton = await ctx.db.query("agentSchedule").first();
    if (
      singleton?.nextRunAt !== undefined &&
      singleton.nextRunAt > now &&
      singleton.nextRunAt <= targetAt
    ) {
      return;
    }

    const delay = targetAt - now;
    await ctx.scheduler.runAfter(delay, internal.agent.tick, {});
    if (singleton) {
      await ctx.db.patch(singleton._id, { nextRunAt: targetAt });
    } else {
      await ctx.db.insert("agentSchedule", { nextRunAt: targetAt });
    }
    await ctx.db.insert("agentEvents", {
      runId,
      at: now,
      kind: "scheduled",
      summary:
        delay === 0
          ? "Scheduled an immediate pass."
          : `Next pass in ${fmtRel(delay)}.`,
      nextTickAt: targetAt,
    });
  },
});

/** Called at tick entry to clear the singleton so the next round can rearm. */
export const clearScheduledTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const singleton = await ctx.db.query("agentSchedule").first();
    if (singleton) await ctx.db.patch(singleton._id, { nextRunAt: undefined });
  },
});

/**
 * Cancel every pending scheduled function in batches. Useful from the
 * Convex dashboard if the scheduler queue ever needs to be cleared.
 * Returns the count cancelled. Safe to call multiple times.
 */
export const cancelAllScheduledFunctions = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize }) => {
    // Convex caps a single mutation at 4096 reads. The system table has no
    // user-defined index on state.kind, so .filter() forces a full scan and
    // every scanned row counts as a read. We can't filter safely.
    //
    // Strategy: take a bounded batch of raw rows, filter in memory, cancel
    // up to a strict budget. Each scheduler.cancel() costs a small number
    // of internal reads, so the take-size + cancel-budget * cost-per-cancel
    // must stay well under 4096. Conservative defaults: take 600, cancel up
    // to 300. Worst case ~600 + 300*5 = 2100 reads, well under the limit.
    //
    // Returns `{ scanned, cancelled, more }`. Run repeatedly from the
    // dashboard until `more === false`.
    const limit = Math.max(1, Math.min(batchSize ?? 600, 800));
    const CANCEL_BUDGET = 300;
    const batch = await ctx.db.system.query("_scheduled_functions").take(limit);
    let cancelled = 0;
    for (const job of batch) {
      if (cancelled >= CANCEL_BUDGET) break;
      const kind = (job as { state?: { kind?: string } }).state?.kind;
      if (kind !== "pending" && kind !== "inProgress") continue;
      try {
        await ctx.scheduler.cancel(job._id);
        cancelled++;
      } catch {
        // Already-finalized rows can race; ignore and move on.
      }
    }
    const singleton = await ctx.db.query("agentSchedule").first();
    if (singleton) await ctx.db.patch(singleton._id, { nextRunAt: undefined });
    return {
      scanned: batch.length,
      cancelled,
      more: batch.length === limit,
    };
  },
});

// ── tick: the cron entrypoint ──────────────────────────────────────

// Fires every 5 minutes via the heartbeat in crons.ts. Two idempotent
// passes: send follow-ups to quotes flagged missing-info, then nudge
// recipients who haven't replied within NUDGE_DELAY_MS.
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    // Pass A: missing-info follow-ups.
    const missingInfoQuotes = await ctx.runQuery(internal.agent.findMissingInfoQuotes, {
      limit: BATCH_LIMIT,
    });
    for (const q of missingInfoQuotes) {
      try {
        await ctx.runAction(internal.agent.sendMissingInfoFollowUp, { quoteId: q._id });
      } catch (e) {
        console.error(`[agent.tick] missing-info follow-up failed for quote ${q._id}:`, e);
      }
    }

    // Pass B: no-reply nudges.
    const stale = await ctx.runQuery(internal.agent.findStaleRecipients, {
      olderThanMs: NUDGE_DELAY_MS,
      maxAttempts: MAX_ATTEMPTS,
      limit: BATCH_LIMIT,
    });
    for (const r of stale) {
      try {
        await ctx.runAction(internal.agent.sendNoReplyNudge, { rfpRecipientId: r._id });
      } catch (e) {
        console.error(`[agent.tick] no-reply nudge failed for recipient ${r._id}:`, e);
      }
    }
  },
});

export const runIdForRfp = internalQuery({
  args: { rfpId: v.id("rfps") },
  handler: async (ctx, { rfpId }): Promise<Id<"pipelineRuns"> | null> => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfpId))
      .first();
    return run?._id ?? null;
  },
});

export const findActiveCollectQuotesRuns = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"pipelineRuns">[]> => {
    const runs = await ctx.db.query("pipelineRuns").collect();
    const active: Id<"pipelineRuns">[] = [];
    for (const r of runs) {
      const step = r.steps.find((s) => s.step === "collect_quotes");
      if (step?.status === "running") active.push(r._id);
    }
    return active;
  },
});

// ── Scans ──────────────────────────────────────────────────────────

export const findMissingInfoQuotes = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<Doc<"quotes">[]> => {
    const all = await ctx.db.query("quotes").collect();
    return all
      .filter((q) => q.missingInfo === true && q.missingInfoFollowUpSentAt === undefined)
      .slice(0, limit);
  },
});

export const findStaleRecipients = internalQuery({
  args: { olderThanMs: v.number(), maxAttempts: v.number(), limit: v.number() },
  handler: async (ctx, { olderThanMs, maxAttempts, limit }): Promise<Doc<"rfpRecipients">[]> => {
    const cutoff = Date.now() - olderThanMs;
    const all = await ctx.db.query("rfpRecipients").collect();
    const stale: Doc<"rfpRecipients">[] = [];
    for (const r of all) {
      if (r.emailStatus !== "sent") continue;
      if (r.attempts >= maxAttempts) continue;
      if (!r.sentAt || r.sentAt > cutoff) continue;
      // Only nudge while the RFP deadline hasn't passed; post-deadline the
      // recommendation engine takes over.
      const rfp = await ctx.db.get(r.rfpId);
      if (!rfp || rfp.deadline < Date.now()) continue;
      stale.push(r);
      if (stale.length >= limit) break;
    }
    return stale;
  },
});

// ── Pass A: missing-info follow-up ────────────────────────────────

interface MissingInfoContext {
  quote: Doc<"quotes">;
  recipient: Doc<"rfpRecipients">;
  rfp: Doc<"rfps">;
  restaurant: Doc<"restaurants">;
  distributor: Doc<"distributors">;
  missingLines: RfpLine[];
}

export const getMissingInfoContext = internalQuery({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }): Promise<MissingInfoContext | null> => {
    const quote = await ctx.db.get(quoteId);
    if (!quote) return null;
    const recipient = await ctx.db.get(quote.rfpRecipientId);
    if (!recipient) return null;
    const rfp = await ctx.db.get(recipient.rfpId);
    if (!rfp) return null;
    const restaurant = await ctx.db.get(rfp.restaurantId);
    if (!restaurant) return null;
    const distributor = await ctx.db.get(quote.distributorId);
    if (!distributor) return null;

    // Find basket lines the quote didn't cover with a price.
    const quotedWithPrice = new Set(
      quote.parsedLineItems
        .filter((l) => l.available && l.price !== undefined && l.ingredientId)
        .map((l) => l.ingredientId as Id<"ingredients">),
    );

    const missingLines: RfpLine[] = [];
    for (const line of rfp.ingredientList) {
      if (quotedWithPrice.has(line.ingredientId)) continue;
      const ingredient = await ctx.db.get(line.ingredientId);
      if (!ingredient) continue;
      missingLines.push({
        rawName: ingredient.canonicalName,
        estimatedQuantity: line.quantity,
        unit: line.unit,
      });
    }

    return { quote, recipient, rfp, restaurant, distributor, missingLines };
  },
});

export const markMissingInfoFollowedUp = internalMutation({
  args: {
    quoteId: v.id("quotes"),
    rfpRecipientId: v.id("rfpRecipients"),
    sentMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { quoteId, rfpRecipientId, sentMessageId }) => {
    const now = Date.now();
    await ctx.db.patch(quoteId, { missingInfoFollowUpSentAt: now });
    const recipient = await ctx.db.get(rfpRecipientId);
    if (!recipient) return;
    await ctx.db.patch(rfpRecipientId, {
      attempts: recipient.attempts + 1,
      note: `auto follow-up: missing info${sentMessageId ? ` · ${sentMessageId}` : ""}`,
    });
  },
});

export const markQuoteSkipped = internalMutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    await ctx.db.patch(quoteId, { missingInfoFollowUpSentAt: Date.now() });
  },
});

export const sendMissingInfoFollowUp = internalAction({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }): Promise<Id<"pipelineRuns"> | null> => {
    const context = await ctx.runQuery(internal.agent.getMissingInfoContext, { quoteId });
    if (!context) {
      await ctx.runMutation(internal.agent.markQuoteSkipped, { quoteId });
      return null;
    }
    const { quote, recipient, rfp, restaurant, distributor, missingLines } = context;
    const runId = await ctx.runQuery(internal.agent.runIdForRfp, { rfpId: rfp._id });
    if (recipient.attempts >= MAX_ATTEMPTS) return runId;
    if (recipient.emailStatus === "failed") return runId;
    // attempts: 1 = initial RFP, 2 = first follow-up, 3 = second (final).
    const round: 1 | 2 = recipient.attempts >= 2 ? 2 : 1;
    if (missingLines.length === 0) {
      // Nothing actually missing — mark to skip future ticks.
      await ctx.runMutation(internal.agent.markMissingInfoFollowedUp, {
        quoteId,
        rfpRecipientId: recipient._id,
      });
      return runId;
    }

    const apiKey = optional("MAILEROO_SENDING_KEY");
    const mailDomain = optional("MAIL_DOMAIN");

    if (!apiKey || !mailDomain) {
      // Mock mode: simulate the send so the idempotency marker still moves.
      await ctx.runMutation(internal.agent.markMissingInfoFollowedUp, {
        quoteId,
        rfpRecipientId: recipient._id,
        sentMessageId: `mock:${Math.random().toString(36).slice(2, 10)}`,
      });
      if (runId) {
        const roundTag = round === 2 ? " (round 2)" : "";
        await ctx.runMutation(internal.agent.appendAgentEvent, {
          runId,
          kind: "follow_up_sent",
          summary: `Asked ${distributor.name} about ${missingLines.length} missing line${missingLines.length === 1 ? "" : "s"}${roundTag}.`,
          recipientId: recipient._id,
          distributorName: distributor.name,
        });
      }
      return runId;
    }

    const replyAddress = replyAddressFor(distributor._id as unknown as string, mailDomain);
    const html = buildMissingInfoHtml({
      restaurantName: restaurant.name,
      distributorName: distributor.name,
      missingLines,
      deadline: rfp.deadline,
    });
    const to = distributor.email && distributor.email.length > 0 ? distributor.email : replyAddress;

    // Mark-before-send. Tradeoff: a Maileroo failure leaves the marker set, so
    // the cron won't retry — we'd rather under-nudge than risk double-nudging
    // a distributor on a crashed action that already managed to deliver.
    // Maileroo's own retries handle transient send failures upstream.
    await ctx.runMutation(internal.agent.markMissingInfoFollowedUp, {
      quoteId,
      rfpRecipientId: recipient._id,
    });

    const result = await sendBasicEmail({
      apiKey,
      from: `Patty (${restaurant.name}) <rfp@${mailDomain}>`,
      to,
      subject: buildMissingInfoSubject(restaurant.name, round),
      html,
      replyTo: replyAddress,
    });

    void quote; // keep destructured ref so signatures stay stable
    if (!result.ok) {
      console.warn(`[agent] missing-info send failed (marker already set to prevent double-send): ${result.error}`);
      if (runId) {
        await ctx.runMutation(internal.agent.appendAgentEvent, {
          runId,
          kind: "send_failed",
          summary: `Tried to follow up with ${distributor.name} but Maileroo rejected the send.`,
          recipientId: recipient._id,
          distributorName: distributor.name,
        });
      }
    } else if (runId) {
      const roundTag = round === 2 ? " (round 2)" : "";
      await ctx.runMutation(internal.agent.appendAgentEvent, {
        runId,
        kind: "follow_up_sent",
        summary: `Asked ${distributor.name} about ${missingLines.length} missing line${missingLines.length === 1 ? "" : "s"}${roundTag}.`,
        recipientId: recipient._id,
        distributorName: distributor.name,
      });
    }
    return runId;
  },
});

// ── Pass B: no-reply nudge ─────────────────────────────────────────

interface NudgeContext {
  recipient: Doc<"rfpRecipients">;
  rfp: Doc<"rfps">;
  restaurant: Doc<"restaurants">;
  distributor: Doc<"distributors">;
}

export const getNudgeContext = internalQuery({
  args: { rfpRecipientId: v.id("rfpRecipients") },
  handler: async (ctx, { rfpRecipientId }): Promise<NudgeContext | null> => {
    const recipient = await ctx.db.get(rfpRecipientId);
    if (!recipient) return null;
    const rfp = await ctx.db.get(recipient.rfpId);
    if (!rfp) return null;
    const restaurant = await ctx.db.get(rfp.restaurantId);
    if (!restaurant) return null;
    const distributor = await ctx.db.get(recipient.distributorId);
    if (!distributor) return null;
    return { recipient, rfp, restaurant, distributor };
  },
});

export const markRecipientFollowedUp = internalMutation({
  args: {
    rfpRecipientId: v.id("rfpRecipients"),
    sentMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { rfpRecipientId, sentMessageId }) => {
    const recipient = await ctx.db.get(rfpRecipientId);
    if (!recipient) return;
    if (recipient.emailStatus !== "sent") return; // only transition from "sent"
    await ctx.db.patch(rfpRecipientId, {
      emailStatus: "followed_up",
      attempts: recipient.attempts + 1,
      note: `auto follow-up: no reply${sentMessageId ? ` · ${sentMessageId}` : ""}`,
    });
  },
});

export const sendNoReplyNudge = internalAction({
  args: { rfpRecipientId: v.id("rfpRecipients") },
  handler: async (ctx, { rfpRecipientId }): Promise<Id<"pipelineRuns"> | null> => {
    const context = await ctx.runQuery(internal.agent.getNudgeContext, { rfpRecipientId });
    if (!context) return null;
    const { recipient, rfp, restaurant, distributor } = context;
    const runId = await ctx.runQuery(internal.agent.runIdForRfp, { rfpId: rfp._id });
    if (recipient.emailStatus !== "sent") return runId;
    if (recipient.attempts >= MAX_ATTEMPTS) return runId;

    const silenceMs = recipient.sentAt ? Date.now() - recipient.sentAt : 0;
    const silenceLabel = silenceMs > 0 ? fmtRel(silenceMs) : "a while";

    const apiKey = optional("MAILEROO_SENDING_KEY");
    const mailDomain = optional("MAIL_DOMAIN");

    if (!apiKey || !mailDomain) {
      await ctx.runMutation(internal.agent.markRecipientFollowedUp, {
        rfpRecipientId: recipient._id,
        sentMessageId: `mock:${Math.random().toString(36).slice(2, 10)}`,
      });
      if (runId) {
        await ctx.runMutation(internal.agent.appendAgentEvent, {
          runId,
          kind: "nudge_sent",
          summary: `Nudged ${distributor.name} after ${silenceLabel} of silence.`,
          recipientId: recipient._id,
          distributorName: distributor.name,
        });
      }
      return runId;
    }

    const replyAddress = replyAddressFor(distributor._id as unknown as string, mailDomain);
    const html = buildNudgeHtml({
      restaurantName: restaurant.name,
      distributorName: distributor.name,
      deadline: rfp.deadline,
    });

    const to = distributor.email && distributor.email.length > 0 ? distributor.email : replyAddress;
    const result = await sendBasicEmail({
      apiKey,
      from: `Patty (${restaurant.name}) <rfp@${mailDomain}>`,
      to,
      subject: buildNudgeSubject(restaurant.name),
      html,
      replyTo: replyAddress,
    });

    if (!result.ok) {
      console.warn(`[agent] nudge send failed: ${result.error}`);
      if (runId) {
        await ctx.runMutation(internal.agent.appendAgentEvent, {
          runId,
          kind: "send_failed",
          summary: `Tried to nudge ${distributor.name} but Maileroo rejected the send.`,
          recipientId: recipient._id,
          distributorName: distributor.name,
        });
      }
      return runId;
    }
    await ctx.runMutation(internal.agent.markRecipientFollowedUp, {
      rfpRecipientId: recipient._id,
      sentMessageId: result.messageId,
    });
    if (runId) {
      await ctx.runMutation(internal.agent.appendAgentEvent, {
        runId,
        kind: "nudge_sent",
        summary: `Nudged ${distributor.name} after ${silenceLabel} of silence.`,
        recipientId: recipient._id,
        distributorName: distributor.name,
      });
    }
    return runId;
  },
});

// ── Recommendation generation ──────────────────────────────────────

interface RecommendationContext {
  run: Doc<"pipelineRuns">;
  rfp: Doc<"rfps">;
  basket: RecBasketLine[];
  quotes: QuoteInput[];
  usdaPriceByIngredientId: Record<string, number>;
}

export const getRecommendationContext = internalQuery({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<RecommendationContext | null> => {
    const run = await ctx.db.get(runId);
    if (!run || !run.rfpId) return null;
    const rfp = await ctx.db.get(run.rfpId);
    if (!rfp) return null;

    // Basket: from rfp.ingredientList (the snapshot taken at send time).
    const basket: RecBasketLine[] = [];
    const usdaPriceByIngredientId: Record<string, number> = {};
    for (const line of rfp.ingredientList) {
      const ingredient = await ctx.db.get(line.ingredientId);
      if (!ingredient) continue;
      basket.push({
        ingredientId: line.ingredientId as unknown as string,
        canonicalName: ingredient.canonicalName,
        quantity: line.quantity,
      });

      // Latest priced row for this ingredient (any source).
      const prices = await ctx.db
        .query("ingredientPrices")
        .withIndex("by_ingredientId", (q) => q.eq("ingredientId", line.ingredientId))
        .collect();
      const latestPriced = prices
        .filter((p) => typeof p.price === "number")
        .sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""))[0];
      if (latestPriced && typeof latestPriced.price === "number") {
        usdaPriceByIngredientId[line.ingredientId as unknown as string] = latestPriced.price;
      }
    }

    // Quotes: most recent per (rfpRecipient, distributor).
    const recipients = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfp._id))
      .collect();
    const recipientById = new Map(recipients.map((r) => [r._id, r] as const));

    const allQuotes = await ctx.db
      .query("quotes")
      .withIndex("by_distributorId")
      .collect();
    const ourQuotes = allQuotes.filter((q) => recipientById.has(q.rfpRecipientId));

    // Keep newest quote per recipient.
    const newestByRecipient = new Map<Id<"rfpRecipients">, Doc<"quotes">>();
    for (const q of ourQuotes) {
      const prev = newestByRecipient.get(q.rfpRecipientId);
      if (!prev || q.receivedAt > prev.receivedAt) {
        newestByRecipient.set(q.rfpRecipientId, q);
      }
    }

    const quotes: QuoteInput[] = [];
    for (const q of newestByRecipient.values()) {
      const distributor = await ctx.db.get(q.distributorId);
      if (!distributor) continue;
      quotes.push({
        distributorId: q.distributorId as unknown as string,
        distributorName: distributor.name,
        quoteId: q._id as unknown as string,
        totalPrice: q.totalPrice ?? null,
        paymentTerms: q.paymentTerms,
        deliveryTerms: q.deliveryTerms,
        parsedLineItems: q.parsedLineItems.map((l) => ({
          ingredientId: l.ingredientId as unknown as string | undefined,
          price: l.price ?? null,
          available: l.available,
        })),
        missingInfo: q.missingInfo,
      });
    }

    return { run, rfp, basket, quotes, usdaPriceByIngredientId };
  },
});

export const upsertForRun = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    rfpId: v.id("rfps"),
    primaryDistributorId: v.optional(v.id("distributors")),
    splits: v.array(
      v.object({
        distributorId: v.id("distributors"),
        role: v.string(),
        weeklyValue: v.number(),
      }),
    ),
    gaps: v.array(v.object({ item: v.string(), reason: v.string() })),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    needsHumanApproval: v.boolean(),
    headline: v.string(),
    rationale: v.string(),
    estSavings: v.optional(v.number()),
    estBaseline: v.optional(v.number()),
    scoreSummary: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recommendations")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rfpId: args.rfpId,
        primaryDistributorId: args.primaryDistributorId,
        splits: args.splits,
        gaps: args.gaps,
        confidence: args.confidence,
        needsHumanApproval: args.needsHumanApproval,
        headline: args.headline,
        rationale: args.rationale,
        estSavings: args.estSavings,
        estBaseline: args.estBaseline,
        scoreSummary: args.scoreSummary,
      });
      return existing._id;
    }
    return ctx.db.insert("recommendations", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const generateRecommendation = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const context = await ctx.runQuery(internal.agent.getRecommendationContext, { runId });
    if (!context) return;
    const { rfp, basket, quotes, usdaPriceByIngredientId } = context;

    const usdaMap = new Map<string, number>(Object.entries(usdaPriceByIngredientId));
    const draft = scoreQuotes(quotes, basket, usdaMap);

    // Ask Claude for headline + rationale. Best-effort: on failure use a
    // deterministic fallback so the recommendation row still lands.
    let rationale = { headline: "", rationale: "" };
    try {
      rationale = await writeRecommendationRationale({
        primary: draft.primary
          ? {
              distributorName: draft.primary.distributorName,
              totalPrice: draft.primary.totalPrice,
              completenessScore: draft.primary.completenessScore,
              paymentTerms: quotes.find((q) => q.quoteId === draft.primary?.quoteId)?.paymentTerms,
              deliveryTerms: quotes.find((q) => q.quoteId === draft.primary?.quoteId)?.deliveryTerms,
            }
          : null,
        splits: draft.splits.map((s) => ({
          distributorName: s.distributorName,
          role: s.role,
          weeklyValue: s.weeklyValue,
        })),
        gaps: draft.gaps,
        margin: draft.margin,
        confidence: draft.confidence,
        needsHumanApproval: draft.needsHumanApproval,
        estSavings: draft.estSavings,
        estBaseline: draft.estBaseline,
      });
    } catch (e) {
      console.error(`[agent.generateRecommendation] Claude rationale failed:`, e);
      rationale = {
        headline: draft.primary
          ? `Award to ${draft.primary.distributorName}`
          : "No viable quote — review distributors",
        rationale: draft.needsHumanApproval
          ? "Recommendation needs human review: thin margin, incomplete coverage, or no viable quote."
          : `Top pick covers ${Math.round(draft.primary!.completenessScore * 100)}% of the basket at the best blended price.`,
      };
    }

    const splitsForWrite = draft.splits.map((s) => ({
      distributorId: s.distributorId as unknown as Id<"distributors">,
      role: s.role,
      weeklyValue: s.weeklyValue,
    }));

    // Several inbound replies arriving in the same second each schedule a
    // generateRecommendation 5s later, so we can get many concurrent writers
    // contending on the same recommendations row. Each writer produces the
    // same result from the same inputs, so it's safe to swallow OCC failures:
    // whichever writer wins is the recommendation we keep.
    try {
      await ctx.runMutation(internal.agent.upsertForRun, {
        runId,
        rfpId: rfp._id,
        primaryDistributorId: draft.primary
          ? (draft.primary.distributorId as unknown as Id<"distributors">)
          : undefined,
        splits: splitsForWrite,
        gaps: draft.gaps,
        confidence: draft.confidence,
        needsHumanApproval: draft.needsHumanApproval,
        headline: rationale.headline,
        rationale: rationale.rationale,
        estSavings: draft.estSavings,
        estBaseline: draft.estBaseline,
        scoreSummary: {
          scored: draft.scored.map((s) => ({
            distributorId: s.distributorId,
            distributorName: s.distributorName,
            totalScore: s.totalScore,
            priceScore: s.priceScore,
            completenessScore: s.completenessScore,
            termsScore: s.termsScore,
            totalPrice: s.totalPrice,
          })),
          margin: draft.margin,
        },
      });
      await ctx.runMutation(internal.agent.appendAgentEvent, {
        runId,
        kind: "recommendation_written",
        summary: rationale.headline
          ? `Wrote a fresh recommendation: ${rationale.headline}`
          : "Wrote a fresh recommendation.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("changed while this mutation was being run")) {
        // OCC conflict from concurrent recommendation generators. Another
        // writer already produced the same recommendation; nothing to do.
        console.log(`[generateRecommendation] OCC swallowed for ${runId}`);
      } else {
        throw e;
      }
    }
  },
});
