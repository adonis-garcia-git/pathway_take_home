import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Reusable enum validators — kept here so the schema is the single source of truth.
const category = v.union(
  v.literal("produce"),
  v.literal("dairy"),
  v.literal("meat"),
  v.literal("seafood"),
  v.literal("pantry"),
  v.literal("other"),
);

const confidence = v.union(v.literal("high"), v.literal("medium"), v.literal("low"));

const stepKey = v.union(
  v.literal("parse_menu"),
  v.literal("fetch_pricing"),
  v.literal("find_distributors"),
  v.literal("send_rfps"),
  v.literal("collect_quotes"),
);

const stepStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("error"),
);

const currentStep = v.union(stepKey, v.literal("done"), v.literal("error"));

export default defineSchema({
  restaurants: defineTable({
    name: v.string(),
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
    sourceUrl: v.optional(v.string()),
    // Idempotency key for seed-style replays (e.g., "demo:frankies-457").
    // Real user-created restaurants leave this undefined.
    externalId: v.optional(v.string()),
    // Geocoding outcome. "ok" = real lat/lng from Nominatim; "seeded" =
    // hardcoded for sample data; "failed" = (0, 0) fallback after a
    // Nominatim error/no-results.
    geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("seeded"), v.literal("failed"))),
  }).index("by_externalId", ["externalId"]),

  menus: defineTable({
    restaurantId: v.id("restaurants"),
    sourceType: v.union(v.literal("url"), v.literal("image"), v.literal("text"), v.literal("pdf")),
    rawSource: v.string(),
    parsedAt: v.optional(v.number()),
  }).index("by_restaurantId", ["restaurantId"]),

  dishes: defineTable({
    menuId: v.id("menus"),
    name: v.string(),
    description: v.optional(v.string()),
    confidence,
    needsReview: v.boolean(),
    // Estimated weekly servings for this dish. Used to scale per-serving
    // ingredient quantities into weekly demand. Optional because older rows
    // pre-dating this field default to 50 at read time.
    estimatedServingsPerWeek: v.optional(v.number()),
  }).index("by_menuId", ["menuId"]),

  ingredients: defineTable({
    canonicalName: v.string(),
    category,
    defaultUnit: v.string(),
  })
    .index("by_canonicalName", ["canonicalName"])
    .index("by_category", ["category"]),

  dishIngredients: defineTable({
    dishId: v.id("dishes"),
    ingredientId: v.id("ingredients"),
    rawName: v.string(),
    estimatedQuantity: v.number(),
    unit: v.string(),
    confidence,
    assumptionNote: v.optional(v.string()),
  })
    .index("by_dishId", ["dishId"])
    .index("by_ingredientId", ["ingredientId"])
    .index("by_dish_and_ingredient", ["dishId", "ingredientId"]),

  ingredientPrices: defineTable({
    ingredientId: v.id("ingredients"),
    source: v.union(
      v.literal("usda_mars"),
      v.literal("usda_nass"),
      v.literal("estimated"),
      v.literal("mock"),
    ),
    price: v.optional(v.number()),
    unit: v.string(),
    region: v.optional(v.string()),
    reportDate: v.string(),
    weightedAvg: v.optional(v.number()),
    priceRangeLow: v.optional(v.number()),
    priceRangeHigh: v.optional(v.number()),
    matchConfidence: v.number(),
    unmatched: v.boolean(),
    trend: v.optional(v.number()),
    // Prior report date used as the trend's denominator (YYYY-MM-DD).
    // Surfaced in the UI tooltip so "vs prior report" reads honestly.
    trendPriorDate: v.optional(v.string()),
    // USDA-returned unit before our pack normalization (e.g. "cwt",
    // "25 lb carton"). Persisted so the tooltip can explain how a per-lb
    // price was derived.
    usdaUnit: v.optional(v.string()),
    // The MARS report slug the price came from. Used to label rows whose
    // region field is missing and to flag rows from unverified report
    // routings in the UI.
    reportSlug: v.optional(v.string()),
    // True when USDA returned the price in an opaque pack ("carton" with
    // no stated size, etc.) and we couldn't safely convert it to per-lb.
    // The UI renders the price as missing and excludes the row from the
    // weekly basket total.
    priceUnitIncomparable: v.optional(v.boolean()),
    rawUsdaPayload: v.optional(v.any()),
    // Provenance for source = "estimated". When "neighbors", we computed
    // the median of weak USDA matches; when "category", we used the static
    // category-average table. Older rows lack this field (optional).
    estimationDetail: v.optional(
      v.object({
        method: v.union(v.literal("neighbors"), v.literal("category")),
        category: v.optional(v.string()),
        contributingReports: v.optional(
          v.array(
            v.object({
              commodity: v.string(),
              price: v.number(),
              confidence: v.number(),
              region: v.optional(v.string()),
            }),
          ),
        ),
      }),
    ),
  })
    .index("by_ingredientId", ["ingredientId"])
    .index("by_ingredient_and_reportDate", ["ingredientId", "reportDate"]),

  distributors: defineTable({
    name: v.string(),
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    email: v.string(),
    source: v.union(v.literal("google_places"), v.literal("mock")),
    externalId: v.optional(v.string()),
    // "verified" = reply-routable email on file; "needs_enrichment" =
    // discovered via Places but no contact email (would enrich against
    // a B2B database in production).
    contactStatus: v.optional(v.union(v.literal("verified"), v.literal("needs_enrichment"))),
  })
    .index("by_source", ["source"])
    .index("by_externalId", ["externalId"]),

  distributorCategories: defineTable({
    distributorId: v.id("distributors"),
    category,
  })
    .index("by_distributorId", ["distributorId"])
    .index("by_category", ["category"])
    .index("by_category_and_distributor", ["category", "distributorId"]),

  rfps: defineTable({
    restaurantId: v.id("restaurants"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("collecting"),
      v.literal("closed"),
    ),
    ingredientList: v.array(
      v.object({
        ingredientId: v.id("ingredients"),
        quantity: v.number(),
        unit: v.string(),
      }),
    ),
    deadline: v.number(),
    createdAt: v.number(),
  })
    .index("by_restaurantId", ["restaurantId"])
    .index("by_status", ["status"]),

  rfpRecipients: defineTable({
    rfpId: v.id("rfps"),
    distributorId: v.id("distributors"),
    emailStatus: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("replied"),
      v.literal("followed_up"),
      v.literal("failed"),
    ),
    sentMessageId: v.optional(v.string()),
    replyAddress: v.string(),
    sentAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    attempts: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_rfpId", ["rfpId"])
    .index("by_distributorId", ["distributorId"])
    .index("by_rfp_and_distributor", ["rfpId", "distributorId"])
    .index("by_replyAddress", ["replyAddress"])
    .index("by_sentMessageId", ["sentMessageId"]),

  quotes: defineTable({
    rfpRecipientId: v.id("rfpRecipients"),
    distributorId: v.id("distributors"),
    receivedAt: v.number(),
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
    totalPrice: v.optional(v.number()),
    parseConfidence: confidence,
    missingInfo: v.boolean(),
    rawEmailBody: v.string(),
    mailerooMessageId: v.string(),
    // Idempotency marker for the missing-info follow-up on THIS quote row.
    // Each inbound reply creates a new quote row, so a distributor that
    // replies again gets a fresh follow-up scan. The two-round cap is
    // enforced upstream via rfpRecipients.attempts vs MAX_ATTEMPTS.
    missingInfoFollowUpSentAt: v.optional(v.number()),
    // Optional extras the LLM extractor may populate; persisted for the
    // comparison-table UI without forcing nullable everywhere else.
    paymentTerms: v.optional(v.string()),
    leadTime: v.optional(v.string()),
  })
    .index("by_rfpRecipientId", ["rfpRecipientId"])
    .index("by_distributorId", ["distributorId"])
    .index("by_mailerooMessageId", ["mailerooMessageId"]),

  pipelineRuns: defineTable({
    restaurantId: v.id("restaurants"),
    menuId: v.optional(v.id("menus")),
    rfpId: v.optional(v.id("rfps")),
    currentStep,
    steps: v.array(
      v.object({
        step: stepKey,
        status: stepStatus,
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
        summary: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_restaurantId", ["restaurantId"])
    .index("by_rfpId", ["rfpId"]),

  recommendations: defineTable({
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
    confidence,
    needsHumanApproval: v.boolean(),
    headline: v.string(),
    rationale: v.string(),
    estSavings: v.optional(v.number()),
    estBaseline: v.optional(v.number()),
    scoreSummary: v.any(),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_runId", ["runId"])
    .index("by_rfpId", ["rfpId"]),

  // Singleton row used by the optional debounced scheduleNextTick helper.
  // The shipping agent runs from the 5 minute cron in crons.ts and does
  // not write this row; it stays here for future use.
  agentSchedule: defineTable({
    nextRunAt: v.optional(v.number()),
  }),

  // Append-only narrative log of what the autonomous agent did. Drives the
  // <AgentTimeline> in stage 5 and the topbar ticker. Every state-changing
  // action writes a row.
  agentEvents: defineTable({
    runId: v.id("pipelineRuns"),
    at: v.number(),
    kind: v.union(
      v.literal("tick_scan"),
      v.literal("follow_up_sent"),
      v.literal("nudge_sent"),
      v.literal("quote_received"),
      v.literal("quote_parsed"),
      v.literal("recommendation_written"),
      v.literal("scheduled"),
      v.literal("send_failed"),
    ),
    summary: v.string(),
    recipientId: v.optional(v.id("rfpRecipients")),
    distributorName: v.optional(v.string()),
    nextTickAt: v.optional(v.number()),
  }).index("by_runId_and_at", ["runId", "at"]),
});
