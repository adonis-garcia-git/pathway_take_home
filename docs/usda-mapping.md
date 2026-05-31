# USDA MARS pricing integration — mapping & evidence

This doc covers Phase 3 (`fetch_pricing`): how the system maps an internal
ingredient (canonical name + category) to a USDA Market News MARS report,
which fields it parses out, and how it degrades when the API is unavailable
or returns no usable hit.

## API basics

- Base URL: `https://marsapi.ams.usda.gov/services/v1.2`
- Auth: HTTP Basic. **The MARS API key is the USERNAME; the password is BLANK.**
  Header looks like `Authorization: Basic <base64(key:)>`.
- Reports endpoint uses a literal space → must be URL-encoded as `%20`.
  The query param `lastReports` is case-sensitive.

Example (run from a shell with `USDA_MARS_API_KEY` exported):

```sh
curl -u "$USDA_MARS_API_KEY:" \
  "https://marsapi.ams.usda.gov/services/v1.2/reports/3324/report%20details?lastReports=1" \
  | head -c 2000
```

## Report slug verification

Both routing slugs were confirmed against the public USDA My Market News
report viewer:

- `3324` resolves to `https://mymarketnews.ams.usda.gov/viewReport/3324`,
  "National Retail Report Specialty Crops (FVWRETAIL)".
- `2315` resolves to `https://mymarketnews.ams.usda.gov/viewReport/2315`,
  "New York Terminal Market Vegetables Prices (NX_FV020)".

To confirm slugs with your own key at any time, run the
`marsProbe:probeMarsReports` action from the Convex dashboard. It hits
`${MARS_BASE}/reports` with HTTP Basic auth and returns the catalog.

## Field-name casing verification

**Status: NOT VERIFIED against a live response.** When this integration was
written, `.env.local` contained `USDA_MARS_API_KEY=` (empty value), so no
authenticated curl could be run. We therefore made the parser tolerant of
multiple casings rather than committing to one.

Expected field names (these are what the parser tries, in order):

| Concept              | Tried keys                                                  |
| -------------------- | ----------------------------------------------------------- |
| Commodity name       | `commodity`, `Commodity`                                    |
| Variety / subtype    | `variety`, `Variety`                                        |
| Weighted avg price   | `weighted_avg_price`, `weightedAvgPrice`, `wgtdAvgPrice`    |
| Price range low      | `price_range_low`, `priceRangeLow`, `lowPrice`              |
| Price range high     | `price_range_high`, `priceRangeHigh`, `highPrice`           |
| Report date          | `report_date`, `reportDate`, `report_begin_date`            |
| Unit                 | `unit`, `Unit`                                              |
| Region               | `region`, `Region`                                          |

All numeric fields are coerced through a `NumberLike` Zod transform that
strips `$`, `,`, and whitespace before parsing — USDA frequently returns
prices as strings like `"2.49"` or `"$2.49"`.

The response envelope may be either a bare JSON array or `{ results: [...] }`;
both are accepted.

When a real key becomes available, run the curl above, paste the first 2 KB
into this file, and prune the tolerant alternatives down to whatever the
report actually emits.

## Report routing table (category → primary/secondary)

Implemented in `convex/lib/fuzzy.ts` as `PRIMARY_REPORT_BY_CATEGORY` and
`SECONDARY_REPORT_BY_CATEGORY`. Summary:

| Category | Primary report (slug)                          | Secondary fallback |
| -------- | ---------------------------------------------- | ------------------ |
| produce  | 3324 — National Retail Specialty Crops         | 2315 — NY Terminal |
| dairy    | 3324                                           | 2315               |
| meat     | 2315 — NY Terminal Vegetables (wholesale)      | 3324               |
| seafood  | 2315                                           | 3324               |
| pantry   | 3324                                           | 2315               |
| other    | 3324                                           | 2315               |

We always pull `lastReports=2` so we have a prior date for the trend calc.

## Matching

`bestMatch(canonicalName, rows)` in `convex/lib/fuzzy.ts`:

1. Split canonical name on whitespace; last token is the **head noun**,
   everything before is the **modifier**. e.g. "san marzano tomato" →
   head=`tomato`, modifier=`san marzano`.
2. For each row, score `similarity(head, row.commodity)` as
   `max(token_sort_ratio, partial_ratio) / 100`. If the row has a `variety`
   AND we have a modifier, also score `similarity(modifier, row.variety)`
   and average the two.
3. Take the row with the highest score.

**Threshold:** `CONFIDENCE_THRESHOLD = 0.6`. Below this, the row is rejected
and we fall through to the secondary report; if that also fails we fall back
to a category average.

## Fallback price table

When no usable match exists (or in mock mode), we write a deliberately round
estimate so it reads as such, not as a measured price.

| Category | Fallback price | Unit |
| -------- | -------------- | ---- |
| produce  | $2.50          | lb   |
| dairy    | $6.00          | lb   |
| meat     | $8.00          | lb   |
| seafood  | $12.00         | lb   |
| pantry   | $4.00          | lb   |
| other    | $5.00          | lb   |

These are eyeballed central-tendency numbers for US wholesale, intended only
to keep the downstream RFP pipeline moving when USDA has nothing for a
specific ingredient. Refine as real data comes in.

## Provenance / `source` semantics

- `usda_mars` — actual USDA hit with `matchConfidence >= 0.6`. `unmatched = false`.
- `estimated` — USDA returned data but our best match scored below threshold.
  Price is the category average. `unmatched = true`, `matchConfidence` records
  the weak score we did get.
- `mock` — `USDA_MARS_API_KEY` is missing. Price is the category average.
  `unmatched = false` (this is a system-level mock, not a per-row miss),
  `matchConfidence = 0`. Step summary explicitly says `(mock mode)`.

## Pack unit normalization

USDA quotes prices in pack units that vary by report (`cwt`, `25 lb carton`,
`24 ct carton`, `bushel`, `each`, `dozen`). Before storage, the pack price
is divided by the pack's base-unit equivalence so the stored `price` is
per-lb (mass), per-each (count), or per-gal (volume). The original USDA
unit is preserved on the row as `usdaUnit` so the UI tooltip can explain
the conversion.

Packs we cannot disambiguate without commodity-specific info (a bare
`carton`, `case`, or `package`) are flagged `priceUnitIncomparable: true`.
The UI shows `–` in the price column for those rows and excludes them from
the weekly basket total. The recommendation engine asks distributors to
quote them directly.

The pack table lives in `convex/lib/units.ts` (`RETAIL_PACK_TABLE` plus the
existing `TABLE`). Add entries as new MARS reports surface new packs.

## Trend

`trend` on `ingredientPrices` is the signed percent change of
`weighted_avg_price` between the latest report date and the most recent
prior date that holds a matching commodity. Two decimal places, signed.
Commodity matching across dates uses fuzzy similarity (≥ 0.85) so minor
USDA label drift ("Roma Tomatoes" vs "Tomatoes Roma") still resolves. The
date used as denominator is persisted as `trendPriorDate` and surfaced in
the UI tooltip. `null` when no qualifying prior snapshot exists in the
four most recent reports.

## Idempotency

Upserts are keyed by `(ingredientId, reportDate)` via the
`by_ingredient_and_reportDate` index. Re-running the stage on the same day
overwrites the existing row in place rather than inserting a duplicate.

## Concurrency

Inside the action, ingredients are processed with a bounded worker pool of
size 4 (`runWithConcurrency` in `convex/pricing.ts`). The two USDA report
responses are cached on a per-invocation `Map<ReportSlug, NormalizedRow[]>`
so we never fetch the same report twice in one run.
