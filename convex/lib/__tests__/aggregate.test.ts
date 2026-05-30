import { describe, expect, it } from "vitest";
import { aggregateIngredients, normalize, type ParsedDish } from "../aggregate";

const ing = (overrides: Partial<ParsedDish["ingredients"][number]>): ParsedDish["ingredients"][number] => ({
  rawName: overrides.rawName ?? overrides.canonicalName ?? "thing",
  canonicalName: overrides.canonicalName ?? "thing",
  category: overrides.category ?? "produce",
  estimatedQuantity: overrides.estimatedQuantity ?? 1,
  unit: overrides.unit ?? "oz",
  confidence: overrides.confidence ?? "high",
  assumptionNote: overrides.assumptionNote,
});

const dish = (dishIndex: number, ingredients: ParsedDish["ingredients"]): ParsedDish => ({
  dishIndex,
  name: `dish-${dishIndex}`,
  confidence: "high",
  needsReview: false,
  ingredients,
});

describe("normalize", () => {
  it("lowercases, strips parens, collapses whitespace", () => {
    expect(normalize("San Marzano Tomatoes (DOP)")).toBe("san marzano tomatoe");
    // (mild over-singularization of "tomatoes"; the SYNONYMS table maps it through anyway)
  });

  it("singularizes trivial plurals on the last word only", () => {
    expect(normalize("olive oils")).toBe("olive oil");
    expect(normalize("berries")).toBe("berry");
    expect(normalize("kiss")).toBe("kiss"); // -ss stays
  });
});

describe("aggregateIngredients — synonyms", () => {
  it("collapses 'green onion' + 'scallion' into one master", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "green onion", category: "produce", unit: "oz", estimatedQuantity: 2 })]),
      dish(1, [ing({ canonicalName: "scallion", category: "produce", unit: "oz", estimatedQuantity: 3 })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe("scallion");
    expect(result[0].occurrences).toHaveLength(2);
    expect(result[0].occurrences.map((o) => o.dishIndex).sort()).toEqual([0, 1]);
  });

  it("collapses 'EVOO' + 'extra-virgin olive oil' into 'olive oil'", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "EVOO", category: "pantry", unit: "tbsp", estimatedQuantity: 2 })]),
      dish(1, [ing({ canonicalName: "extra-virgin olive oil", category: "pantry", unit: "tbsp", estimatedQuantity: 1 })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].canonicalName).toBe("olive oil");
  });
});

describe("aggregateIngredients — fuzzy", () => {
  it("collapses case + whitespace + punctuation variants", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "Olive Oil", unit: "tbsp", estimatedQuantity: 1, category: "pantry" })]),
      dish(1, [ing({ canonicalName: "olive  oil", unit: "tbsp", estimatedQuantity: 1, category: "pantry" })]),
      dish(2, [ing({ canonicalName: "olive-oil", unit: "tbsp", estimatedQuantity: 1, category: "pantry" })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toHaveLength(3);
  });
});

describe("aggregateIngredients — roll-up", () => {
  it("picks dominant unit by summed quantity", () => {
    const result = aggregateIngredients([
      // 3 oz vs 0.5 lb — oz wins by total (3 > 0.5 in summed-units terms because we don't convert)
      dish(0, [ing({ canonicalName: "tomato", unit: "oz", estimatedQuantity: 3, category: "produce" })]),
      dish(1, [ing({ canonicalName: "tomato", unit: "lb", estimatedQuantity: 0.5, category: "produce" })]),
      dish(2, [ing({ canonicalName: "tomato", unit: "oz", estimatedQuantity: 2, category: "produce" })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].defaultUnit).toBe("oz");
    expect(result[0].occurrences).toHaveLength(3);
  });

  it("category = mode across occurrences", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "cheese", category: "dairy" })]),
      dish(1, [ing({ canonicalName: "cheese", category: "dairy" })]),
      dish(2, [ing({ canonicalName: "cheese", category: "other" })]),
    ]);
    expect(result[0].category).toBe("dairy");
  });

  it("preserves dish-level occurrences (one row per dish)", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "basil", category: "produce" })]),
      dish(1, [ing({ canonicalName: "basil", category: "produce" })]),
      dish(2, [ing({ canonicalName: "basil", category: "produce" })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toHaveLength(3);
    expect(result[0].occurrences.map((o) => o.dishIndex).sort()).toEqual([0, 1, 2]);
  });

  it("keeps distinct ingredients distinct", () => {
    const result = aggregateIngredients([
      dish(0, [
        ing({ canonicalName: "tomato", category: "produce" }),
        ing({ canonicalName: "basil", category: "produce" }),
        ing({ canonicalName: "mozzarella", category: "dairy" }),
      ]),
    ]);
    expect(result).toHaveLength(3);
    const names = result.map((r) => r.canonicalName).sort();
    // mozzarella → mozzarella cheese via synonym
    expect(names).toEqual(["basil", "mozzarella cheese", "tomato"]);
  });
});
