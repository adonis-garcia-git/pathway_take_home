# Distributor seed catalog

The `find_distributors` stage runs in two layers:

1. **Mock seed (always runs)** — `seedDistributors` mutation inserts a hand-curated catalog of ~40 regional NYC / NJ wholesale suppliers across all six categories (`produce`, `dairy`, `meat`, `seafood`, `pantry`, `other`). This guarantees the pipeline produces useful output even when `GOOGLE_PLACES_API_KEY` is unset.
2. **Google Places discovery (best-effort)** — `discoverFromPlaces` action runs one Text Search query per category (5 queries) biased to an 8km circle around the restaurant. Returns 0 results silently if the API key is missing.

## Catalog shape

Each catalog entry is typed as:

```ts
{ slug, name, address, lat, lng, phone, website, categories: Category[] }
```

Several distributors carry multiple categories — e.g. **Baldor Specialty Foods** (`produce` + `dairy` + `pantry`), **Tre Stelle Italian Importers** (`produce` + `pantry`), **Monte Carlo Italian Imports** (`pantry` + `dairy`). For each such entry the seed inserts **one** `distributors` row and **N** `distributorCategories` rows. This mirrors how a single Hunts Point importer realistically supplies multiple departments.

| Category | Slot count | Example entries |
| --- | --- | --- |
| produce | 8 | Hunts Point Produce Co-op, Baldor, Drisco Greens |
| dairy | 8 | Calabro Cheese, Battista Dairy, Bufala Imports NYC |
| meat | 8 | Pat LaFrieda, Master Purveyors, Esposito Pork Store |
| seafood | 8 | New Fulton Fish Market, Wild Edibles, The Lobster Place |
| pantry | 8 | Lombardi Specialty Foods, Buon Italia, Kalustyan's |
| other | 8 | Metro Restaurant Supply, Tri-State Paper, Beverage Haus NYC |

After dedup (~12 distributors are multi-category) the catalog yields **~40 distinct distributors** with ~48 category rows.

## Idempotency

All distributor writes are keyed on the `by_externalId` index:

- **Mock rows** → `externalId = "mock:<kebab-slug>"`. The `mock:` prefix guarantees mock ids can never collide with a Places id.
- **Places rows** → `externalId = <places.id>` (the opaque Google id, e.g. `ChIJ...`).

`seedDistributors` and `upsertPlacesDistributor` both look up by `externalId` first, then insert-or-patch. Running the stage twice produces zero duplicate rows. Re-discovery refreshes contact fields (`name`, `address`, `phone`, `website`) but never overwrites `email`.

## Email field

- **Mock rows** get `email = replyAddressFor(distributorId, MAIL_DOMAIN)` (where `MAIL_DOMAIN` defaults to `"example.local"` when unset). Inserts happen in two steps — insert first, then patch the email — because the reply address embeds the row's own `_id`.
- **Places rows** have `email = ""`. The Places API does not return email addresses and we don't scrape them. Downstream `send_rfps` is expected to **skip distributors with an empty email** and surface them as "outreach blocked — no contact email" so the operator can add one manually.

## Query templates

One Places Text Search per category. `{address}` is the restaurant's `address` string from the `restaurants` row.

| Category | Query |
| --- | --- |
| produce | `wholesale produce distributor near {address}` |
| dairy | `wholesale dairy distributor near {address}` |
| meat | `restaurant meat wholesaler near {address}` |
| seafood | `seafood wholesale distributor near {address}` |
| pantry | `specialty food importer near {address}` |

`other` has no natural Places query and is mock-only.

A single Place returned by multiple category queries is upserted **once** (deduped on `places.id` in-memory within a run) but tagged with **every** category that surfaced it via `distributorCategories` rows.
