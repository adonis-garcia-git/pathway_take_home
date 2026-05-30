import { describe, expect, it } from "vitest";
import { scoreQuotes, type BasketLine, type QuoteInput } from "../recommendation";

const basket: BasketLine[] = [
  { ingredientId: "ing-tomato", canonicalName: "tomato", quantity: 10 },
  { ingredientId: "ing-basil", canonicalName: "basil", quantity: 2 },
  { ingredientId: "ing-mozz", canonicalName: "mozzarella cheese", quantity: 5 },
  { ingredientId: "ing-evoo", canonicalName: "olive oil", quantity: 1 },
  { ingredientId: "ing-veal", canonicalName: "veal shank", quantity: 8 },
];

const usda = new Map<string, number>([
  ["ing-tomato", 2],
  ["ing-basil", 12],
  ["ing-mozz", 8],
  ["ing-evoo", 40],
  ["ing-veal", 10],
]);

function qLine(id: string, price: number | null, available = true) {
  return { ingredientId: id, price, available };
}

describe("scoreQuotes", () => {
  it("picks a clearly cheapest + complete quote with high confidence, no approval", () => {
    const quotes: QuoteInput[] = [
      {
        distributorId: "d-lombardi",
        distributorName: "Lombardi",
        quoteId: "q1",
        totalPrice: 100,
        paymentTerms: "Net-30",
        parsedLineItems: basket.map((b) => qLine(b.ingredientId, 3)),
        missingInfo: false,
      },
      {
        distributorId: "d-other",
        distributorName: "Other Co",
        quoteId: "q2",
        totalPrice: 180,
        paymentTerms: "Net-15",
        parsedLineItems: basket.map((b) => qLine(b.ingredientId, 5)),
        missingInfo: false,
      },
      {
        distributorId: "d-third",
        distributorName: "Third",
        quoteId: "q3",
        totalPrice: 220,
        paymentTerms: "COD",
        parsedLineItems: basket.map((b) => qLine(b.ingredientId, 7)),
        missingInfo: false,
      },
    ];
    const draft = scoreQuotes(quotes, basket, usda);
    expect(draft.primary?.distributorId).toBe("d-lombardi");
    expect(draft.confidence).toBe("high");
    expect(draft.needsHumanApproval).toBe(false);
    expect(draft.splits).toHaveLength(1); // primary alone covers everything
    expect(draft.gaps).toHaveLength(0);
  });

  it("flags needsHumanApproval when top two are within 5%", () => {
    const quotes: QuoteInput[] = [
      {
        distributorId: "d-a",
        distributorName: "A",
        quoteId: "qa",
        totalPrice: 100,
        paymentTerms: "Net-30",
        parsedLineItems: basket.map((b) => qLine(b.ingredientId, 3)),
        missingInfo: false,
      },
      {
        distributorId: "d-b",
        distributorName: "B",
        quoteId: "qb",
        totalPrice: 103,
        paymentTerms: "Net-30",
        parsedLineItems: basket.map((b) => qLine(b.ingredientId, 3)),
        missingInfo: false,
      },
    ];
    const draft = scoreQuotes(quotes, basket, usda);
    expect(draft.needsHumanApproval).toBe(true);
    expect(draft.margin).toBeLessThan(0.1);
  });

  it("flags low completeness when top covers <60% of basket", () => {
    const partialLines = basket.slice(0, 2).map((b) => qLine(b.ingredientId, 3));
    const quotes: QuoteInput[] = [
      {
        distributorId: "d-partial",
        distributorName: "Partial",
        quoteId: "qp",
        totalPrice: 50,
        paymentTerms: "Net-30",
        parsedLineItems: partialLines,
        missingInfo: true,
      },
    ];
    const draft = scoreQuotes(quotes, basket, usda);
    expect(draft.needsHumanApproval).toBe(true);
    expect(draft.confidence).toBe("low");
  });

  it("splits across distributors when each covers a different slice", () => {
    const quotes: QuoteInput[] = [
      {
        distributorId: "d-produce",
        distributorName: "Produce Co",
        quoteId: "qp1",
        totalPrice: 60,
        paymentTerms: "Net-30",
        parsedLineItems: [
          qLine("ing-tomato", 2),
          qLine("ing-basil", 11),
          qLine("ing-mozz", null, false),
          qLine("ing-evoo", null, false),
          qLine("ing-veal", null, false),
        ],
        missingInfo: false,
      },
      {
        distributorId: "d-meat",
        distributorName: "Meat Co",
        quoteId: "qm1",
        totalPrice: 90,
        paymentTerms: "Net-30",
        parsedLineItems: [
          qLine("ing-tomato", null, false),
          qLine("ing-basil", null, false),
          qLine("ing-mozz", null, false),
          qLine("ing-evoo", null, false),
          qLine("ing-veal", 9),
        ],
        missingInfo: false,
      },
      {
        distributorId: "d-dairy",
        distributorName: "Dairy Co",
        quoteId: "qd1",
        totalPrice: 70,
        paymentTerms: "Net-15",
        parsedLineItems: [
          qLine("ing-tomato", null, false),
          qLine("ing-basil", null, false),
          qLine("ing-mozz", 7),
          qLine("ing-evoo", 38),
          qLine("ing-veal", null, false),
        ],
        missingInfo: false,
      },
    ];
    const draft = scoreQuotes(quotes, basket, usda);
    expect(draft.splits.length).toBeGreaterThanOrEqual(2);
    const splitDistributors = draft.splits.map((s) => s.distributorId);
    expect(splitDistributors).toContain("d-meat"); // only one covering veal
  });

  it("populates gaps when no distributor covers a basket line", () => {
    const quotes: QuoteInput[] = [
      {
        distributorId: "d-x",
        distributorName: "X",
        quoteId: "qx",
        totalPrice: 50,
        paymentTerms: "Net-30",
        parsedLineItems: [
          qLine("ing-tomato", 2),
          qLine("ing-basil", 11),
          qLine("ing-mozz", 7),
          qLine("ing-evoo", 38),
          // no veal line at all
        ],
        missingInfo: false,
      },
    ];
    const draft = scoreQuotes(quotes, basket, usda);
    expect(draft.gaps.map((g) => g.item)).toContain("veal shank");
  });

  it("returns primary=null + low confidence + approval when no quotes", () => {
    const draft = scoreQuotes([], basket, usda);
    expect(draft.primary).toBeNull();
    expect(draft.confidence).toBe("low");
    expect(draft.needsHumanApproval).toBe(true);
    expect(draft.gaps).toHaveLength(basket.length);
  });
});
