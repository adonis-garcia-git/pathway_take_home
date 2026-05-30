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
    rawUsdaPayload: v.optional(v.any()),
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
    // Idempotency marker for the missing-info follow-up. Cron only fires when
    // missingInfo === true AND this is null.
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
  }).index("by_restaurantId", ["restaurantId"]),

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
});
