// USDA MARS catalog probe.
//
// Action invoked manually from the Convex dashboard to list the report
// catalog as the user's API key sees it. Useful for confirming that the
// slugs hardcoded in PRIMARY_REPORT_BY_CATEGORY actually exist and route
// to the reports we think they do. Read-only; never writes to the DB.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { optional } from "./lib/env";
import { fetchWithTimeout } from "./lib/net";

const MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2";

function basicAuthHeader(apiKey: string): string {
  const encoded =
    typeof btoa === "function"
      ? btoa(`${apiKey}:`)
      : Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

interface ProbeRow {
  slug?: string | number;
  name?: string;
  market?: string;
  frequency?: string;
}

interface ProbeResult {
  ok: boolean;
  reason?: string;
  status?: number;
  totalReturned?: number;
  reports?: ProbeRow[];
}

export const probeMarsReports = action({
  args: { limit: v.optional(v.number()) },
  handler: async (_ctx, { limit }): Promise<ProbeResult> => {
    const apiKey = optional("USDA_MARS_API_KEY");
    if (!apiKey) return { ok: false, reason: "USDA_MARS_API_KEY is not set" };
    const cap = Math.max(1, Math.min(limit ?? 80, 200));

    let res: Response;
    try {
      res = await fetchWithTimeout(`${MARS_BASE}/reports`, {
        method: "GET",
        timeoutMs: 10_000,
        label: "usda.mars.probe",
        headers: {
          Authorization: basicAuthHeader(apiKey),
          Accept: "application/json",
        },
      });
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }

    if (!res.ok) return { ok: false, status: res.status };

    const json: unknown = await res.json();
    const list: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { results?: unknown[] }).results)
        ? (json as { results: unknown[] }).results
        : [];

    const rows: ProbeRow[] = list.slice(0, cap).map((raw) => {
      const r = raw as Record<string, unknown>;
      const pickStr = (...keys: string[]): string | undefined => {
        for (const k of keys) {
          const val = r[k];
          if (typeof val === "string" && val.length > 0) return val;
          if (typeof val === "number") return String(val);
        }
        return undefined;
      };
      return {
        slug: pickStr("slug_id", "slugId", "report_id", "reportId", "id"),
        name: pickStr("report_name", "reportName", "title", "name"),
        market: pickStr("market_location_name", "marketLocationName", "market_name", "marketName"),
        frequency: pickStr("frequency", "publish_frequency", "publishFrequency"),
      };
    });

    return { ok: true, totalReturned: list.length, reports: rows };
  },
});
