import { mutation } from "./_generated/server";
import { STEPS } from "./lib/stepKeys";
import type { Doc, Id } from "./_generated/dataModel";

// Trattoria Lucia fixture data — sourced from design-reference/lib/data.ts and
// mirrored here as plain literals so this Convex file has no cross-package
// imports. Phase 2 (real menu parsing via Claude) will replace this seed; until
// then we use it to give the rest of the pipeline (pricing, distributors,
// emails) something to operate on end-to-end.

type SeedCategory = Doc<"ingredients">["category"];

const RESTAURANT = {
  name: "Trattoria Lucia",
  address: "214 Court St, Carroll Gardens, Brooklyn, NY 11231",
  lat: 40.6837,
  lng: -73.9962,
};

const MENU_TEXT = `TRATTORIA LUCIA — Menu

ANTIPASTI
· Insalata Caprese — mozzarella di bufala, heirloom tomato, basil, EVOO
· Bruschetta al Pomodoro — rustic bread, tomato, garlic, basil

PRIMI
· Tagliatelle al Ragù — beef & pork ragù, San Marzano, parmigiano
· Cacio e Pepe — spaghetti, pecorino romano, black pepper

SECONDI
· Osso Buco alla Milanese — veal shank, soffritto, white wine

DOLCI
· Tiramisù della Casa — mascarpone, espresso, savoiardi, cocoa`;

// 16 deduplicated ingredients. `canonicalName` is lowercased + parentheticals
// stripped so the USDA matcher has a clean head noun to fuzzy-match against.
const INGREDIENTS: {
  key: string; // stable join key into DISH_LINKS below
  canonicalName: string;
  category: SeedCategory;
  defaultUnit: string;
  rawName: string; // as it appears on the menu
  totalQty: number;
  forDishes: number;
  confidence: "high" | "medium" | "low";
  flag?: string;
}[] = [
  { key: "san-marzano", canonicalName: "san marzano tomato", category: "produce", defaultUnit: "lb", rawName: "San Marzano tomatoes (DOP)", totalQty: 40, forDishes: 2, confidence: "high" },
  { key: "ground-beef", canonicalName: "ground beef", category: "meat", defaultUnit: "lb", rawName: "Ground beef (80/20)", totalQty: 25, forDishes: 1, confidence: "high" },
  { key: "ground-pork", canonicalName: "ground pork", category: "meat", defaultUnit: "lb", rawName: "Ground pork", totalQty: 15, forDishes: 1, confidence: "high" },
  { key: "veal-shank", canonicalName: "veal shank", category: "meat", defaultUnit: "lb", rawName: "Veal shanks (cross-cut)", totalQty: 18, forDishes: 1, confidence: "medium", flag: "Cut assumed" },
  { key: "parm", canonicalName: "parmigiano reggiano", category: "dairy", defaultUnit: "lb", rawName: "Parmigiano-Reggiano", totalQty: 8, forDishes: 2, confidence: "high" },
  { key: "pecorino", canonicalName: "pecorino romano", category: "dairy", defaultUnit: "lb", rawName: "Pecorino Romano", totalQty: 6, forDishes: 1, confidence: "high" },
  { key: "bufala", canonicalName: "mozzarella di bufala", category: "dairy", defaultUnit: "lb", rawName: "Mozzarella di bufala", totalQty: 12, forDishes: 1, confidence: "medium", flag: "Import grade unclear" },
  { key: "mascarpone", canonicalName: "mascarpone", category: "dairy", defaultUnit: "lb", rawName: "Mascarpone", totalQty: 10, forDishes: 1, confidence: "low", flag: "Qty estimated" },
  { key: "tagliatelle", canonicalName: "fresh tagliatelle", category: "pantry", defaultUnit: "lb", rawName: "Fresh tagliatelle", totalQty: 20, forDishes: 1, confidence: "high" },
  { key: "spaghetti", canonicalName: "spaghetti", category: "pantry", defaultUnit: "lb", rawName: "Spaghetti (bronze-cut)", totalQty: 15, forDishes: 1, confidence: "high" },
  { key: "evoo", canonicalName: "extra virgin olive oil", category: "pantry", defaultUnit: "gal", rawName: "Extra-virgin olive oil", totalQty: 6, forDishes: 3, confidence: "high" },
  { key: "tomatoes", canonicalName: "heirloom tomato", category: "produce", defaultUnit: "lb", rawName: "Heirloom tomatoes", totalQty: 22, forDishes: 2, confidence: "high" },
  { key: "basil", canonicalName: "basil", category: "produce", defaultUnit: "lb", rawName: "Fresh basil", totalQty: 3, forDishes: 2, confidence: "low", flag: "Qty estimated" },
  { key: "soffritto", canonicalName: "soffritto", category: "produce", defaultUnit: "lb", rawName: "Soffritto mix (carrot·celery·onion)", totalQty: 30, forDishes: 2, confidence: "medium" },
  { key: "eggs", canonicalName: "eggs", category: "dairy", defaultUnit: "doz", rawName: "Eggs", totalQty: 12, forDishes: 1, confidence: "high" },
  { key: "espresso", canonicalName: "espresso beans", category: "pantry", defaultUnit: "lb", rawName: "Espresso beans", totalQty: 5, forDishes: 1, confidence: "medium" },
];

const DISHES: { name: string; section: string; confidence: "high" | "medium" | "low"; description?: string; needsReview: boolean; ingredientKeys: string[] }[] = [
  { name: "Tagliatelle al Ragù", section: "Primi", confidence: "high", needsReview: false, ingredientKeys: ["ground-beef", "ground-pork", "san-marzano", "soffritto", "parm", "tagliatelle"] },
  { name: "Cacio e Pepe", section: "Primi", confidence: "high", needsReview: false, ingredientKeys: ["spaghetti", "pecorino"] },
  { name: "Osso Buco alla Milanese", section: "Secondi", confidence: "medium", description: "Cut not specified — assumed cross-cut hind shank.", needsReview: true, ingredientKeys: ["veal-shank", "soffritto", "parm"] },
  { name: "Insalata Caprese", section: "Antipasti", confidence: "high", needsReview: false, ingredientKeys: ["bufala", "tomatoes", "basil", "evoo"] },
  { name: "Bruschetta al Pomodoro", section: "Antipasti", confidence: "high", needsReview: false, ingredientKeys: ["tomatoes", "basil", "evoo"] },
  { name: "Tiramisù della Casa", section: "Dolci", confidence: "low", description: "House recipe — quantities estimated from a 2-line menu description.", needsReview: true, ingredientKeys: ["mascarpone", "eggs", "espresso"] },
];

export const seedTrattoriaLucia = mutation({
  args: {},
  handler: async (ctx) => {
    const restaurantId: Id<"restaurants"> = await ctx.db.insert("restaurants", RESTAURANT);

    const menuId: Id<"menus"> = await ctx.db.insert("menus", {
      restaurantId,
      sourceType: "text",
      rawSource: MENU_TEXT,
      parsedAt: Date.now(), // pretend the parse already happened
    });

    // Insert ingredients keyed by their seed `key` for join lookup.
    const ingredientByKey = new Map<string, Id<"ingredients">>();
    for (const ing of INGREDIENTS) {
      const id = await ctx.db.insert("ingredients", {
        canonicalName: ing.canonicalName,
        category: ing.category,
        defaultUnit: ing.defaultUnit,
      });
      ingredientByKey.set(ing.key, id);
    }

    // Insert dishes + dishIngredients.
    for (const dish of DISHES) {
      const dishId = await ctx.db.insert("dishes", {
        menuId,
        name: dish.name,
        description: dish.description,
        confidence: dish.confidence,
        needsReview: dish.needsReview,
      });
      for (const ingKey of dish.ingredientKeys) {
        const ingredientId = ingredientByKey.get(ingKey);
        if (!ingredientId) continue;
        const ing = INGREDIENTS.find((i) => i.key === ingKey)!;
        const perDish = ing.totalQty / Math.max(1, ing.forDishes);
        await ctx.db.insert("dishIngredients", {
          dishId,
          ingredientId,
          rawName: ing.rawName,
          estimatedQuantity: Math.round(perDish * 10) / 10,
          unit: ing.defaultUnit,
          confidence: ing.confidence,
          assumptionNote: ing.flag,
        });
      }
    }

    const runId: Id<"pipelineRuns"> = await ctx.db.insert("pipelineRuns", {
      restaurantId,
      menuId,
      currentStep: "parse_menu",
      steps: STEPS.map((step) => ({ step, status: "pending" as const })),
      createdAt: Date.now(),
    });

    return { restaurantId, menuId, runId };
  },
});
