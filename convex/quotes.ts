// Quotes domain: inbound persistence + (stubbed) Claude parser.
//
// `recordInboundQuote` is the single mutation called by BOTH the webhook
// (convex/http.ts) and the dev simulator (convex/email.ts simulateInboundReply).
// All the dedupe + side-effect ordering lives here so the two callers share
// one code path.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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
//   2. Insert a stub `quotes` row with empty parsedLineItems + low confidence.
//   3. Patch the rfpRecipient row to `replied`.
//   4. Schedule the (stub) parser to fill in parsedLineItems later.
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

    // (2) Insert the quote stub.
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

    // (4) Kick the (stub) parser. It's a no-op for now; next phase wires Claude.
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

// Stub Claude parser. Replaced in the next phase by a real internalAction
// that fetches the quote, calls Anthropic with a Zod-validated schema, and
// patches parsedLineItems + parseConfidence + missingInfo.
export const parseInboundQuote = internalAction({
  args: { quoteId: v.id("quotes") },
  handler: async (_ctx, _args) => {
    // intentionally empty — wired in Phase 6 LLM parser
    return;
  },
});
