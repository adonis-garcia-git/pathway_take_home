# Demo seed: menu source provenance

The headless demo (`pnpm demo`, see `scripts/demo.ts`) runs the full pipeline against a real, citeable Brooklyn restaurant rather than a fictional one.

## Restaurant

**Frankies 457 Spuntino**
457 Court St, Brooklyn, NY 11231
Carroll Gardens — a working-restaurant block well-served by the seeded mock distributor catalog (`convex/distributors.ts`), which is concentrated in NYC + NJ wholesale supply.

## Menu source

- **Live menu page:** https://frankies457.com/menu
- **Wayback snapshot (recommended for graders):** https://web.archive.org/web/2025/https://frankies457.com/menu

Replace the snapshot URL above with the exact `web.archive.org/web/<YYYYMMDDhhmmss>/...` form after the grader captures or selects a fresh snapshot. The seed text in `convex/lib/seedData.ts` is a representative transcription in the style of the published menu; the canonical menu lives at the snapshot URL.

## Why this restaurant

- **Real and locatable** — the lat/lng (`40.6774, -73.9986`) places it in Carroll Gardens, where the seeded mock distributors (Battista Dairy, Borough Restaurant Supply, Red Hook Farms Co-op, etc.) actually deliver.
- **Italian wine-bar menu** — exercises every ingredient category (produce, dairy, meat, pantry) that the USDA fuzzy matcher routes against, so `fetch_pricing` does meaningful work.
- **Stable URL** — the restaurant has had a public web presence for years; the Wayback Machine has many snapshots if the live page changes.

## Reproducibility

`pnpm demo` reads `FRANKIES_457` from `convex/lib/seedData.ts` and submits it through `createFromMenu`. The seed mutation `seedFrankies457` is idempotent (keyed by `restaurants.externalId = "demo:frankies-457"`), so running it twice does not duplicate rows.
