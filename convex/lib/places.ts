// Google Places API (New) Text Search client.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//
// We only use Text Search. Field mask is fixed to the minimal set we persist on
// the distributors row. Caller passes a textQuery + a location bias (lat/lng,
// fixed 8km radius). All network IO lives here; the action is responsible for
// orchestration and persistence.

import { z } from "zod";
import { optional } from "./env";
import { fetchWithTimeout, withRetry, HttpError } from "./net";

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.displayName,places.formattedAddress,places.websiteUri,places.location,places.nationalPhoneNumber,places.id";
export const DEFAULT_SEARCH_RADIUS_METERS = 8_000;
export const WIDE_SEARCH_RADIUS_METERS = 25_000;

const placeSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  websiteUri: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
});

const responseSchema = z.object({
  places: z.array(placeSchema).optional(),
});

export type PlacesResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
};

export type LatLng = { lat: number; lng: number };

/**
 * Run a single Places Text Search query, biased to a circle around (lat,lng).
 * Returns [] if the GOOGLE_PLACES_API_KEY env is missing (graceful degradation
 * so the demo runs end-to-end on the seeded mock catalog).
 */
export const placesTextSearch = async (
  textQuery: string,
  center: LatLng,
  options: { radiusMeters?: number } = {},
): Promise<PlacesResult[]> => {
  const apiKey = optional("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    console.warn(
      "[places] GOOGLE_PLACES_API_KEY not set — skipping Places lookup",
      { textQuery },
    );
    return [];
  }

  const radius = options.radiusMeters ?? DEFAULT_SEARCH_RADIUS_METERS;
  const body = {
    textQuery,
    locationBias: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius,
      },
    },
  };

  const json: unknown = await withRetry(
    async () => {
      const res = await fetchWithTimeout(PLACES_ENDPOINT, {
        method: "POST",
        timeoutMs: 10_000,
        label: "places.textSearch",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.clone().text();
        throw new HttpError("places.textSearch", res.status, text);
      }
      return res.json();
    },
    { attempts: 2, baseMs: 400, label: "places.textSearch" },
  );

  const parsed = responseSchema.parse(json);
  const places = parsed.places ?? [];

  const results: PlacesResult[] = [];
  for (const p of places) {
    // Skip entries missing the fields we need to render a useful row.
    if (!p.displayName?.text || !p.formattedAddress || !p.location) continue;
    results.push({
      id: p.id,
      name: p.displayName.text,
      address: p.formattedAddress,
      lat: p.location.latitude,
      lng: p.location.longitude,
      phone: p.nationalPhoneNumber,
      website: p.websiteUri,
    });
  }
  return results;
};
