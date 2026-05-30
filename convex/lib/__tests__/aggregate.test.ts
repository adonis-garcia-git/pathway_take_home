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
  it("normalizes mass units to the base unit (lb) when picking defaultUnit", () => {
    // 3 oz (0.1875 lb) + 0.5 lb + 2 oz (0.125 lb) all share the mass dimension,
    // so they should converge on the base unit rather than the most-frequent string.
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "tomato", unit: "oz", estimatedQuantity: 3, category: "produce" })]),
      dish(1, [ing({ canonicalName: "tomato", unit: "lb", estimatedQuantity: 0.5, category: "produce" })]),
      dish(2, [ing({ canonicalName: "tomato", unit: "oz", estimatedQuantity: 2, category: "produce" })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].defaultUnit).toBe("lb");
    expect(result[0].occurrences).toHaveLength(3);
    // Mixed-unit occurrences should NOT carry the "mixed units" note because
    // they all live in the same (mass) dimension.
    expect(result[0].occurrences.every((o) => !o.assumptionNote?.includes("mixed units"))).toBe(true);
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

  it("flags occurrences with 'mixed units' when dimensions cross (mass vs volume)", () => {
    const result = aggregateIngredients([
      dish(0, [ing({ canonicalName: "tomato", unit: "lb", estimatedQuantity: 1, category: "produce" })]),
      dish(1, [ing({ canonicalName: "tomato", unit: "qt", estimatedQuantity: 1, category: "produce" })]),
    ]);
    expect(result).toHaveLength(1);
    expect(
      result[0].occurrences.every((o) => o.assumptionNote?.includes("mixed units")),
    ).toBe(true);
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
