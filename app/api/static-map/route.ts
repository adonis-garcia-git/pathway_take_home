// Proxy for the Google Static Maps API. Keeps GOOGLE_PLACES_API_KEY
// server-side so the client never sees it. The browser hits
//   /api/static-map?center=lat,lng&markers=lat,lng|lat,lng&zoom=12&size=600x750
// and we forward to maps.googleapis.com with the key attached, then pipe
// the image bytes back.

import { NextRequest, NextResponse } from "next/server";

const UPSTREAM = "https://maps.googleapis.com/maps/api/staticmap";
const MAX_MARKERS = 25;
const MAX_W = 800;
const MAX_H = 1000;

// Return 502 with a short JSON body. The DistributorsBody catches the
// img onError and renders the stylized fallback map instead.
function bad(msg: string, status = 502) {
  return NextResponse.json(
    { error: msg.slice(0, 120) },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function parseLatLng(s: string | null): { lat: number; lng: number } | null {
  if (!s) return null;
  const [latS, lngS] = s.split(",");
  const lat = Number(latS);
  const lng = Number(lngS);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return bad("missing-key");

  const u = new URL(req.url);
  const center = parseLatLng(u.searchParams.get("center"));
  if (!center) return bad("bad-center");

  const zoomRaw = Number(u.searchParams.get("zoom") ?? "12");
  const zoom = Math.max(1, Math.min(20, Math.round(zoomRaw)));

  const sizeRaw = u.searchParams.get("size") ?? "600x750";
  const [wS, hS] = sizeRaw.split("x");
  const w = Math.max(100, Math.min(MAX_W, Number(wS) || 600));
  const h = Math.max(100, Math.min(MAX_H, Number(hS) || 750));

  const markersRaw = u.searchParams.get("markers") ?? "";
  const markerPoints = markersRaw
    .split("|")
    .map((p) => parseLatLng(p))
    .filter((p): p is { lat: number; lng: number } => p !== null)
    .slice(0, MAX_MARKERS);

  const params = new URLSearchParams();
  params.set("center", `${center.lat},${center.lng}`);
  params.set("zoom", String(zoom));
  params.set("size", `${w}x${h}`);
  params.set("scale", "2"); // retina
  params.set("maptype", "roadmap");
  // Subtle style so the underlying map doesn't overpower our pin overlay.
  params.append("style", "feature:poi|visibility:off");
  params.append("style", "feature:transit|visibility:off");
  params.append("style", "saturation:-30");
  for (const m of markerPoints) {
    params.append(
      "markers",
      `size:tiny|color:0x57BD86|${m.lat},${m.lng}`,
    );
  }
  params.set("key", key);

  const upstream = `${UPSTREAM}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(upstream, { signal: ctrl.signal });
    if (!res.ok) return bad(`upstream-${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Browser caches the image for a day, CDN/edge also caches for a
        // day, and serves stale for an extra week while revalidating. The
        // inputs (lat/lng/zoom) are derived from immutable distributor
        // coordinates, so the image is genuinely stable.
        "Cache-Control":
          "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, immutable",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.name : "fetch-failed";
    return bad(msg);
  } finally {
    clearTimeout(timer);
  }
}
