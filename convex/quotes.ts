// Quotes domain: inbound persistence + Claude-driven quote parser.
//
// `recordInboundQuote` is the single mutation called by BOTH the webhook
// (convex/http.ts) and the dev simulator (convex/email.ts simulateInboundReply).
// All the dedupe + side-effect ordering lives here so the two callers share
// one code path.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { parseQuoteReply } from "./lib/anthropic";
import { token_set_ratio } from "fuzzball";

export const findQuoteByMessageId = internalQuery({
  args: { mailerooMessageId: v.string() },
  handler: async (ctx, { mailerooMessageId }) =>
    ctx.db
      .query("quotes")
      .withIndex("by_mailerooMessageId", (q) => q.eq("mailerooMessageId", mailerooMessageId))
      .first(),
});

export const findRecipientByReplyAddress = internalQuery({
  args: { replyAddress: v.string() },
  handler: async (ctx, { replyAddress }) =>
    ctx.db
      .query("rfpRecipients")
      .withIndex("by_replyAddress", (q) => q.eq("replyAddress", replyAddress))
      .first(),
});

// Idempotent inbound write:
//   1. Check dedupe by mailerooMessageId → return existing quoteId if any.
//   2. Insert the quote with empty parsedLineItems + low confidence (filled
//      in by parseInboundQuote once Claude has parsed the raw body).
//   3. Patch the rfpRecipient row to `replied`.
//   4. Schedule parseInboundQuote — wraps Claude with `forcedToolCall`.
//   5. Schedule collect_quotes completion check on the owning pipelineRun.
export const recordInboundQuote = internalMutation({
  args: {
    rfpRecipientId: v.id("rfpRecipients"),
    mailerooMessageId: v.string(),
    rawEmailBody: v.string(),
  },
  handler: async (
    ctx,
    { rfpRecipientId, mailerooMessageId, rawEmailBody },
  ): Promise<{ quoteId: Id<"quotes"> | null }> => {
    // (1) Dedupe.
    const existing = await ctx.db
      .query("quotes")
      .withIndex("by_mailerooMessageId", (q) => q.eq("mailerooMessageId", mailerooMessageId))
      .first();
    if (existing) return { quoteId: existing._id };

    const recipient = await ctx.db.get(rfpRecipientId);
    if (!recipient) return { quoteId: null };

    // (2) Insert the quote row (parsedLineItems empty until parse completes).
    const quoteId = await ctx.db.insert("quotes", {
      rfpRecipientId,
      distributorId: recipient.distributorId,
      receivedAt: Date.now(),
      parsedLineItems: [],
      parseConfidence: "low",
      missingInfo: true,
      rawEmailBody,
      mailerooMessageId,
    });

    // (3) Move the recipient to `replied` (only from queued/sent/followed_up).
    if (recipient.emailStatus !== "replied" && recipient.emailStatus !== "failed") {
      await ctx.db.patch(rfpRecipientId, {
        emailStatus: "replied",
        repliedAt: Date.now(),
      });
    }

    // (4) Kick the Claude parser to fill in parsedLineItems + recommendation.
    await ctx.scheduler.runAfter(0, internal.quotes.parseInboundQuote, { quoteId });

    // (5) Trigger collect_quotes completion check on the owning run.
    const rfp = await ctx.db.get(recipient.rfpId);
    if (rfp) {
      const runs = await ctx.db
        .query("pipelineRuns")
        .withIndex("by_restaurantId", (q) => q.eq("restaurantId", rfp.restaurantId))
        .collect();
      const run = runs.find((r) => r.rfpId === rfp._id) ?? runs[0];
      if (run) {
        await ctx.scheduler.runAfter(0, internal.email.checkCollectQuotesDone, {
          runId: run._id,
          reason: "reply",
        });
      }
    }

    return { quoteId };
  },
});

// ── LLM-driven quote parser ────────────────────────────────────────
//
// Loads the basket the distributor was asked to quote, calls Claude with the
// raw email body + basket, then matches each parsed line back to an
// ingredientId (exact canonicalName lookup → fuzzball ≥ 0.92 fallback) and
// patches the quote row. Schedules a debounced recommendation regeneration
// so the UI sees the comparison/recommendation morph as replies stream in.

interface QuoteParseContext {
  quote: Doc<"quotes">;
  recipient: Doc<"rfpRecipients">;
  rfp: Doc<"rfps">;
  distributorName: string;
  basket: { ingredientId: Id<"ingredients">; canonicalName: string; quantity: number; unit: string }[];
  runId: Id<"pipelineRuns"> | null;
}

export const getQuoteParseContext = internalQuery({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }): Promise<QuoteParseContext | null> => {
    const quote = await ctx.db.get(quoteId);
    if (!quote) return null;
    const recipient = await ctx.db.get(quote.rfpRecipientId);
    if (!recipient) return null;
    const rfp = await ctx.db.get(recipient.rfpId);
    if (!rfp) return null;
    const distributor = await ctx.db.get(quote.distributorId);

    const basket: QuoteParseContext["basket"] = [];
    for (const line of rfp.ingredientList) {
      const ing = await ctx.db.get(line.ingredientId);
      if (ing) {
        basket.push({
          ingredientId: line.ingredientId,
          canonicalName: ing.canonicalName,
          quantity: line.quantity,
          unit: line.unit,
        });
      }
    }

    // Resolve owning pipelineRun (for debounced recommendation regen).
    let runId: Id<"pipelineRuns"> | null = null;
    const runs = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_restaurantId", (q) => q.eq("restaurantId", rfp.restaurantId))
      .collect();
    const run = runs.find((r) => r.rfpId === rfp._id) ?? null;
    if (run) runId = run._id;

    return {
      quote,
      recipient,
      rfp,
      distributorName: distributor?.name ?? "Distributor",
      basket,
      runId,
    };
  },
});

// Pure helper: best-match an extracted canonical name to a basket ingredient.
// Exact match first; fuzzy fallback at threshold 92.
function matchToBasket(
  extracted: string,
  basket: QuoteParseContext["basket"],
): Id<"ingredients"> | undefined {
  const norm = extracted.toLowerCase().trim();
  const exact = basket.find((b) => b.canonicalName === norm);
  if (exact) return exact.ingredientId;
  let bestId: Id<"ingredients"> | undefined;
  let bestScore = 0;
  for (const b of basket) {
    const score = token_set_ratio(norm, b.canonicalName);
    if (score >= 92 && score > bestScore) {
      bestId = b.ingredientId;
      bestScore = score;
    }
  }
  return bestId;
}

export const patchQuoteAfterParse = internalMutation({
  args: {
    quoteId: v.id("quotes"),
    parsedLineItems: v.array(
      v.object({
        ingredientId: v.optional(v.id("ingredients")),
        rawName: v.string(),
        price: v.optional(v.number()),
        unit: v.optional(v.string()),
        available: v.boolean(),
      }),
    ),
    deliveryTerms: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    leadTime: v.optional(v.string()),
    totalPrice: v.optional(v.number()),
    parseConfidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    missingInfo: v.boolean(),
  },
  handler: async (ctx, { quoteId, ...rest }) => {
    await ctx.db.patch(quoteId, rest);
  },
});

const RECOMMENDATION_DEBOUNCE_MS = 5_000;

export const parseInboundQuote = internalAction({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const context = await ctx.runQuery(internal.quotes.getQuoteParseContext, { quoteId });
    if (!context) return;

    const { quote, basket, distributorName, runId } = context;

    // Call Claude. parseQuoteReply does its own retry-once on Zod failure.
    let extraction;
    try {
      extraction = await parseQuoteReply(
        quote.rawEmailBody,
        basket.map((b) => ({
          canonicalName: b.canonicalName,
          quantity: b.quantity,
          unit: b.unit,
        })),
        distributorName,
      );
    } catch (e) {
      // Don't crash the cron; record a degraded quote so the agent can
      // still surface it (it'll get a missing-info follow-up).
      await ctx.runMutation(internal.quotes.patchQuoteAfterParse, {
        quoteId,
        parsedLineItems: [],
        parseConfidence: "low",
        missingInfo: true,
      });
      console.error(`[parseInboundQuote] LLM failed for ${quoteId}:`, e);
      return;
    }

    // Match each parsed line back to a basket ingredientId.
    const parsedLineItems = extraction.lines.map((line) => ({
      ingredientId: matchToBasket(line.canonicalName, basket),
      rawName: line.rawName,
      price: line.price ?? undefined,
      unit: line.unit,
      available: line.available,
    }));

    await ctx.runMutation(internal.quotes.patchQuoteAfterParse, {
      quoteId,
      parsedLineItems,
      deliveryTerms: extraction.deliveryTerms,
      paymentTerms: extraction.paymentTerms,
      leadTime: extraction.leadTime,
      totalPrice: extraction.totalPrice ?? undefined,
      parseConfidence: extraction.parseConfidence,
      missingInfo: extraction.missingInfo,
    });

    // Debounced recommendation regeneration: live updates as replies arrive.
    if (runId) {
      await ctx.scheduler.runAfter(
        RECOMMENDATION_DEBOUNCE_MS,
        internal.agent.generateRecommendation,
        { runId },
      );
    }
  },
});
