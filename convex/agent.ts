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
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
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

// ── Constants ──────────────────────────────────────────────────────

const NUDGE_DELAY_MS = 30 * 60 * 1000; // 30 minutes after initial send
const MAX_ATTEMPTS = 3;                // initial + at most 2 follow-ups
const BATCH_LIMIT = 10;                // per-tick cap per pass

// ── tick: the cron entrypoint ──────────────────────────────────────

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
  handler: async (ctx, { quoteId }) => {
    const context = await ctx.runQuery(internal.agent.getMissingInfoContext, { quoteId });
    if (!context) {
      // Orphan quote (recipient or rfp gone — leftover from earlier dev runs).
      // Mark it so it falls out of the cron scan and stops blocking progress.
      await ctx.runMutation(internal.agent.markQuoteSkipped, { quoteId });
      return;
    }
    const { quote, recipient, rfp, restaurant, distributor, missingLines } = context;
    if (recipient.attempts >= MAX_ATTEMPTS) return;
    if (recipient.emailStatus === "failed") return;
    if (missingLines.length === 0) {
      // Nothing actually missing — mark to skip future ticks.
      await ctx.runMutation(internal.agent.markMissingInfoFollowedUp, {
        quoteId,
        rfpRecipientId: recipient._id,
      });
      return;
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
      return;
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
      subject: buildMissingInfoSubject(restaurant.name),
      html,
      replyTo: replyAddress,
    });

    void quote; // keep destructured ref so signatures stay stable
    if (!result.ok) {
      console.warn(`[agent] missing-info send failed (marker already set to prevent double-send): ${result.error}`);
    }
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
  handler: async (ctx, { rfpRecipientId }) => {
    const context = await ctx.runQuery(internal.agent.getNudgeContext, { rfpRecipientId });
    if (!context) return;
    const { recipient, rfp, restaurant, distributor } = context;
    if (recipient.emailStatus !== "sent") return;
    if (recipient.attempts >= MAX_ATTEMPTS) return;

    const apiKey = optional("MAILEROO_SENDING_KEY");
    const mailDomain = optional("MAIL_DOMAIN");

    if (!apiKey || !mailDomain) {
      await ctx.runMutation(internal.agent.markRecipientFollowedUp, {
        rfpRecipientId: recipient._id,
        sentMessageId: `mock:${Math.random().toString(36).slice(2, 10)}`,
      });
      return;
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
      return;
    }
    await ctx.runMutation(internal.agent.markRecipientFollowedUp, {
      rfpRecipientId: recipient._id,
      sentMessageId: result.messageId,
    });
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
  },
});
