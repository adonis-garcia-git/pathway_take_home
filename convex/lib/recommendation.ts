// Pure scoring + draft generation for recommendations.
//
// The Convex-facing action lives in `convex/agent.ts` and is responsible for
// loading docs, calling Claude for the rationale, and writing the row. This
// file is pure TS so the scoring/splits/gaps logic is vitest-testable.
//
// Algorithm overview
//   per-quote score = 0.5*price + 0.35*completeness + 0.15*terms
//   priceScore       — quotes with totalPrice=null get 0; others normalized
//                       inverse vs min/max across the set.
//   completenessScore — basket lines covered with priced+available / basket.length
//   termsScore       — net-30 1.0, net-15 0.7, cod 0.3, unknown 0.5
//
// Splits
//   greedy: take top by totalScore; collect basket ingredients it can't fill;
//   pick the next-best quote that fills the most of those; repeat up to 3.
//
// needsHumanApproval
//   zero usable quotes, or top.missingInfo, or top.completeness < 0.6, or
//   margin (top - second) < 0.1.

export interface BasketLine {
  ingredientId: string;
  canonicalName: string;
  quantity: number;
}

export interface QuoteLine {
  ingredientId?: string;
  canonicalName?: string;
  price: number | null;
  available: boolean;
}

export interface QuoteInput {
  distributorId: string;
  distributorName: string;
  quoteId: string;
  totalPrice: number | null;
  parsedLineItems: QuoteLine[];
  paymentTerms?: string;
  deliveryTerms?: string;
  missingInfo: boolean;
}

export interface ScoredQuote {
  distributorId: string;
  distributorName: string;
  quoteId: string;
  priceScore: number;
  completenessScore: number;
  termsScore: number;
  totalScore: number;
  filledIngredientIds: Set<string>;
  missingInfo: boolean;
  totalPrice: number | null;
}

export interface Split {
  distributorId: string;
  distributorName: string;
  role: string;
  weeklyValue: number;
  filledIngredientIds: string[];
}

export interface RecommendationDraft {
  primary: ScoredQuote | null;
  scored: ScoredQuote[]; // sorted desc by totalScore
  splits: Split[];
  gaps: { item: string; reason: string }[];
  confidence: "high" | "medium" | "low";
  needsHumanApproval: boolean;
  margin: number;
  estBaseline: number;
  estSavings: number;
}

const WEIGHTS = { price: 0.5, completeness: 0.35, terms: 0.15 };

const TERMS_SCORES: Record<string, number> = {
  "net-30": 1,
  net30: 1,
  "net 30": 1,
  "net-15": 0.7,
  net15: 0.7,
  "net 15": 0.7,
  cod: 0.3,
  prepaid: 0.4,
};

function termScore(payment?: string): number {
  if (!payment) return 0.5;
  const key = payment.toLowerCase().replace(/[\s_]+/g, "-");
  for (const k of Object.keys(TERMS_SCORES)) {
    const normalized = k.replace(/\s+/g, "-");
    if (key.includes(normalized)) return TERMS_SCORES[k];
  }
  return 0.5;
}

function filledFor(quote: QuoteInput): Set<string> {
  const out = new Set<string>();
  for (const l of quote.parsedLineItems) {
    if (l.available && l.price !== null && l.price !== undefined && l.ingredientId) {
      out.add(l.ingredientId);
    }
  }
  return out;
}

export function scoreQuotes(
  quotes: QuoteInput[],
  basket: BasketLine[],
  usdaPriceByIngredientId: Map<string, number>,
): RecommendationDraft {
  const basketIds = new Set(basket.map((b) => b.ingredientId));

  // Estimated baseline = sum across basket of (usdaPrice * quantity).
  const estBaseline = basket.reduce((acc, b) => {
    const usd = usdaPriceByIngredientId.get(b.ingredientId) ?? 0;
    return acc + usd * b.quantity;
  }, 0);

  if (quotes.length === 0) {
    return {
      primary: null,
      scored: [],
      splits: [],
      gaps: basket.map((b) => ({ item: b.canonicalName, reason: "no quotes received" })),
      confidence: "low",
      needsHumanApproval: true,
      margin: 0,
      estBaseline,
      estSavings: 0,
    };
  }

  // Min total price across quotes that have one. We score price as a ratio
  // (minTotal / myTotal) so two near-identical quotes both score near 1.0 and
  // the margin between them reflects actual price proximity, not just rank
  // within the set.
  const totals = quotes.map((q) => q.totalPrice).filter((t): t is number => t !== null);
  const minTotal = totals.length ? Math.min(...totals) : 0;

  const scored: ScoredQuote[] = quotes.map((q) => {
    const filled = filledFor(q);
    const intersect = [...filled].filter((id) => basketIds.has(id)).length;
    const completenessScore = basket.length === 0 ? 0 : intersect / basket.length;
    const priceScore = q.totalPrice === null || q.totalPrice <= 0 ? 0 : minTotal / q.totalPrice;
    const tScore = termScore(q.paymentTerms);
    const totalScore =
      WEIGHTS.price * priceScore +
      WEIGHTS.completeness * completenessScore +
      WEIGHTS.terms * tScore;
    return {
      distributorId: q.distributorId,
      distributorName: q.distributorName,
      quoteId: q.quoteId,
      priceScore,
      completenessScore,
      termsScore: tScore,
      totalScore,
      filledIngredientIds: filled,
      missingInfo: q.missingInfo,
      totalPrice: q.totalPrice,
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);
  const primary = scored[0];
  const margin = scored.length >= 2 ? scored[0].totalScore - scored[1].totalScore : 1;

  // Splits: greedy multi-distributor coverage. Always include the primary; add
  // up to 2 more if they fill basket lines the primary missed.
  const covered = new Set<string>([...primary.filledIngredientIds].filter((id) => basketIds.has(id)));
  const splits: Split[] = [];
  splits.push(makeSplit(primary, quotes, basket, [...covered], "Core basket"));

  for (let i = 1; i < scored.length && splits.length < 3; i++) {
    const candidate = scored[i];
    const newlyFilled = [...candidate.filledIngredientIds].filter(
      (id) => basketIds.has(id) && !covered.has(id),
    );
    if (newlyFilled.length === 0) continue;
    for (const id of newlyFilled) covered.add(id);
    splits.push(
      makeSplit(candidate, quotes, basket, newlyFilled, roleFor(newlyFilled, basket)),
    );
    if (covered.size === basket.length) break;
  }

  const gaps = basket
    .filter((b) => !covered.has(b.ingredientId))
    .map((b) => ({ item: b.canonicalName, reason: "no distributor quoted this line" }));

  const needsHumanApproval =
    primary.completenessScore < 0.6 ||
    primary.missingInfo ||
    margin < 0.1 ||
    primary.totalPrice === null;

  let confidence: "high" | "medium" | "low" = "medium";
  if (margin >= 0.2 && primary.completenessScore >= 0.85 && !primary.missingInfo) {
    confidence = "high";
  } else if (needsHumanApproval) {
    confidence = "low";
  }

  const splitTotal = splits.reduce((acc, s) => acc + s.weeklyValue, 0);
  const estSavings = Math.max(0, estBaseline - splitTotal);

  return {
    primary,
    scored,
    splits,
    gaps,
    confidence,
    needsHumanApproval,
    margin,
    estBaseline,
    estSavings,
  };
}

function makeSplit(
  scored: ScoredQuote,
  quotes: QuoteInput[],
  basket: BasketLine[],
  filledForThisSplit: string[],
  role: string,
): Split {
  const quote = quotes.find((q) => q.quoteId === scored.quoteId);
  const value = quote
    ? quote.parsedLineItems.reduce((acc, line) => {
        if (
          line.ingredientId &&
          filledForThisSplit.includes(line.ingredientId) &&
          line.available &&
          line.price !== null &&
          line.price !== undefined
        ) {
          const basketLine = basket.find((b) => b.ingredientId === line.ingredientId);
          if (basketLine) return acc + line.price * basketLine.quantity;
        }
        return acc;
      }, 0)
    : 0;
  return {
    distributorId: scored.distributorId,
    distributorName: scored.distributorName,
    role,
    weeklyValue: Math.round(value * 100) / 100,
    filledIngredientIds: filledForThisSplit,
  };
}

function roleFor(filled: string[], basket: BasketLine[]): string {
  const names = filled
    .map((id) => basket.find((b) => b.ingredientId === id)?.canonicalName)
    .filter((n): n is string => Boolean(n))
    .slice(0, 3)
    .join(", ");
  return names ? `Fills ${names}` : "Fills basket gaps";
}
