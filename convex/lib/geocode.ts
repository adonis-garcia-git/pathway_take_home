// Geocode a free-form address via OpenStreetMap Nominatim.
//
// Nominatim is free, requires no key, and is rate-limited to roughly
// 1 request per second per IP. Menu creation is interactive and rare,
// so the rate limit is not a concern. The function never throws: on any
// failure (network error, non-2xx, no results, bad payload) it returns
// null and the caller persists (0, 0) plus a `geocode_failed` marker.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "pathway-rfp-pipeline/0.1";
const TIMEOUT_MS = 3000;

export type GeocodeResult = { lat: number; lng: number };

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (trimmed.length === 0) return null;

  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { lat?: string; lon?: string };
    if (typeof first.lat !== "string" || typeof first.lon !== "string") return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
