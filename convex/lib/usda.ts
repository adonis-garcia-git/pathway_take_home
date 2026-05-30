// USDA Market News MARS API client.
//
// Base: https://marsapi.ams.usda.gov/services/v1.2
// Auth: HTTP Basic with the API key as USERNAME and a BLANK password.
//
// We deliberately use plain `fetch` (no SDK). All responses are validated with
// Zod using `.passthrough()` so unrecognized fields don't blow up — USDA's
// payloads vary across reports.
//
// Field-name casing note: see docs/usda-mapping.md. We tolerate snake_case AND
// camelCase by trying both keys in `coalesce()` before falling back to a
// "no_data" row.

import { z } from "zod";
import type { ReportSlug } from "./fuzzy";
import { fetchWithTimeout, withRetry, HttpError } from "./net";

const MARS_BASE = "https://marsapi.ams.usda.gov/services/v1.2";

/** Build the HTTP Basic header from the MARS key (username:blank-password). */
function basicAuthHeader(apiKey: string): string {
  // btoa is available in the Convex runtime (V8 isolates / modern Node).
  const encoded =
    typeof btoa === "function"
      ? btoa(`${apiKey}:`)
      : Buffer.from(`${apiKey}:`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

// ── Zod schemas (passthrough — USDA payloads vary by report) ───────────────

const NumberLike = z.union([z.number(), z.string()]).transform((v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned.toLowerCase() === "n/a") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
});

const OptionalNumberLike = NumberLike.nullable().optional();

// Tolerant report-row schema. We accept both snake_case and camelCase variants
// for every field we care about. Anything else is preserved via passthrough.
const ReportRowSchema = z
  .object({
    commodity: z.string().optional(),
    Commodity: z.string().optional(),
    variety: z.string().optional(),
    Variety: z.string().optional(),
    weighted_avg_price: OptionalNumberLike,
    weightedAvgPrice: OptionalNumberLike,
    wgtdAvgPrice: OptionalNumberLike,
    wtd_avg_price: OptionalNumberLike,
    price_range_low: OptionalNumberLike,
    priceRangeLow: OptionalNumberLike,
    lowPrice: OptionalNumberLike,
    low_price: OptionalNumberLike,
    mostly_low_price: OptionalNumberLike,
    price_range_high: OptionalNumberLike,
    priceRangeHigh: OptionalNumberLike,
    highPrice: OptionalNumberLike,
    high_price: OptionalNumberLike,
    mostly_high_price: OptionalNumberLike,
    report_date: z.string().optional(),
    reportDate: z.string().optional(),
    report_begin_date: z.string().optional(),
    unit: z.string().optional(),
    Unit: z.string().optional(),
    region: z.string().optional(),
    Region: z.string().optional(),
  })
  .passthrough();

type RawReportRow = z.infer<typeof ReportRowSchema>;

// Some MARS endpoints return `{ results: [...] }`, others a bare array.
const ReportEnvelopeSchema = z.union([
  z.array(ReportRowSchema),
  z.object({ results: z.array(ReportRowSchema) }).passthrough(),
]);

const CommodityRowSchema = z
  .object({
    commodity_name: z.string().optional(),
    commodityName: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const CommoditiesEnvelopeSchema = z.union([
  z.array(CommodityRowSchema),
  z.object({ results: z.array(CommodityRowSchema) }).passthrough(),
]);

// ── Normalized shapes returned to callers ──────────────────────────────────

export interface NormalizedRow {
  commodity: string;
  variety?: string;
  weightedAvg: number | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  reportDate: string; // YYYY-MM-DD if possible, else raw
  unit?: string;
  region?: string;
  raw: RawReportRow;
}

function coalesceString(...vs: (string | undefined)[]): string | undefined {
  for (const v of vs) if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function coalesceNumber(...vs: (number | null | undefined)[]): number | null {
  for (const v of vs) if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function normalizeDate(raw: string | undefined): string {
  if (!raw) return "";
  // Accept ISO, MM/DD/YYYY, or anything Date can parse.
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  if (direct) return direct[0];
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return raw;
}

function normalizeRow(row: RawReportRow): NormalizedRow {
  const commodity = coalesceString(row.commodity, row.Commodity) ?? "";
  const variety = coalesceString(row.variety, row.Variety);
  const priceRangeLow = coalesceNumber(
    row.price_range_low ?? null,
    row.priceRangeLow ?? null,
    row.lowPrice ?? null,
    row.low_price ?? null,
    row.mostly_low_price ?? null,
  );
  const priceRangeHigh = coalesceNumber(
    row.price_range_high ?? null,
    row.priceRangeHigh ?? null,
    row.highPrice ?? null,
    row.high_price ?? null,
    row.mostly_high_price ?? null,
  );
  // Fall back to midpoint of high+low when weighted_avg_price isn't present
  // (terminal-market reports give a range but no weighted avg).
  const midpoint =
    priceRangeLow !== null && priceRangeHigh !== null ? (priceRangeLow + priceRangeHigh) / 2 : null;
  const weightedAvg = coalesceNumber(
    row.weighted_avg_price ?? null,
    row.weightedAvgPrice ?? null,
    row.wgtdAvgPrice ?? null,
    row.wtd_avg_price ?? null,
    midpoint,
  );
  const reportDate = normalizeDate(
    coalesceString(row.report_date, row.reportDate, row.report_begin_date),
  );
  const unit = coalesceString(row.unit, row.Unit);
  const region = coalesceString(row.region, row.Region);
  return { commodity, variety, weightedAvg, priceRangeLow, priceRangeHigh, reportDate, unit, region, raw: row };
}

function unwrapEnvelope<T>(parsed: T[] | { results: T[] }): T[] {
  return Array.isArray(parsed) ? parsed : parsed.results;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function getJson(url: string, apiKey: string): Promise<unknown> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        method: "GET",
        timeoutMs: 10_000,
        label: "usda.mars",
        headers: {
          Authorization: basicAuthHeader(apiKey),
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new HttpError("usda.mars", res.status, await safeBody(res));
      }
      return res.json();
    },
    { attempts: 2, baseMs: 300, label: "usda.mars" },
  );
}

async function safeBody(res: Response): Promise<string | undefined> {
  try {
    return (await res.clone().text()).slice(0, 200);
  } catch {
    return undefined;
  }
}

// ── Public client ──────────────────────────────────────────────────────────

export class UsdaMarsClient {
  private commoditiesCache: string[] | null = null;

  constructor(private readonly apiKey: string) {}

  /** GET /commodities — cached per client instance (per action invocation). */
  async listCommodities(): Promise<string[]> {
    if (this.commoditiesCache) return this.commoditiesCache;
    const json = await getJson(`${MARS_BASE}/commodities`, this.apiKey);
    const parsed = CommoditiesEnvelopeSchema.parse(json);
    const rows = unwrapEnvelope(parsed);
    const names = rows
      .map((r) => coalesceString(r.commodity_name, r.commodityName, r.name))
      .filter((n): n is string => typeof n === "string");
    this.commoditiesCache = names;
    return names;
  }

  /**
   * Fetch the last `lastReports` snapshots of a report. The literal space in
   * "report details" MUST be %20 (case-sensitive query param too).
   */
  async fetchReport(slug: ReportSlug, lastReports = 2): Promise<NormalizedRow[]> {
    const url = `${MARS_BASE}/reports/${slug}/report%20details?lastReports=${lastReports}`;
    const json = await getJson(url, this.apiKey);
    const parsed = ReportEnvelopeSchema.parse(json);
    return unwrapEnvelope(parsed).map(normalizeRow);
  }
}

/** Group normalized rows by reportDate, newest first. */
export function groupRowsByDateDesc(rows: NormalizedRow[]): Map<string, NormalizedRow[]> {
  const byDate = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    if (!r.reportDate) continue;
    const list = byDate.get(r.reportDate);
    if (list) list.push(r);
    else byDate.set(r.reportDate, [r]);
  }
  return new Map([...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)));
}
