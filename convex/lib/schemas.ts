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
      "Estimated raw quantity needed for ONE serving of this dish — one plate, not a week's worth, not for the whole menu. Use experienced-chef judgement.",
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
