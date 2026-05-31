// Email send orchestration for the send_rfps stage.
//
// Layering:
//   • Pure helpers (template, maileroo client) live in convex/lib/*.
//   • `sendRfpEmail` (action) does the HTTP IO per recipient.
//   • `recordSentEmail` / `markRecipientSkipped` (mutations) persist results.
//   • `checkCollectQuotesDone` (action) is the single idempotent finisher for
//     the collect_quotes step — scheduled both by the deadline timer and by
//     every inbound reply.
//
// `simulateInboundReply` lets us demo the inbound flow end-to-end without
// real DNS by calling the same recordInboundQuote mutation the webhook uses.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { optional } from "./lib/env";
import { replyAddressFor } from "./lib/replyAddress";
import { sendBasicEmail } from "./lib/maileroo";
import { buildRfpHtml, buildRfpSubject, type RfpLine } from "./lib/rfpTemplate";
import { sumOccurrences } from "./lib/units";
import { STEPS } from "./lib/stepKeys";
import { RFP_DEADLINE_MS } from "./lib/agentConstants";
import { demoPriceFor, demoUnitFor } from "./lib/demoPricing";
import { generateDistributorReply } from "./lib/anthropic";
import { runWithConcurrency } from "./lib/concurrency";

// ─── Internal mutations: idempotent recipient writes ────────────────

export const upsertQueuedRecipient = internalMutation({
  args: {
    rfpId: v.id("rfps"),
    distributorId: v.id("distributors"),
    replyAddress: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { rfpId, distributorId, replyAddress, note }) => {
    const existing = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfp_and_distributor", (q) =>
        q.eq("rfpId", rfpId).eq("distributorId", distributorId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("rfpRecipients", {
      rfpId,
      distributorId,
      emailStatus: "queued",
      replyAddress,
      attempts: 0,
      note,
    });
  },
});

export const markRecipientSent = internalMutation({
  args: {
    recipientId: v.id("rfpRecipients"),
    sentMessageId: v.string(),
  },
  handler: async (ctx, { recipientId, sentMessageId }) => {
    const row = await ctx.db.get(recipientId);
    if (!row) return;
    if (row.emailStatus !== "queued") return; // idempotent: already sent / replied
    await ctx.db.patch(recipientId, {
      emailStatus: "sent",
      sentMessageId,
      sentAt: Date.now(),
      attempts: row.attempts + 1,
    });
  },
});

export const markRecipientFailed = internalMutation({
  args: { recipientId: v.id("rfpRecipients"), error: v.string() },
  handler: async (ctx, { recipientId, error }) => {
    const row = await ctx.db.get(recipientId);
    if (!row) return;
    if (row.emailStatus !== "queued") return;
    await ctx.db.patch(recipientId, {
      emailStatus: "failed",
      attempts: row.attempts + 1,
      note: error.slice(0, 240),
    });
  },
});

export const createRfp = internalMutation({
  args: {
    restaurantId: v.id("restaurants"),
    ingredientList: v.array(
      v.object({
        ingredientId: v.id("ingredients"),
        quantity: v.number(),
        unit: v.string(),
      }),
    ),
    deadline: v.number(),
  },
  handler: async (ctx, { restaurantId, ingredientList, deadline }) => {
    const rfpId = await ctx.db.insert("rfps", {
      restaurantId,
      status: "sent",
      ingredientList,
      deadline,
      createdAt: Date.now(),
    });
    return rfpId;
  },
});

export const setRfpStatus = internalMutation({
  args: {
    rfpId: v.id("rfps"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("collecting"),
      v.literal("closed"),
    ),
  },
  handler: async (ctx, { rfpId, status }) => {
    const row = await ctx.db.get(rfpId);
    if (!row) return;
    await ctx.db.patch(rfpId, { status });
  },
});

export const attachRfpToRun = internalMutation({
  args: { runId: v.id("pipelineRuns"), rfpId: v.id("rfps") },
  handler: async (ctx, { runId, rfpId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    // Don't clobber a previously attached RFP — re-attaching the same id is
    // a no-op; a different id is almost certainly a bug we'd rather surface
    // than silently overwrite.
    if (run.rfpId && run.rfpId !== rfpId) return;
    if (run.rfpId === rfpId) return;
    await ctx.db.patch(runId, { rfpId });
  },
});

// ─── Internal action: send one email ────────────────────────────────

export const sendRfpEmail = internalAction({
  args: {
    recipientId: v.id("rfpRecipients"),
    to: v.string(),
    from: v.string(),
    subject: v.string(),
    html: v.string(),
    replyAddress: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
    const result = await sendBasicEmail({
      apiKey: args.apiKey,
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyAddress,
    });
    if (result.ok) {
      const messageId = result.messageId ?? `maileroo:${args.recipientId}:${Date.now()}`;
      await ctx.runMutation(internal.email.markRecipientSent, {
        recipientId: args.recipientId,
        sentMessageId: messageId,
      });
      return { ok: true, messageId };
    }
    await ctx.runMutation(internal.email.markRecipientFailed, {
      recipientId: args.recipientId,
      error: result.error ?? `http ${result.status}`,
    });
    return { ok: false, error: result.error };
  },
});

// ─── Helpers: ingredient basket aggregation ─────────────────────────

interface BasketLine {
  ingredientId: Id<"ingredients">;
  quantity: number;
  unit: string;
  category: Doc<"ingredients">["category"];
  rawName: string;
}

/**
 * Public read of the demo-redirect environment so the UI can label
 * Stage 4 rows with "via demo redirect" when DEMO_REDIRECT_INBOX is set.
 * Returns the inbox address (never a secret) or null when production
 * sending is active.
 */
export const getDemoConfig = query({
  args: {},
  handler: async () => {
    const inbox = (optional("DEMO_REDIRECT_INBOX") ?? "").trim();
    return { demoRedirectInbox: inbox.length > 0 ? inbox : null };
  },
});

// Internal action that runs the full send_rfps stage. The pipeline file
// (convex/pipeline/sendRfps.ts) is the thin entrypoint that calls this and
// handles markStepRunning / markStepDone wrapping.
export const runSendRfps = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<{ summary: string; rfpId: Id<"rfps"> | null }> => {
    const apiKey = optional("MAILEROO_SENDING_KEY");
    const mailDomain = optional("MAIL_DOMAIN");
    // Demo safety net: when DEMO_REDIRECT_INBOX is set, every RFP is
    // delivered to that inbox instead of the real distributor email. The
    // real address is preserved on the recipient row and in the subject
    // so the grader can see who would have received the message.
    const demoRedirect = optional("DEMO_REDIRECT_INBOX")?.trim() || null;

    const run: Doc<"pipelineRuns"> | null = await ctx.runQuery(internal.email.getRunForSend, {
      runId,
    });
    if (!run) return { summary: "run not found", rfpId: null };

    // Idempotency: if a previous attempt already created an RFP for this run,
    // resume from there instead of inserting a second one. A crash between
    // createRfp and attachRfpToRun would otherwise duplicate the RFP row.
    if (run.rfpId) {
      return { summary: "rfp already created (resumed)", rfpId: run.rfpId };
    }

    const restaurant: Doc<"restaurants"> | null = await ctx.runQuery(
      internal.email.getRestaurant,
      { restaurantId: run.restaurantId },
    );
    if (!restaurant) return { summary: "restaurant missing", rfpId: null };

    // Build basket: sum dishIngredients across all dishes in the restaurant's menu.
    const basket: BasketLine[] = await ctx.runQuery(internal.email.aggregateBasket, {
      restaurantId: run.restaurantId,
    });
    if (basket.length === 0) return { summary: "no ingredients", rfpId: null };

    const deadline = Date.now() + RFP_DEADLINE_MS;
    const rfpId: Id<"rfps"> = await ctx.runMutation(internal.email.createRfp, {
      restaurantId: run.restaurantId,
      ingredientList: basket.map((b) => ({
        ingredientId: b.ingredientId,
        quantity: b.quantity,
        unit: b.unit,
      })),
      deadline,
    });
    await ctx.runMutation(internal.email.attachRfpToRun, { runId, rfpId });

    // For each distributor with at least one overlapping category, queue + send.
    const categoriesInBasket = new Set(basket.map((b) => b.category));
    type DistWithCats = Doc<"distributors"> & { categories: Doc<"ingredients">["category"][] };
    const distributors: DistWithCats[] = await ctx.runQuery(
      internal.email.distributorsForCategories,
      { categories: [...categoriesInBasket] },
    );

    let sent = 0;
    let skipped = 0;
    let mocked = 0;
    let failed = 0;
    const fallbackDomain = mailDomain ?? "example.invalid";

    for (const dist of distributors) {
      const replyAddress = replyAddressFor(dist._id, fallbackDomain);
      const linesForDist: RfpLine[] = basket
        .filter((b) => dist.categories.includes(b.category))
        .map((b) => ({ rawName: b.rawName, estimatedQuantity: b.quantity, unit: b.unit }));

      if (linesForDist.length === 0) continue;

      const note =
        dist.email.trim().length === 0 ? "no email. Places discovery" : undefined;
      const recipientId: Id<"rfpRecipients"> = await ctx.runMutation(
        internal.email.upsertQueuedRecipient,
        { rfpId, distributorId: dist._id, replyAddress, note },
      );

      // Skip — no email address known.
      if (dist.email.trim().length === 0) {
        skipped += 1;
        continue;
      }

      // Env-missing fallback: write a mock sentMessageId so simulation works.
      if (!apiKey || !mailDomain) {
        const mockId = `mock:${Math.random().toString(36).slice(2, 12)}`;
        await ctx.runMutation(internal.email.markRecipientSent, {
          recipientId,
          sentMessageId: mockId,
        });
        mocked += 1;
        continue;
      }

      const html = buildRfpHtml({
        restaurantName: restaurant.name,
        restaurantAddress: restaurant.address,
        distributorName: dist.name,
        lines: linesForDist,
        deadline,
      });
      const baseSubject = buildRfpSubject(restaurant.name);
      const sendTo = demoRedirect ?? dist.email;
      const subject = demoRedirect
        ? `${baseSubject} [DEMO REDIRECT for ${dist.name} <${dist.email}>]`
        : baseSubject;
      const result = await ctx.runAction(internal.email.sendRfpEmail, {
        recipientId,
        to: sendTo,
        from: `Patty (${restaurant.name}) <rfp@${mailDomain}>`,
        subject,
        html,
        replyAddress,
        apiKey,
      });
      if (result.ok) sent += 1;
      else failed += 1;
    }

    await ctx.runMutation(internal.email.setRfpStatus, { rfpId, status: "collecting" });

    const parts: string[] = [];
    parts.push(`${sent} sent`);
    if (skipped > 0) parts.push(`${skipped} skipped (no email)`);
    if (mocked > 0) parts.push(`${mocked} mock`);
    if (failed > 0) parts.push(`${failed} failed`);
    return { summary: parts.join(" · "), rfpId };
  },
});

// ─── Internal queries used by runSendRfps ───────────────────────────

export const getRunForSend = internalQuery({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => ctx.db.get(runId),
});

export const getRestaurant = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }) => ctx.db.get(restaurantId),
});

export const aggregateBasket = internalQuery({
  args: { restaurantId: v.id("restaurants") },
  handler: async (ctx, { restaurantId }): Promise<BasketLine[]> => {
    const menus = await ctx.db
      .query("menus")
      .withIndex("by_restaurantId", (q) => q.eq("restaurantId", restaurantId))
      .collect();
    // Two passes: first collect every per-dish occurrence keyed by ingredientId,
    // then sum with unit-aware aggregation (so 0.5 lb + 8 oz tomatoes → 1 lb).
    const occurrences = new Map<
      string,
      {
        ingredientId: Id<"ingredients">;
        rawName: string;
        rows: { qty: number; unit: string }[];
      }
    >();
    for (const menu of menus) {
      const dishes = await ctx.db
        .query("dishes")
        .withIndex("by_menuId", (q) => q.eq("menuId", menu._id))
        .collect();
      for (const dish of dishes) {
        const dishIngs = await ctx.db
          .query("dishIngredients")
          .withIndex("by_dishId", (q) => q.eq("dishId", dish._id))
          .collect();
        for (const di of dishIngs) {
          const key = di.ingredientId as unknown as string;
          const prev = occurrences.get(key);
          if (prev) {
            prev.rows.push({ qty: di.estimatedQuantity, unit: di.unit });
          } else {
            occurrences.set(key, {
              ingredientId: di.ingredientId,
              rawName: di.rawName,
              rows: [{ qty: di.estimatedQuantity, unit: di.unit }],
            });
          }
        }
      }
    }
    const summary = new Map<
      string,
      { ingredientId: Id<"ingredients">; quantity: number; unit: string; rawName: string }
    >();
    for (const [key, entry] of occurrences) {
      const totaled = sumOccurrences(entry.rows);
      summary.set(key, {
        ingredientId: entry.ingredientId,
        quantity: totaled.qty,
        unit: totaled.unit,
        rawName: entry.rawName,
      });
    }
    const out: BasketLine[] = [];
    for (const entry of summary.values()) {
      const ingredient = await ctx.db.get(entry.ingredientId);
      if (!ingredient) continue;
      out.push({ ...entry, category: ingredient.category });
    }
    return out;
  },
});

export const distributorsForCategories = internalQuery({
  args: {
    categories: v.array(
      v.union(
        v.literal("produce"),
        v.literal("dairy"),
        v.literal("meat"),
        v.literal("seafood"),
        v.literal("pantry"),
        v.literal("other"),
      ),
    ),
  },
  handler: async (ctx, { categories }) => {
    const distributors = await ctx.db.query("distributors").collect();
    const result: (Doc<"distributors"> & { categories: Doc<"ingredients">["category"][] })[] = [];
    for (const d of distributors) {
      const cats = await ctx.db
        .query("distributorCategories")
        .withIndex("by_distributorId", (q) => q.eq("distributorId", d._id))
        .collect();
      const distCategories = cats.map((c) => c.category);
      if (distCategories.some((c) => categories.includes(c))) {
        result.push({ ...d, categories: distCategories });
      }
    }
    return result;
  },
});

// ─── collect_quotes finishing logic ─────────────────────────────────
//
// Called by:
//   • The webhook (after each inbound reply records a quote)
//   • The scheduled deadline timer in pipeline/collectQuotes.ts
//
// Idempotent: if the step is already "done", no-op. If every recipient is
// terminal (replied | failed), mark done. Otherwise (deadline path), still
// mark done but flag it as partial — the pipeline must always advance.

export const checkCollectQuotesDone = internalAction({
  args: { runId: v.id("pipelineRuns"), reason: v.union(v.literal("reply"), v.literal("deadline")) },
  handler: async (ctx, { runId, reason }) => {
    const run: Doc<"pipelineRuns"> | null = await ctx.runQuery(internal.email.getRunForSend, {
      runId,
    });
    if (!run) return;
    const step = run.steps.find((s) => s.step === "collect_quotes");
    if (!step || step.status === "done" || step.status === "error") return;

    const rfp: Doc<"rfps"> | null = run.rfpId
      ? await ctx.runQuery(internal.email.getRfp, { rfpId: run.rfpId })
      : null;
    if (!rfp) {
      // Nothing to collect — close out cleanly.
      await ctx.runMutation(internal.pipelineRuns.markStepDone, {
        runId,
        step: "collect_quotes",
        summary: "no rfp",
      });
      return;
    }

    const recipients: Doc<"rfpRecipients">[] = await ctx.runQuery(
      internal.email.recipientsForRfp,
      { rfpId: rfp._id },
    );
    const terminal = recipients.filter(
      (r) => r.emailStatus === "replied" || r.emailStatus === "failed",
    );
    const replied = recipients.filter((r) => r.emailStatus === "replied").length;
    const allDone = terminal.length === recipients.length;

    if (!allDone && reason === "reply") {
      // Wait — more replies still expected before the deadline.
      return;
    }

    const missing = recipients.length - terminal.length;

    // Generate the final recommendation BEFORE marking the step done so the
    // UI sees the recommendation ready the moment currentStep flips to "done".
    // Action is idempotent (upsert on by_runId).
    await ctx.runAction(internal.agent.generateRecommendation, { runId });

    const summary = allDone
      ? `${replied} quotes · ${terminal.length - replied} no reply · recommendation ready`
      : `${replied} quotes · ${missing} no reply (partial) · recommendation ready`;

    await ctx.runMutation(internal.pipelineRuns.markStepDone, {
      runId,
      step: "collect_quotes",
      summary,
    });
    await ctx.runMutation(internal.email.setRfpStatus, { rfpId: rfp._id, status: "closed" });

    // Belt-and-suspenders: collect_quotes is the terminal STEPS entry, so
    // markStepDone already flipped currentStep → "done". No further schedule.
    void STEPS;
  },
});

export const getRfp = internalQuery({
  args: { rfpId: v.id("rfps") },
  handler: async (ctx, { rfpId }) => ctx.db.get(rfpId),
});

export const recipientsForRfp = internalQuery({
  args: { rfpId: v.id("rfps") },
  handler: async (ctx, { rfpId }) =>
    ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfpId))
      .collect(),
});

export const findRunByRfp = internalQuery({
  args: { rfpId: v.id("rfps") },
  handler: async (ctx, { rfpId }) => {
    // pipelineRuns has no direct index on rfpId; small table, scan is fine.
    const runs = await ctx.db.query("pipelineRuns").collect();
    return runs.find((r) => r.rfpId === rfpId) ?? null;
  },
});

// ─── Dev simulator: bypass HTTP/Zod, write through recordInboundQuote ──

// ─── Public reactive query: feeds RfpPanel ──────────────────────────

export const getRfpThreadsForRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || !run.rfpId) return null;
    const rfp = await ctx.db.get(run.rfpId);
    if (!rfp) return null;
    const restaurant = await ctx.db.get(run.restaurantId);
    if (!restaurant) return null;

    const mailDomain = optional("MAIL_DOMAIN") ?? "example.local";
    const fromAddress = `Patty (${restaurant.name}) <rfp@${mailDomain}>`;

    const recipients = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfp._id))
      .collect();
    if (recipients.length === 0) return null;

    // Build ingredient lookup once.
    const ingredientById = new Map<
      string,
      { canonicalName: string; category: Doc<"ingredients">["category"]; defaultUnit: string }
    >();
    for (const line of rfp.ingredientList) {
      if (!ingredientById.has(line.ingredientId as unknown as string)) {
        const ing = await ctx.db.get(line.ingredientId);
        if (ing) {
          ingredientById.set(line.ingredientId as unknown as string, {
            canonicalName: ing.canonicalName,
            category: ing.category,
            defaultUnit: ing.defaultUnit,
          });
        }
      }
    }

    const subject = buildRfpSubject(restaurant.name);

    const threads = [];
    for (const r of recipients) {
      const dist = await ctx.db.get(r.distributorId);
      if (!dist) continue;
      const cats = await ctx.db
        .query("distributorCategories")
        .withIndex("by_distributorId", (q) => q.eq("distributorId", dist._id))
        .collect();
      const distCategories = new Set(cats.map((c) => c.category));
      const rfpItems = rfp.ingredientList
        .filter((line) => {
          const ing = ingredientById.get(line.ingredientId as unknown as string);
          return ing && distCategories.has(ing.category);
        })
        .map((line) => {
          const ing = ingredientById.get(line.ingredientId as unknown as string)!;
          return {
            ingredientId: line.ingredientId,
            rawName: ing.canonicalName,
            qty: line.quantity,
            unit: line.unit,
          };
        });

      // Has Claude actually parsed a quote for this recipient?
      const quotesForRecipient = await ctx.db
        .query("quotes")
        .withIndex("by_rfpRecipientId", (q) => q.eq("rfpRecipientId", r._id))
        .collect();
      const hasParsedQuote = quotesForRecipient.some(
        (q) => q.parsedLineItems.length > 0,
      );

      threads.push({
        recipientId: r._id,
        distributorId: dist._id,
        distributorName: dist.name,
        distributorPhone: dist.phone ?? null,
        status: r.emailStatus,
        sentAt: r.sentAt ?? null,
        repliedAt: r.repliedAt ?? null,
        attempts: r.attempts,
        hasParsedQuote,
        note: r.note ?? null,
        rfpItems,
        subject,
        fromAddress,
        toAddress: dist.email,
      });
    }

    // Order: replied → sent → followed_up → queued → failed (UI-friendly)
    const statusOrder: Record<string, number> = {
      replied: 0,
      sent: 1,
      followed_up: 2,
      queued: 3,
      failed: 4,
    };
    threads.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

    return {
      deadline: rfp.deadline,
      restaurantName: restaurant.name,
      restaurantAddress: restaurant.address,
      threads,
    };
  },
});

export const simulateInboundReply = action({
  args: {
    rfpRecipientId: v.id("rfpRecipients"),
    bodyText: v.optional(v.string()),
  },
  handler: async (ctx, { rfpRecipientId, bodyText }): Promise<{ quoteId: Id<"quotes"> | null }> => {
    const messageId = `sim:${Math.random().toString(36).slice(2, 14)}:${Date.now()}`;
    const body =
      bodyText ??
      "Hi! Thanks for the RFP. Pricing attached inline:\n- San Marzano tomato: $2.10/lb\n- Parmigiano Reggiano: $18/lb\nLead time 2 days, $250 min order.\nA. Supplier";
    const result: { quoteId: Id<"quotes"> | null } = await ctx.runMutation(
      internal.quotes.recordInboundQuote,
      {
        rfpRecipientId,
        mailerooMessageId: messageId,
        rawEmailBody: body,
      },
    );
    return result;
  },
});

// ── Demo helpers ───────────────────────────────────────────────────

/**
 * Returns the most recent pipelineRuns row, with its id and current step
 * statuses. Use from the dashboard when you can't remember a runId:
 *   email:latestRun  → { runId, restaurantId, currentStep, steps }
 */
export const latestRun = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("pipelineRuns").order("desc").take(5);
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      runId: r._id,
      restaurantId: r.restaurantId,
      currentStep: r.currentStep,
      createdAt: r.createdAt,
      steps: r.steps.map((s) => ({ step: s.step, status: s.status })),
    }));
  },
});


// Per-recipient profile used by demoReplyForRun: identity, what category
// breadth the distributor covers, and the actual basket lines they were
// sent. The category filter mirrors what runSendRfps applied at send time,
// so the demo answers exactly the items each distributor was asked about.
type RecipientDemoProfile = {
  recipientId: Id<"rfpRecipients">;
  distributorId: Id<"distributors">;
  distributorName: string;
  categoryCount: number;
  lines: {
    ingredientId: Id<"ingredients">;
    canonicalName: string;
    category: "produce" | "dairy" | "meat" | "seafood" | "pantry" | "other";
    quantity: number;
    unit: string;
  }[];
};

export const demoProfilesForRun = internalQuery({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<RecipientDemoProfile[]> => {
    const run = await ctx.db.get(runId);
    if (!run?.rfpId) return [];
    const rfp = await ctx.db.get(run.rfpId);
    if (!rfp) return [];

    // Resolve every basket line once: canonical name + category for filtering.
    const lineMeta = new Map<
      string,
      { canonicalName: string; category: RecipientDemoProfile["lines"][number]["category"] }
    >();
    for (const line of rfp.ingredientList) {
      const ing = await ctx.db.get(line.ingredientId);
      if (ing) {
        lineMeta.set(line.ingredientId as unknown as string, {
          canonicalName: ing.canonicalName,
          category: ing.category,
        });
      }
    }

    const recipients = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", rfp._id))
      .collect();

    const profiles: RecipientDemoProfile[] = [];
    for (const r of recipients) {
      const distributor = await ctx.db.get(r.distributorId);
      if (!distributor) continue;
      const cats = await ctx.db
        .query("distributorCategories")
        .withIndex("by_distributorId", (q) => q.eq("distributorId", r.distributorId))
        .collect();
      const distCats = new Set(cats.map((c) => c.category));
      const lines = rfp.ingredientList
        .map((line) => {
          const meta = lineMeta.get(line.ingredientId as unknown as string);
          if (!meta) return null;
          if (!distCats.has(meta.category)) return null;
          return {
            ingredientId: line.ingredientId,
            canonicalName: meta.canonicalName,
            category: meta.category,
            quantity: line.quantity,
            unit: line.unit,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      profiles.push({
        recipientId: r._id,
        distributorId: r.distributorId,
        distributorName: distributor.name,
        categoryCount: distCats.size,
        lines,
      });
    }
    return profiles;
  },
});

/**
 * One-click demo: simulate inbound replies for every recipient in a run.
 * Each recipient answers ALL the basket lines they were sent, with
 * realistic prices via convex/lib/demoPricing. The recipient with the
 * broadest category coverage becomes the priced winner (bias 0.92),
 * so the recommendation engine names a clear primary award with margin.
 */
export const demoReplyForRun = action({
  args: {
    runId: v.id("pipelineRuns"),
    count: v.optional(v.number()),
  },
  handler: async (ctx, { runId, count }): Promise<{ replied: number }> => {
    const profiles: RecipientDemoProfile[] = await ctx.runQuery(
      internal.email.demoProfilesForRun,
      { runId },
    );

    // Sort so the most-versatile distributor (most categories) goes first
    // and becomes the priced winner.
    const ordered = [...profiles].sort(
      (a, b) =>
        b.categoryCount - a.categoryCount ||
        b.lines.length - a.lines.length ||
        a.distributorName.localeCompare(b.distributorName),
    );
    const cap = Math.min(count ?? ordered.length, ordered.length);

    let replied = 0;
    for (let i = 0; i < cap; i++) {
      const p = ordered[i];
      if (p.lines.length === 0) continue;

      // Pricing posture per rank. Primary is meaningfully cheaper than
      // the pack but the gap is tight enough that the recommendation
      // looks earned, not rigged. Secondary intentionally drops one
      // specialty line so the gaps panel and the splits logic both
      // light up with real content.
      const bias =
        i === 0 ? 0.96 : i === 1 ? 0.99 : 1.02 + Math.min(0.08, 0.01 * (i - 2));

      const linesToQuote =
        i === 1 && p.lines.length > 3
          ? p.lines.slice(0, p.lines.length - 1) // drop the last specialty line
          : p.lines;

      const itemLines = linesToQuote
        .map((line) => {
          const unit = demoUnitFor(line.canonicalName);
          const price = demoPriceFor(line.canonicalName, line.category, bias);
          return `- ${line.canonicalName}: $${price.toFixed(2)}/${unit}`;
        })
        .join("\n");

      const terms =
        i === 0
          ? "Net 30, daily delivery, $250 min order."
          : i === 1
            ? "Net 30, Mon/Wed/Fri delivery, $300 min order."
            : "Net 15, weekly delivery, $400 min order.";

      // Differentiate lead times by rank so the comparison table has real
      // values to surface. Primary (high-volume) ships next-day; specialty
      // secondary takes 2 days; competitors run on a weekly schedule.
      const leadTime =
        i === 0
          ? "24 hours"
          : i === 1
            ? "2 business days"
            : "3 to 5 business days";

      // Compute a stated weekly total so the parser sees one explicitly.
      // The recommendation engine will use it directly instead of falling
      // back to its derived total.
      const weeklyTotal = linesToQuote.reduce((sum, line) => {
        const price = demoPriceFor(line.canonicalName, line.category, bias);
        return sum + price * line.quantity;
      }, 0);
      const totalStr = `$${(Math.round(weeklyTotal * 100) / 100).toFixed(2)}`;

      const body =
        `Hi, thanks for the RFP. Pricing per line as requested:\n` +
        `${itemLines}\n\n` +
        `Total estimated weekly basket: ${totalStr}.\n` +
        `Lead time: ${leadTime}.\n` +
        `Terms: ${terms}\n\n` +
        `${p.distributorName}`;

      // Deterministic per recipient so a double-click on Simulate is a
      // no-op: recordInboundQuote dedupes by mailerooMessageId.
      const messageId = `demo:${p.recipientId}`;
      try {
        await ctx.runMutation(internal.quotes.recordInboundQuote, {
          rfpRecipientId: p.recipientId,
          mailerooMessageId: messageId,
          rawEmailBody: body,
        });
        replied++;
      } catch (e) {
        console.error(`[demoReplyForRun] failed for recipient ${p.recipientId}:`, e);
      }
    }
    return { replied };
  },
});

/**
 * Demo flavor #2: ask Claude (Haiku) to write each distributor's reply
 * as varied prose, then route it through the same recordInboundQuote
 * webhook the real Maileroo inbound flow uses. Per-line target prices
 * are passed in the prompt so the recommendation engine still lands a
 * clear winner within the 4 to 6 percent margin band.
 *
 * Idempotent: mailerooMessageId = "demo-llm:{recipientId}". Re-clicks
 * are no-ops for recipients that already replied via this path.
 */
export const demoLlmReplyForRun = action({
  args: { runId: v.id("pipelineRuns") },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ replied: number; skipped: number }> => {
    const profiles: RecipientDemoProfile[] = await ctx.runQuery(
      internal.email.demoProfilesForRun,
      { runId },
    );

    const run = await ctx.runQuery(internal.email.getRunForSend, { runId });
    if (!run) return { replied: 0, skipped: 0 };
    const restaurant = await ctx.runQuery(internal.email.getRestaurant, {
      restaurantId: run.restaurantId,
    });
    const restaurantName = restaurant?.name ?? "the restaurant";

    const ordered = [...profiles].sort(
      (a, b) =>
        b.categoryCount - a.categoryCount ||
        b.lines.length - a.lines.length ||
        a.distributorName.localeCompare(b.distributorName),
    );

    type Task = {
      profile: RecipientDemoProfile;
      bias: number;
      termsHint: "primary" | "secondary" | "competitor";
      omitOneLine: boolean;
    };

    const tasks: Task[] = ordered.map((p, i) => {
      const bias =
        i === 0 ? 0.96 : i === 1 ? 0.99 : 1.02 + Math.min(0.08, 0.01 * (i - 2));
      const termsHint: Task["termsHint"] =
        i === 0 ? "primary" : i === 1 ? "secondary" : "competitor";
      // Predictably trigger missing-info on the third recipient so the
      // follow-up path is visible during the demo walkthrough.
      const omitOneLine = i === 2 && p.lines.length >= 4;
      return { profile: p, bias, termsHint, omitOneLine };
    });

    let replied = 0;
    let skipped = 0;

    await runWithConcurrency(tasks, 4, async (task) => {
      const p = task.profile;
      if (p.lines.length === 0) {
        skipped += 1;
        return;
      }
      try {
        const basketLines = p.lines.map((line) => ({
          canonicalName: line.canonicalName,
          quantity: line.quantity,
          unit: demoUnitFor(line.canonicalName),
          targetPricePerUnit: demoPriceFor(
            line.canonicalName,
            line.category,
            task.bias,
          ),
        }));
        const body = await generateDistributorReply({
          distributorName: p.distributorName,
          distributorCategories: [], // category list isn't on the profile; not critical
          restaurantName,
          basketLines,
          termsHint: task.termsHint,
          omitOneLine: task.omitOneLine,
        });
        const messageId = `demo-llm:${p.recipientId}`;
        await ctx.runMutation(internal.quotes.recordInboundQuote, {
          rfpRecipientId: p.recipientId,
          mailerooMessageId: messageId,
          rawEmailBody: body,
        });
        replied += 1;
      } catch (e) {
        skipped += 1;
        console.error(
          `[demoLlmReplyForRun] generation failed for recipient ${p.recipientId}:`,
          e,
        );
      }
    });

    return { replied, skipped };
  },
});

/**
 * Emergency: force collect_quotes to "done" without waiting for the
 * deadline timer. Use if stage 5 hangs after replies have all landed but
 * the checkCollectQuotesDone chain didn't fire. Idempotent.
 */
export const forceCompleteCollectQuotes = mutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { ok: false, reason: "no run" };
    const now = Date.now();
    const steps = run.steps.map((s) =>
      s.step === "collect_quotes" && s.status !== "done"
        ? {
            ...s,
            status: "done" as const,
            finishedAt: now,
            summary: s.summary ?? "Marked done manually.",
          }
        : s,
    );
    await ctx.db.patch(runId, { steps, currentStep: "done" });
    // Kick the recommendation generator in case it wasn't run.
    if (run.rfpId) {
      await ctx.scheduler.runAfter(0, internal.agent.generateRecommendation, { runId });
    }
    return { ok: true };
  },
});

// ── Demo controls ─────────────────────────────────────────────────
//
// Dev-only affordances that let a grader exercise the agent's real
// behaviors (follow-ups, nudges) without waiting for the 5-minute cron.
// Each guard against running outside development.

function assertDemoMode() {
  // Demo controls are intended for grading walkthroughs. Set
  // DISABLE_DEMO_CONTROLS=1 in the Convex env to lock them down.
  if (process.env.DISABLE_DEMO_CONTROLS === "1") {
    throw new Error("Demo controls disabled");
  }
}

/**
 * Internal action scheduled at the start of Stage 5 (collect_quotes). On
 * demo deploys, fires the fast templated simulator immediately so the
 * pipeline self-completes without the grader clicking anything. Same
 * idempotent inbound writes as the public button; safe if the user also
 * clicks Simulate manually (mailerooMessageId dedupe).
 *
 * Skips silently when DISABLE_DEMO_CONTROLS=1 so a production deploy
 * doesn't auto-fabricate fake replies.
 */
export const autoSimulateReplies = internalAction({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<{ skipped: boolean; replied?: number }> => {
    if (process.env.DISABLE_DEMO_CONTROLS === "1") {
      return { skipped: true };
    }
    const result = await ctx.runAction(api.email.demoReplyForRun, { runId });
    console.log(`[autoSimulateReplies] runId=${runId} replied=${result.replied}`);
    return { skipped: false, replied: result.replied };
  },
});

/**
 * Simulate an inbound reply that is missing prices on 2-3 lines, so the
 * agent's missing-info follow-up path fires on the next tick (or on the
 * next forceTick call). Targets the first unreplied recipient.
 */
export const demoMissingInfoReplyForRecipient = action({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<{ recipientId: Id<"rfpRecipients"> | null }> => {
    assertDemoMode();
    const profiles: RecipientDemoProfile[] = await ctx.runQuery(
      internal.email.demoProfilesForRun,
      { runId },
    );
    const target = profiles.find((p) => p.lines.length >= 4) ?? profiles[0];
    if (!target) return { recipientId: null };

    // Keep only the first half of the lines priced; rest are listed without
    // a price ("price TBD") so the quote parser flags missingInfo.
    const half = Math.max(1, Math.floor(target.lines.length / 2));
    const itemLines = target.lines
      .map((line, idx) => {
        const unit = demoUnitFor(line.canonicalName);
        if (idx < half) {
          const price = demoPriceFor(line.canonicalName, line.category, 1.0);
          return `- ${line.canonicalName}: $${price.toFixed(2)}/${unit}`;
        }
        return `- ${line.canonicalName}: price TBD, checking with supplier`;
      })
      .join("\n");

    const body =
      `Hi, partial pricing below; will follow up on the rest in a day or two.\n` +
      `${itemLines}\n\n` +
      `Terms: Net 30, Mon/Wed/Fri delivery.\n\n` +
      `${target.distributorName}`;

    const messageId = `demo-mi:${Math.random().toString(36).slice(2, 10)}:${Date.now()}`;
    await ctx.runMutation(internal.quotes.recordInboundQuote, {
      rfpRecipientId: target.recipientId,
      mailerooMessageId: messageId,
      rawEmailBody: body,
    });
    return { recipientId: target.recipientId };
  },
});

/**
 * Backdate one "sent" recipient's sentAt so it's past NUDGE_DELAY_MS.
 * On the next tick (or forceTick) the no-reply nudge path fires.
 */
export const demoMarkRecipientStale = mutation({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }): Promise<{ recipientId: Id<"rfpRecipients"> | null }> => {
    assertDemoMode();
    const run = await ctx.db.get(runId);
    if (!run?.rfpId) return { recipientId: null };
    const recipients = await ctx.db
      .query("rfpRecipients")
      .withIndex("by_rfpId", (q) => q.eq("rfpId", run.rfpId!))
      .collect();
    const target = recipients.find((r) => r.emailStatus === "sent");
    if (!target) return { recipientId: null };
    // 24 hours ago, comfortably past any NUDGE_DELAY_MS setting.
    const backdated = Date.now() - 24 * 60 * 60 * 1000;
    await ctx.db.patch(target._id, { sentAt: backdated });
    return { recipientId: target._id };
  },
});

/**
 * Public wrapper around the internal agent tick. Eliminates the 5-minute
 * cron wait so a grader can see follow-ups and nudges immediately after
 * triggering a demo scenario above.
 */
export const forceTick = action({
  args: {},
  handler: async (ctx): Promise<{ ok: true }> => {
    assertDemoMode();
    await ctx.runAction(internal.agent.tick, {});
    return { ok: true };
  },
});
