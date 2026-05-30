import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { optional } from "./lib/env";
import { replyAddressFor } from "./lib/replyAddress";
import {
  placesTextSearch,
  type PlacesResult,
  DEFAULT_SEARCH_RADIUS_METERS,
  WIDE_SEARCH_RADIUS_METERS,
} from "./lib/places";

// ── types ──────────────────────────────────────────────────────────

type Category = Doc<"distributorCategories">["category"];

const categoryValidator = v.union(
  v.literal("produce"),
  v.literal("dairy"),
  v.literal("meat"),
  v.literal("seafood"),
  v.literal("pantry"),
  v.literal("other"),
);

// Categories we send to Places (no "other" — it has no natural query template).
const PLACES_CATEGORIES = ["produce", "dairy", "meat", "seafood", "pantry"] as const;
type PlacesCategory = (typeof PLACES_CATEGORIES)[number];

const QUERY_TEMPLATES: Record<PlacesCategory, (address: string) => string> = {
  produce: (a) => `wholesale produce distributor near ${a}`,
  dairy: (a) => `wholesale dairy distributor near ${a}`,
  meat: (a) => `restaurant meat wholesaler near ${a}`,
  seafood: (a) => `seafood wholesale distributor near ${a}`,
  pantry: (a) => `specialty food importer near ${a}`,
};

// ── mock catalog ───────────────────────────────────────────────────
//
// Hand-curated regional NYC/NJ wholesale suppliers. Names/addresses are
// representative — coordinates are plausible Hunts Point / Brooklyn / NJ
// locations. Several entries carry multiple categories (e.g. an Italian
// importer that's both pantry AND produce) so the join table sees realistic
// many-to-many shape after dedup.
//
// Demo math: 6 categories × 8 "slots" = 48 category-rows, with ~18 of those
// rolled into ~12 multi-category distributors, yielding ~30 distinct
// distributors after the (source, externalId) dedup.

type MockDistributor = {
  slug: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  website: string;
  categories: Category[];
};

const MOCK_DISTRIBUTORS: readonly MockDistributor[] = [
  // ── produce (Hunts Point Terminal Market & friends) ──────────────
  { slug: "hunts-point-produce-coop", name: "Hunts Point Produce Cooperative", address: "355 Food Center Dr, Bronx, NY 10474", lat: 40.8108, lng: -73.8783, phone: "(718) 991-5300", website: "https://huntspointproduce.example.com", categories: ["produce"] },
  { slug: "baldor-bronx", name: "Baldor Specialty Foods", address: "155 Food Center Dr, Bronx, NY 10474", lat: 40.8112, lng: -73.8765, phone: "(718) 860-9100", website: "https://baldor.example.com", categories: ["produce", "dairy", "pantry"] },
  { slug: "drisco-greens", name: "Drisco Greens & Herbs", address: "12 49th St, Brooklyn, NY 11232", lat: 40.6545, lng: -74.0089, phone: "(718) 832-4400", website: "https://driscogreens.example.com", categories: ["produce"] },
  { slug: "fierro-brothers-produce", name: "Fierro Brothers Produce", address: "401 New York Ave, Jersey City, NJ 07307", lat: 40.7589, lng: -74.0489, phone: "(201) 798-6600", website: "https://fierrobros.example.com", categories: ["produce"] },
  { slug: "red-hook-farms-coop", name: "Red Hook Farms Co-op", address: "560 Columbia St, Brooklyn, NY 11231", lat: 40.6754, lng: -74.0102, phone: "(718) 855-2200", website: "https://redhookfarms.example.com", categories: ["produce"] },
  { slug: "valenti-organic-produce", name: "Valenti Organic Produce", address: "780 Metropolitan Ave, Brooklyn, NY 11211", lat: 40.7141, lng: -73.9438, phone: "(718) 384-1100", website: "https://valentiorganic.example.com", categories: ["produce", "other"] },
  { slug: "tre-stelle-importers", name: "Tre Stelle Italian Importers", address: "44 Garibaldi Ave, Lodi, NJ 07644", lat: 40.8804, lng: -74.0832, phone: "(201) 845-7700", website: "https://trestelle.example.com", categories: ["produce", "pantry"] },
  { slug: "sunrise-farm-direct", name: "Sunrise Farm Direct", address: "300 Food Center Dr, Bronx, NY 10474", lat: 40.811, lng: -73.879, phone: "(718) 542-9000", website: "https://sunrisefarm.example.com", categories: ["produce"] },

  // ── dairy ────────────────────────────────────────────────────────
  { slug: "calabro-cheese", name: "Calabro Cheese Wholesale", address: "580 Wheelers Farms Rd, East Haven, CT 06512", lat: 41.276, lng: -72.866, phone: "(212) 555-0142", website: "https://calabrocheese.example.com", categories: ["dairy"] },
  { slug: "battista-dairy", name: "Battista Dairy Distribution", address: "85 Bridge St, Brooklyn, NY 11201", lat: 40.7032, lng: -73.9882, phone: "(718) 596-4400", website: "https://battistadairy.example.com", categories: ["dairy"] },
  { slug: "five-borough-dairy", name: "Five Borough Dairy Co.", address: "1840 Cropsey Ave, Brooklyn, NY 11214", lat: 40.5912, lng: -73.9961, phone: "(718) 372-8800", website: "https://fiveboroughdairy.example.com", categories: ["dairy"] },
  { slug: "bufala-imports-nyc", name: "Bufala Imports NYC", address: "230 5th Ave, New York, NY 10001", lat: 40.7444, lng: -73.987, phone: "(212) 686-3300", website: "https://bufalaimports.example.com", categories: ["dairy", "pantry"] },
  { slug: "north-shore-creamery", name: "North Shore Creamery", address: "112 N Beverwyck Rd, Lake Hiawatha, NJ 07034", lat: 40.8845, lng: -74.3838, phone: "(201) 335-9000", website: "https://northshorecreamery.example.com", categories: ["dairy"] },
  { slug: "rosenberg-kosher-dairy", name: "Rosenberg Kosher Dairy", address: "414 Kent Ave, Brooklyn, NY 11249", lat: 40.7113, lng: -73.9651, phone: "(718) 388-5500", website: "https://rosenbergkosherdairy.example.com", categories: ["dairy", "other"] },
  { slug: "garden-state-eggs", name: "Garden State Egg Co.", address: "915 New Brunswick Ave, Rahway, NJ 07065", lat: 40.6066, lng: -74.2773, phone: "(201) 388-1600", website: "https://gardenstateeggs.example.com", categories: ["dairy"] },

  // ── meat ────────────────────────────────────────────────────────
  { slug: "pat-lafrieda-meats", name: "Pat LaFrieda Meat Purveyors", address: "3701 Tonnele Ave, North Bergen, NJ 07047", lat: 40.7956, lng: -74.0322, phone: "(201) 866-8900", website: "https://lafrieda.example.com", categories: ["meat"] },
  { slug: "esposito-pork-store", name: "Esposito Pork Store Wholesale", address: "357 W 38th St, New York, NY 10018", lat: 40.7559, lng: -73.9929, phone: "(212) 279-3298", website: "https://espositopork.example.com", categories: ["meat"] },
  { slug: "master-purveyors", name: "Master Purveyors Inc.", address: "355 Food Center Dr Bldg D, Bronx, NY 10474", lat: 40.8104, lng: -73.8775, phone: "(718) 842-0894", website: "https://masterpurveyors.example.com", categories: ["meat"] },
  { slug: "ottomanelli-brothers", name: "Ottomanelli Brothers Wholesale", address: "285 Bleecker St, New York, NY 10014", lat: 40.7311, lng: -74.0028, phone: "(212) 675-4217", website: "https://ottomanelli.example.com", categories: ["meat"] },
  { slug: "creekstone-northeast", name: "Creekstone Northeast Distribution", address: "1200 Brunswick Ave, Trenton, NJ 08638", lat: 40.2456, lng: -74.7659, phone: "(201) 599-0001", website: "https://creekstonene.example.com", categories: ["meat"] },
  { slug: "bronx-halal-meats", name: "Bronx Halal Meats Wholesale", address: "780 East 138th St, Bronx, NY 10454", lat: 40.8101, lng: -73.9159, phone: "(718) 401-2200", website: "https://bronxhalal.example.com", categories: ["meat", "other"] },
  { slug: "dibella-prime", name: "DiBella Prime Restaurant Supply", address: "121 Varick St, New York, NY 10013", lat: 40.7257, lng: -74.0048, phone: "(212) 925-7700", website: "https://dibellaprime.example.com", categories: ["meat"] },

  // ── seafood ─────────────────────────────────────────────────────
  { slug: "new-fulton-fish-market", name: "New Fulton Fish Market Co-op", address: "800 Food Center Dr, Bronx, NY 10474", lat: 40.8087, lng: -73.8755, phone: "(718) 378-2356", website: "https://newfultonfishmarket.example.com", categories: ["seafood"] },
  { slug: "blue-ribbon-fish", name: "Blue Ribbon Fish Co.", address: "800 Food Center Dr, Bronx, NY 10474", lat: 40.8088, lng: -73.8758, phone: "(718) 542-1715", website: "https://blueribbonfish.example.com", categories: ["seafood"] },
  { slug: "wild-edibles", name: "Wild Edibles Seafood", address: "55-15 Grand Ave, Maspeth, NY 11378", lat: 40.7297, lng: -73.9009, phone: "(718) 386-2050", website: "https://wildedibles.example.com", categories: ["seafood"] },
  { slug: "lobster-place", name: "The Lobster Place Wholesale", address: "75 9th Ave, New York, NY 10011", lat: 40.7427, lng: -74.006, phone: "(212) 255-5672", website: "https://lobsterplace.example.com", categories: ["seafood"] },
  { slug: "samuels-and-son-ne", name: "Samuels & Son Seafood (Northeast)", address: "3407 S Lawrence St, Philadelphia, PA 19148", lat: 39.9215, lng: -75.1632, phone: "(201) 336-3000", website: "https://samuelsseafood.example.com", categories: ["seafood"] },
  { slug: "fish-tales-bk", name: "Fish Tales Brooklyn Wholesale", address: "191 Court St, Brooklyn, NY 11201", lat: 40.6877, lng: -73.9933, phone: "(718) 246-1346", website: "https://fishtalesbk.example.com", categories: ["seafood"] },
  { slug: "ocean-bay-seafood", name: "Ocean Bay Seafood Distribution", address: "44 Ave U, Brooklyn, NY 11223", lat: 40.5953, lng: -73.9737, phone: "(718) 891-5500", website: "https://oceanbayseafood.example.com", categories: ["seafood"] },
  { slug: "north-atlantic-shellfish", name: "North Atlantic Shellfish Co.", address: "200 Marin Blvd, Jersey City, NJ 07302", lat: 40.7178, lng: -74.0392, phone: "(201) 432-4400", website: "https://northatlanticshellfish.example.com", categories: ["seafood"] },

  // ── pantry / specialty / dry goods ──────────────────────────────
  { slug: "lombardi-specialty-foods", name: "Lombardi Specialty Foods", address: "120 Lafayette St, New York, NY 10013", lat: 40.7188, lng: -74.0001, phone: "(212) 941-7770", website: "https://lombardispecialty.example.com", categories: ["pantry"] },
  { slug: "agata-valentina-wholesale", name: "Agata & Valentina Wholesale", address: "1505 1st Ave, New York, NY 10075", lat: 40.7733, lng: -73.9551, phone: "(212) 452-0690", website: "https://agatavalentina.example.com", categories: ["pantry", "produce"] },
  { slug: "buon-italia-imports", name: "Buon Italia Imports", address: "75 9th Ave, New York, NY 10011", lat: 40.7425, lng: -74.006, phone: "(212) 633-9090", website: "https://buonitalia.example.com", categories: ["pantry"] },
  { slug: "dry-goods-bk", name: "Brooklyn Dry Goods Restaurant Supply", address: "260 Meserole St, Brooklyn, NY 11206", lat: 40.7088, lng: -73.9355, phone: "(718) 821-9100", website: "https://bkdrygoods.example.com", categories: ["pantry", "other"] },
  { slug: "kalustyans-wholesale", name: "Kalustyan's Wholesale Spices", address: "123 Lexington Ave, New York, NY 10016", lat: 40.7437, lng: -73.9819, phone: "(212) 685-3451", website: "https://kalustyans.example.com", categories: ["pantry"] },
  { slug: "monte-carlo-imports", name: "Monte Carlo Italian Imports", address: "830 Atlantic Ave, Brooklyn, NY 11238", lat: 40.6839, lng: -73.9598, phone: "(718) 638-2400", website: "https://montecarloimports.example.com", categories: ["pantry", "dairy"] },
  { slug: "borough-restaurant-supply", name: "Borough Restaurant Supply Co.", address: "55 Bogart St, Brooklyn, NY 11206", lat: 40.7053, lng: -73.9333, phone: "(718) 366-4700", website: "https://boroughrestaurantsupply.example.com", categories: ["pantry"] },

  // ── other / non-perishable / packaging & beverages ───────────────
  { slug: "metro-restaurant-supply", name: "Metro Restaurant Supply", address: "184 Bowery, New York, NY 10012", lat: 40.7223, lng: -73.9944, phone: "(212) 226-9512", website: "https://metrorestaurantsupply.example.com", categories: ["other"] },
  { slug: "tristate-paper-packaging", name: "Tri-State Paper & Packaging", address: "55 Industrial Loop, Staten Island, NY 10309", lat: 40.5302, lng: -74.2204, phone: "(718) 984-1400", website: "https://tristatepaper.example.com", categories: ["other"] },
  { slug: "beverage-haus-nyc", name: "Beverage Haus NYC", address: "44-02 23rd St, Long Island City, NY 11101", lat: 40.7506, lng: -73.9491, phone: "(718) 482-3000", website: "https://beveragehaus.example.com", categories: ["other"] },
  { slug: "five-points-coffee-wholesale", name: "Five Points Coffee Wholesale", address: "31 W 8th St, New York, NY 10011", lat: 40.7323, lng: -73.9988, phone: "(212) 253-5700", website: "https://fivepointscoffee.example.com", categories: ["other", "pantry"] },
];

// ── public mutation: idempotent mock seed ─────────────────────────

/**
 * Insert (or no-op upsert) the regional mock distributor catalog. Safe to call
 * many times — keyed on `externalId = "mock:<slug>"` via the by_externalId
 * index. We insert the distributor row first to get its id, then patch the
 * email field with the per-distributor reply address (so Maileroo's inbound
 * webhook can route replies back to the correct rfpRecipient).
 */
export const seedDistributors = internalMutation({
  args: {},
  handler: async (ctx) => {
    const mailDomain = optional("MAIL_DOMAIN") ?? "example.local";

    let inserted = 0;
    let skipped = 0;
    let categoryRows = 0;

    for (const m of MOCK_DISTRIBUTORS) {
      const externalId = `mock:${m.slug}`;
      const existing = await ctx.db
        .query("distributors")
        .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
        .unique();

      let distributorId: Id<"distributors">;
      if (existing) {
        distributorId = existing._id;
        skipped++;
      } else {
        distributorId = await ctx.db.insert("distributors", {
          name: m.name,
          address: m.address,
          lat: m.lat,
          lng: m.lng,
          phone: m.phone,
          website: m.website,
          email: "", // patched below once we know the id
          source: "mock",
          externalId,
        });
        await ctx.db.patch(distributorId, {
          email: replyAddressFor(distributorId, mailDomain),
        });
        inserted++;
      }

      // Sync category rows (idempotent: only insert missing ones).
      for (const category of m.categories) {
        const existingCat = await ctx.db
          .query("distributorCategories")
          .withIndex("by_category_and_distributor", (q) =>
            q.eq("category", category).eq("distributorId", distributorId),
          )
          .unique();
        if (!existingCat) {
          await ctx.db.insert("distributorCategories", { distributorId, category });
          categoryRows++;
        }
      }
    }

    return {
      mocksInCatalog: MOCK_DISTRIBUTORS.length,
      inserted,
      skipped,
      categoryRowsInserted: categoryRows,
    };
  },
});

// ── internal mutation: upsert a Places-discovered distributor ─────

export const upsertPlacesDistributor = internalMutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    category: categoryValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("distributors")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    let distributorId: Id<"distributors">;
    let wasNew = false;

    if (existing) {
      distributorId = existing._id;
      // Keep contact info fresh on re-discovery; don't overwrite email
      // (Places has none — email stays "" so send_rfps will skip it).
      await ctx.db.patch(distributorId, {
        name: args.name,
        address: args.address,
        lat: args.lat,
        lng: args.lng,
        phone: args.phone,
        website: args.website,
      });
    } else {
      distributorId = await ctx.db.insert("distributors", {
        name: args.name,
        address: args.address,
        lat: args.lat,
        lng: args.lng,
        phone: args.phone,
        website: args.website,
        email: "", // Places gives no email — documented in docs/distributor-seed.md
        source: "google_places",
        externalId: args.externalId,
      });
      wasNew = true;
    }

    // Tag with category (idempotent).
    const existingCat = await ctx.db
      .query("distributorCategories")
      .withIndex("by_category_and_distributor", (q) =>
        q.eq("category", args.category).eq("distributorId", distributorId),
      )
      .unique();
    if (!existingCat) {
      await ctx.db.insert("distributorCategories", {
        distributorId,
        category: args.category,
      });
    }

    return { distributorId, wasNew };
  },
});

// ── internal action: discover from Google Places ──────────────────

/**
 * Run one Text Search query per category (5 queries total), dedupe by
 * `places.id` across categories, and upsert each result. Each distributor is
 * tagged with every category that surfaced it.
 *
 * Graceful degradation: placesTextSearch returns [] if the API key is missing,
 * so this whole function becomes a no-op without throwing.
 */
export const discoverFromPlaces = internalAction({
  args: {
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, { address, lat, lng }) => {
    const seen = new Set<string>(); // tracks places.id we've already upserted

    let newCount = 0;
    let existingCount = 0;
    let widenedCategories = 0;
    const MIN_RESULTS_PER_CATEGORY = 3;

    for (const category of PLACES_CATEGORIES) {
      const textQuery = QUERY_TEMPLATES[category](address);

      let results: PlacesResult[];
      try {
        results = await placesTextSearch(textQuery, { lat, lng }, {
          radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
        });
      } catch (e) {
        console.error(`[places] query failed for ${category}:`, e);
        continue;
      }

      // Sparse category — try once more with a wider radius. Avoids the
      // "zero distributors in this category" failure mode in less-dense areas.
      if (results.length < MIN_RESULTS_PER_CATEGORY) {
        try {
          const wider = await placesTextSearch(textQuery, { lat, lng }, {
            radiusMeters: WIDE_SEARCH_RADIUS_METERS,
          });
          if (wider.length > results.length) {
            results = wider;
            widenedCategories += 1;
          }
        } catch (e) {
          console.warn(`[places] widen-radius pass failed for ${category}:`, e);
        }
      }

      for (const place of results) {
        const externalId = place.id; // raw Places id; mocks use "mock:<slug>"
        const { wasNew } = await ctx.runMutation(
          internal.distributors.upsertPlacesDistributor,
          {
            externalId,
            name: place.name,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            phone: place.phone,
            website: place.website,
            category,
          },
        );

        if (!seen.has(externalId)) {
          seen.add(externalId);
          if (wasNew) newCount++;
          else existingCount++;
        }
      }
    }

    return {
      distinctPlaces: seen.size,
      newDistributors: newCount,
      existingDistributors: existingCount,
      widenedCategories,
    };
  },
});

// ── Public reactive query: feeds DistributorsPanel ─────────────────

/** Haversine distance in miles between two lat/lng pairs. */
function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  if (a.lat === 0 && a.lng === 0) return 0;
  if (b.lat === 0 && b.lng === 0) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const getDistributorsForRun = query({
  args: { runId: v.id("pipelineRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const restaurant = await ctx.db.get(run.restaurantId);
    if (!restaurant) return null;

    // Prefer the distributors that actually got RFPs (rfpRecipients exists).
    // Fallback: scan all distributors (find_distributors step ran but RFP not yet created).
    let distributorIds: Set<Id<"distributors">> = new Set();
    if (run.rfpId) {
      const recipients = await ctx.db
        .query("rfpRecipients")
        .withIndex("by_rfpId", (q) => q.eq("rfpId", run.rfpId!))
        .collect();
      for (const r of recipients) distributorIds.add(r.distributorId);
    }

    let docs: Doc<"distributors">[];
    if (distributorIds.size > 0) {
      docs = [];
      for (const id of distributorIds) {
        const d = await ctx.db.get(id);
        if (d) docs.push(d);
      }
    } else {
      docs = await ctx.db.query("distributors").collect();
    }
    if (docs.length === 0) return null;

    const restaurantCenter = { lat: restaurant.lat, lng: restaurant.lng };
    const out = [];
    for (const d of docs) {
      const cats = await ctx.db
        .query("distributorCategories")
        .withIndex("by_distributorId", (q) => q.eq("distributorId", d._id))
        .collect();
      const categories = cats.map((c) => c.category);
      const distanceMi = distanceMiles(restaurantCenter, { lat: d.lat, lng: d.lng });
      const provLabel: "verified" | "estimated" = d.source === "google_places" ? "verified" : "estimated";
      out.push({
        ...d,
        categories,
        distanceMi: Math.round(distanceMi * 10) / 10,
        provLabel,
        sourceTag: d.source === "google_places" ? "Google Places" : "Mock catalog",
      });
    }
    // closest first
    out.sort((a, b) => a.distanceMi - b.distanceMi);
    // cap to 20 for UI clarity
    return out.slice(0, 20);
  },
});

