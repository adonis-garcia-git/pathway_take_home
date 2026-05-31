// Helpers for the Google Static Maps overlay. Lat/lng → center+zoom such
// that every point fits inside a viewport of the given aspect ratio, plus a
// Web Mercator projection so our pin overlay aligns with the rendered tile.

export interface StaticMapParams {
  center: { lat: number; lng: number };
  zoom: number;
}

/**
 * Stylized bbox projection (no map underneath). Maps every point into a
 * 10..90 percent viewport so pins sit nicely inside the card with padding.
 * Used as the fallback when the Static Maps proxy fails.
 */
export function projectBbox(
  lat: number,
  lng: number,
  lats: number[],
  lngs: number[],
): { xPct: number; yPct: number } {
  const xs = lats.filter((v) => Number.isFinite(v) && v !== 0);
  const ys = lngs.filter((v) => Number.isFinite(v) && v !== 0);
  if (xs.length === 0 || ys.length === 0) return { xPct: 50, yPct: 50 };
  const minLat = Math.min(...xs);
  const maxLat = Math.max(...xs);
  const minLng = Math.min(...ys);
  const maxLng = Math.max(...ys);
  if (maxLat === minLat || maxLng === minLng) return { xPct: 50, yPct: 50 };
  const xPct = 10 + ((lng - minLng) / (maxLng - minLng)) * 80;
  // North is up.
  const yPct = 10 + (1 - (lat - minLat) / (maxLat - minLat)) * 80;
  return { xPct, yPct };
}

/**
 * Project (lat, lng) into a percentage offset inside a Google Static Maps
 * image of size (w, h) centered at (centerLat, centerLng) at the given zoom.
 * Web Mercator at 256-pixel tile scale, identical to what the Static Maps
 * API uses internally, so our overlay pins land on the right roads.
 */
export function projectMercator(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  w: number,
  h: number,
): { xPct: number; yPct: number } {
  const toWorld = (la: number, ln: number) => {
    const siny = Math.min(Math.max(Math.sin((la * Math.PI) / 180), -0.9999), 0.9999);
    return {
      x: 128 + ln * (256 / 360),
      y: 128 - (Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * 256,
    };
  };
  const scale = 2 ** zoom;
  const c = toWorld(centerLat, centerLng);
  const p = toWorld(lat, lng);
  const pxX = w / 2 + (p.x - c.x) * scale;
  const pxY = h / 2 + (p.y - c.y) * scale;
  return { xPct: (pxX / w) * 100, yPct: (pxY / h) * 100 };
}

/**
 * Pick a center and an integer zoom level that frames every point given.
 * Conservative: leaves ~20% padding on each side. Caps at zoom 14 (close).
 * For a single point, returns zoom 13. Degenerate empty input → NYC fallback.
 */
export function bboxToStaticMapParams(
  lats: number[],
  lngs: number[],
): StaticMapParams {
  const xs = lats.filter((v) => Number.isFinite(v) && v !== 0);
  const ys = lngs.filter((v) => Number.isFinite(v) && v !== 0);
  if (xs.length === 0 || ys.length === 0) {
    return { center: { lat: 40.6782, lng: -73.9442 }, zoom: 11 };
  }
  const minLat = Math.min(...xs);
  const maxLat = Math.max(...xs);
  const minLng = Math.min(...ys);
  const maxLng = Math.max(...ys);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };

  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  const span = Math.max(spanLat, spanLng);
  if (span === 0) return { center, zoom: 13 };

  // World spans 360 degrees of longitude at zoom 0; each zoom halves it.
  // Pad by 1.4× so points aren't pinned to the edge.
  const padded = span * 1.4;
  const zoom = Math.max(2, Math.min(14, Math.floor(Math.log2(360 / padded))));
  return { center, zoom };
}
