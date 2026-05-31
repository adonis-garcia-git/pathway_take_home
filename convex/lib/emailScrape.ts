// Best-effort email scraping for distributor websites.
//
// Google Places does not return contact emails. To make Stage 3 useful in
// production, we fetch each distributor's homepage and (optionally)
// /contact and /contact-us pages, then parse the HTML for the first
// `mailto:` link. If nothing is found, we return null and the caller
// leaves the row's email blank.
//
// Never throws. Bounded by short timeouts so a slow site can't stall the
// pipeline. Generic provider domains (gmail, outlook, etc.) are kept;
// many small food distributors legitimately use them as a primary inbox.

import { fetchWithTimeout } from "./net";

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const FETCH_TIMEOUT_MS = 3000;
const SUBPATHS = ["", "/contact", "/contact-us"];

function safeNormalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Drop fragment and query so we hit the canonical page.
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

function joinPath(base: string, subpath: string): string {
  if (subpath === "") return base;
  try {
    return new URL(subpath, base).toString();
  } catch {
    return base;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "emailScrape.fetch",
      headers: {
        // Some sites 403 on missing UA.
        "User-Agent":
          "Mozilla/5.0 (compatible; PathwayPattyBot/0.1; +https://workwithpathway.com)",
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;
    // Cap body to 200 KB; emails always sit near the top of the page.
    const text = await res.text();
    return text.slice(0, 200_000);
  } catch {
    return null;
  }
}

function extractEmail(html: string): string | null {
  const match = MAILTO_RE.exec(html);
  if (!match) return null;
  return match[1].toLowerCase();
}

/**
 * Returns the first email discovered on the website (homepage, then
 * /contact, then /contact-us). Returns null on any failure or when no
 * email is found.
 */
export async function scrapeEmailFromWebsite(websiteUrl: string): Promise<string | null> {
  const base = safeNormalizeUrl(websiteUrl);
  if (!base) return null;

  for (const sub of SUBPATHS) {
    const target = sub === "" ? base : joinPath(base, sub);
    const html = await fetchHtml(target);
    if (!html) continue;
    const email = extractEmail(html);
    if (email) return email;
  }
  return null;
}
