// Zod schemas for the Claude menu-extraction tool. Each field has a .describe()
// so that when we convert to JSON Schema (zod-to-json-schema) and pass to the
// model as a tool input_schema, the field-level guidance travels with it —
// the schema effectively becomes part of the prompt.
//
// These types are also exported for use by aggregateIngredients and tests.

import { z } from "zod";

const Confidence = z
  .enum(["high", "medium", "low"])
  .describe(
    "Your subjective confidence in this extraction. 'low' means a human should review before procurement decisions are made.",
  );

const Category = z
  .enum(["produce", "dairy", "meat", "seafood", "pantry", "other"])
  .describe(
    "Procurement category used to route this ingredient to the right distributor. Use 'pantry' for dry goods, oils, vinegars, pasta, grains, spices. Use 'other' only as a last resort.",
  );

export const IngredientExtractionSchema = z.object({
  rawName: z
    .string()
    .describe(
      "The ingredient name exactly as it appears in the menu description. Examples: 'San Marzano tomatoes (DOP)', 'extra-virgin olive oil', 'mozzarella di bufala'.",
    ),
  canonicalName: z
    .string()
    .describe(
      "Normalized name for dedup across dishes: SINGULAR, lowercased, brand/cultivar/grade stripped. Examples: 'San Marzano tomatoes' → 'tomato'; 'fresh mozzarella di bufala' → 'mozzarella cheese'; 'EVOO' → 'olive oil'; 'ground beef (80/20)' → 'ground beef'; 'Pecorino Romano' → 'pecorino romano cheese'. Use the dedup-friendly common noun.",
    ),
  category: Category,
  estimatedQuantity: z
    .number()
    .positive()
    .describe(
      "Estimated raw quantity needed for ONE serving of this dish (one plate, not a week's worth, not for the whole menu). Use experienced-chef judgement.",
    ),
  unit: z
    .string()
    .describe(
      "Unit for estimatedQuantity. Prefer base units: 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'ea' (each). Lowercase, no plurals.",
    ),
  confidence: Confidence,
  assumptionNote: z
    .string()
    .optional()
    .describe(
      "If confidence is medium or low, briefly state the key assumption you made: 'cut not specified', 'quantity estimated from typical recipe', 'import grade unclear', 'house recipe inferred from name', etc. Omit when confidence is high.",
    ),
});

export const DishExtractionSchema = z.object({
  name: z.string().describe("Dish name as printed on the menu."),
  description: z
    .string()
    .optional()
    .describe("Short description from the menu, if any (the prose line under the dish name)."),
  confidence: Confidence.describe(
    "Confidence that this is actually a dish (not a section header, allergen note, or footer) AND that you can decompose it into ingredients reliably.",
  ),
  needsReview: z
    .boolean()
    .describe(
      "True if this dish needs a human eye: vague description, ambiguous cut/grade, house special with no recipe hints, dietary-restriction substitutions implied. Be generous: false positives are cheaper than missed reviews.",
    ),
  estimatedServingsPerWeek: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Your best guess at how many servings of this dish a small to medium restaurant sells in a week. Use experienced-chef judgment based on dish type and menu position. Reasonable defaults: high-volume appetizer or pizza around 150, entree around 80, special or composed plate around 40, dessert around 60. Omit only when you truly cannot guess; the system will default to 50 in that case.",
    ),
  ingredients: z
    .array(IngredientExtractionSchema)
    .describe(
      "Every distinct ingredient needed for ONE serving of this dish. Include staples (olive oil, garlic, salt) when obviously in the recipe. Don't enumerate trace amounts.",
    ),
});

export const MenuExtractionSchema = z.object({
  dishes: z
    .array(DishExtractionSchema)
    .describe(
      "Every distinct dish on the menu. Skip section headers ('Antipasti'), informational lines, allergen notes, prices, and footers.",
    ),
});

export type MenuExtraction = z.infer<typeof MenuExtractionSchema>;
export type DishExtraction = z.infer<typeof DishExtractionSchema>;
export type IngredientExtraction = z.infer<typeof IngredientExtractionSchema>;
export type Confidence = z.infer<typeof Confidence>;
export type Category = z.infer<typeof Category>;

// ── Quote reply extraction (Phase 6) ───────────────────────────────

export const QuoteLineSchema = z.object({
  rawName: z
    .string()
    .describe("Exact line text as written by the distributor (e.g. 'San Marzano tomatoes at $3.20/lb')."),
  canonicalName: z
    .string()
    .describe(
      "Singular, lowercased common noun for dedup matching against our basket. Same normalization as menu extraction: 'San Marzano tomatoes' → 'tomato'; 'EVOO' → 'olive oil'.",
    ),
  price: z
    .number()
    .nonnegative()
    .nullable()
    .describe("Per-unit price quoted. Null if the distributor said unavailable or didn't give a number for this line."),
  unit: z
    .string()
    .optional()
    .describe("Unit the price applies to: 'lb', 'each', 'case', 'gal', 'doz'."),
  available: z
    .boolean()
    .describe("False if the distributor said they don't carry the item or it's out of stock."),
  note: z
    .string()
    .optional()
    .describe("Free-text the distributor wrote about this line: substitution offers, minimum order, lead-time caveat, etc."),
});

export const QuoteExtractionSchema = z.object({
  lines: z
    .array(QuoteLineSchema)
    .describe(
      "Every basket line the distributor responded to, in any order. Include lines they said unavailable for (available:false). Skip pleasantries.",
    ),
  deliveryTerms: z
    .string()
    .optional()
    .describe("Verbatim delivery cadence: 'Mon/Thu', 'daily 6×/wk', '2-day lead', etc."),
  paymentTerms: z
    .string()
    .optional()
    .describe("Verbatim payment terms: 'Net-30', 'Net-15', 'COD', 'Prepaid', etc."),
  leadTime: z
    .string()
    .optional()
    .describe("Lead time if stated separately from delivery cadence."),
  totalPrice: z
    .number()
    .nonnegative()
    .nullable()
    .optional()
    .describe("Total weekly basket value if the distributor stated one. Null/undefined if they only quoted per-line."),
  missingInfo: z
    .boolean()
    .describe(
      "True if ANY requested basket item is absent from the reply OR a quoted line is missing its price. Triggers an autonomous follow-up.",
    ),
  parseConfidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident you are this extraction faithfully reflects the distributor's intent."),
});

export type QuoteExtraction = z.infer<typeof QuoteExtractionSchema>;

// ── Recommendation rationale (Phase 6) ─────────────────────────────

export const RecommendationRationaleSchema = z.object({
  headline: z
    .string()
    .describe(
      "One-sentence award decision, max ~90 chars. Example: 'Award core basket to Lombardi; pair Hudson for veal.'",
    ),
  rationale: z
    .string()
    .describe(
      "2–3 sentences justifying the pick grounded in price, completeness, and terms. Mention gaps or risks if any.",
    ),
});

export type RecommendationRationale = z.infer<typeof RecommendationRationaleSchema>;
