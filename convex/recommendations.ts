// Public, reactive queries on the recommendation + comparison-table outputs.
//
//   getForRun(runId)       — hydrates the recommendation row with distributor
//                            docs for the primary and each split.
//   comparisonTable(runId) — derives per-distributor rows joined with their
//                            quote (if any) for the UI's quote comparison
//                            grid. Pure read-time join; no stored state.
//   approveRecommendation  — sets approvedAt to mark a recommendation accepted
//                            by a human. Designed for ApproveModal wiring.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

interface SplitWithDistributor {
  distributorId: Id<"distributors">;
  role: string;
  weeklyValue: number;
  distributor: Doc<"distributors"> | null;
}

interface RecommendationView {
  recommendation: Doc<"recommendations">;
  primary: Doc<"distributors"> | null;
  splits: SplitWithDistributor[];
}

export const getForRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<RecommendationView | null> => {
    const rec = await ctx.db
      .query("recommendations")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .first();
    if (!rec) return null;

    const primary = rec.primaryDistributorId ? await ctx.db.get(rec.primaryDistributorId) : null;
    const splits: SplitWithDistributor[] = [];
    for (const s of rec.splits) {
      const d = await ctx.db.get(s.distributorId);
      splits.push({ ...s, distributor: d ?? null });
    }
    return { recommendation: rec, primary, splits };
  },
});

interface ComparisonRow {
  recipientId: Id<"rfpRecipients">;
  distributor: Doc<"distributors">;
  emailStatus: Doc<"rfpRecipients">["emailStatus"];
  attempts: number;
  hasQuote: boolean;
  totalPrice?: number;
  itemsQuoted: number;
  itemsTotal: number;
  completePct: number;
  parseConfidence?: Doc<"quotes">["parseConfidence"];
  missingInfo?: boolean;
  deliveryTerms?: string;
  paymentTerms?: string;
  leadTime?: string;
  note?: string;
}

export const comparisonTable = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<ComparisonRow[]> => {
    const run = await ctx.db.get(runId);
    if (!run || !run.rfpId) return [];
    const rfp = await ctx.db.get(run.rfpId);
    if (!rfp) return [];

    const itemsTotal = rfp.ingredientList.length;
    const recipients = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfp._id))
      .collect();

    const rows: ComparisonRow[] = [];
    for (const r of recipients) {
      const distributor = await ctx.db.get(r.distributorId);
      if (!distributor) continue;

      // Most recent quote for this recipient (if any).
      const quotesForRecipient = await ctx.db
        .query("quotes")
        .withIndex("by_rfpRecipientId", (q) => q.eq("rfpRecipientId", r._id))
        .collect();
      const quote = quotesForRecipient.sort((a, b) => b.receivedAt - a.receivedAt)[0];

      let itemsQuoted = 0;
      if (quote) {
        itemsQuoted = quote.parsedLineItems.filter(
          (l) => l.available && typeof l.price === "number",
        ).length;
      }
      const completePct = itemsTotal === 0 ? 0 : (itemsQuoted / itemsTotal) * 100;

      rows.push({
        recipientId: r._id,
        distributor,
        emailStatus: r.emailStatus,
        attempts: r.attempts,
        hasQuote: Boolean(quote),
        totalPrice: quote?.totalPrice,
        itemsQuoted,
        itemsTotal,
        completePct,
        parseConfidence: quote?.parseConfidence,
        missingInfo: quote?.missingInfo,
        deliveryTerms: quote?.deliveryTerms,
        paymentTerms: quote?.paymentTerms,
        leadTime: quote?.leadTime,
        note: r.note,
      });
    }

    rows.sort((a, b) => {
      if (b.completePct !== a.completePct) return b.completePct - a.completePct;
      return (a.totalPrice ?? Infinity) - (b.totalPrice ?? Infinity);
    });
    return rows;
  },
});

export const approveRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, { recommendationId }) => {
    await ctx.db.patch(recommendationId, { approvedAt: Date.now() });
  },
});
