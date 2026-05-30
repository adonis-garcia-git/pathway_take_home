// lib/data.ts — Phase 7: shared types + stage metadata only.
// All fixture/demo data has moved to live Convex queries.

export type StageKey =
  | "parse_menu"
  | "fetch_pricing"
  | "find_distributors"
  | "send_rfps"
  | "collect_quotes";
export type StageStatus = "pending" | "running" | "done" | "error";
export type EmailStatus = "queued" | "sent" | "replied" | "followed_up" | "failed";
export type Provenance = "usda" | "estimated" | "no_data" | "mock";
export type Confidence = "high" | "medium" | "low";
export type Category = "produce" | "dairy" | "meat" | "seafood" | "drygoods";

// Static metadata for the 5 pipeline stages. The `done` text is a fallback
// when a step has no `summary` yet; the actual rendered text comes from
// `run.steps[i].summary` written by the backend.
export const STAGE_META: readonly {
  key: StageKey;
  n: number;
  title: string;
  run: string;
  done: string;
}[] = [
  { key: "parse_menu",       n: 1, title: "Parse Menu",        run: "Reading the menu and extracting dishes", done: "Menu parsed" },
  { key: "fetch_pricing",    n: 2, title: "Fetch Pricing",     run: "Querying USDA market data",              done: "Basket priced" },
  { key: "find_distributors",n: 3, title: "Find Distributors", run: "Searching verified suppliers nearby",    done: "Distributors matched" },
  { key: "send_rfps",        n: 4, title: "Send RFPs",         run: "Emailing distributors for quotes",       done: "RFPs sent" },
  { key: "collect_quotes",   n: 5, title: "Collect Quotes",    run: "Normalizing and comparing quotes",       done: "Recommendation ready" },
] as const;
