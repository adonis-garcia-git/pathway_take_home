// lib/data.ts — types + demo data (Trattoria Lucia)
// Mirror these types onto your Convex schema; the demo object is seed/fixture data.

export type StageKey = "parse_menu" | "fetch_pricing" | "find_distributors" | "send_rfps" | "collect_quotes";
export type StageStatus = "pending" | "running" | "done" | "error";
export type EmailStatus = "queued" | "sent" | "replied" | "followed_up" | "failed";
export type Provenance = "usda" | "estimated" | "no_data" | "mock"; // 'mock' = backend-only, see STATE_VOCABULARY
export type Confidence = "high" | "medium" | "low";
export type Category = "produce" | "dairy" | "meat" | "seafood" | "drygoods";

export interface Dish {
  name: string; section: string; confidence: Confidence; ingredients: string[]; note?: string;
}
export interface Ingredient {
  id: string; name: string; cat: Category; qty: number; unit: string; confidence: Confidence; forDishes: number; flag?: string;
}
export interface PriceRow {
  id: string; price: number | null; unit: string; trend: number | null; prov: Provenance; src: string;
}
export interface Distributor {
  id: string; name: string; cats: Category[]; dist: string; contact: string; phone: string;
  prov: "verified" | "estimated"; src: string; blurb: string; lat: number; lng: number;
}
export interface EmailThread {
  id: string; status: EmailStatus; sentAt: string; repliedAt: string | null; attempts: number; note?: string;
}
export interface Quote {
  id: string; total: number | null; itemsQuoted: number; itemsTotal: number;
  delivery: string | null; terms: string | null; lead: string | null; complete: number; note: string;
}
export interface Recommendation {
  confidence: Confidence; needsApproval: boolean; primary: string; headline: string; rationale: string;
  splits: { id: string; role: string; value: number }[];
  gaps: { item: string; reason: string }[];
  estSavings: number; estBaseline: number;
}

export const RESTAURANT = {
  name: "Trattoria Lucia",
  address: "214 Court St, Carroll Gardens, Brooklyn, NY 11231",
  cuisine: "Northern Italian",
};

export const DISHES: Dish[] = [
  { name: "Tagliatelle al Ragù", section: "Primi", confidence: "high",
    ingredients: ["Ground beef (80/20)", "Ground pork", "San Marzano tomatoes (DOP)", "Soffritto (carrot·celery·onion)", "Parmigiano-Reggiano", "Fresh tagliatelle", "Red wine"] },
  { name: "Cacio e Pepe", section: "Primi", confidence: "high",
    ingredients: ["Spaghetti", "Pecorino Romano", "Black peppercorn"] },
  { name: "Osso Buco alla Milanese", section: "Secondi", confidence: "medium",
    ingredients: ["Veal shanks", "Soffritto (carrot·celery·onion)", "White wine", "Parmigiano-Reggiano"], note: "Cut not specified — assumed cross-cut hind shank." },
  { name: "Insalata Caprese", section: "Antipasti", confidence: "high",
    ingredients: ["Mozzarella di bufala", "Heirloom tomatoes", "Fresh basil", "Extra-virgin olive oil"] },
  { name: "Bruschetta al Pomodoro", section: "Antipasti", confidence: "high",
    ingredients: ["Rustic bread", "Heirloom tomatoes", "Garlic", "Fresh basil", "Extra-virgin olive oil"] },
  { name: "Tiramisù della Casa", section: "Dolci", confidence: "low",
    ingredients: ["Mascarpone", "Eggs", "Savoiardi (ladyfingers)", "Espresso", "Cocoa"], note: "House recipe — quantities estimated from a 2-line menu description." },
];

export const INGREDIENTS: Ingredient[] = [
  { id: "san-marzano", name: "San Marzano tomatoes (DOP)", cat: "produce", qty: 40, unit: "lb", confidence: "high", forDishes: 2 },
  { id: "ground-beef", name: "Ground beef (80/20)", cat: "meat", qty: 25, unit: "lb", confidence: "high", forDishes: 1 },
  { id: "ground-pork", name: "Ground pork", cat: "meat", qty: 15, unit: "lb", confidence: "high", forDishes: 1 },
  { id: "veal-shank", name: "Veal shanks (cross-cut)", cat: "meat", qty: 18, unit: "lb", confidence: "medium", forDishes: 1, flag: "Cut assumed" },
  { id: "parm", name: "Parmigiano-Reggiano", cat: "dairy", qty: 8, unit: "lb", confidence: "high", forDishes: 2 },
  { id: "pecorino", name: "Pecorino Romano", cat: "dairy", qty: 6, unit: "lb", confidence: "high", forDishes: 1 },
  { id: "bufala", name: "Mozzarella di bufala", cat: "dairy", qty: 12, unit: "lb", confidence: "medium", forDishes: 1, flag: "Import grade unclear" },
  { id: "mascarpone", name: "Mascarpone", cat: "dairy", qty: 10, unit: "lb", confidence: "low", forDishes: 1, flag: "Qty estimated" },
  { id: "tagliatelle", name: "Fresh tagliatelle", cat: "drygoods", qty: 20, unit: "lb", confidence: "high", forDishes: 1 },
  { id: "spaghetti", name: "Spaghetti (bronze-cut)", cat: "drygoods", qty: 15, unit: "lb", confidence: "high", forDishes: 1 },
  { id: "evoo", name: "Extra-virgin olive oil", cat: "drygoods", qty: 6, unit: "gal", confidence: "high", forDishes: 3 },
  { id: "tomatoes", name: "Heirloom tomatoes", cat: "produce", qty: 22, unit: "lb", confidence: "high", forDishes: 2 },
  { id: "basil", name: "Fresh basil", cat: "produce", qty: 3, unit: "lb", confidence: "low", forDishes: 2, flag: "Qty estimated" },
  { id: "soffritto", name: "Soffritto mix (carrot·celery·onion)", cat: "produce", qty: 30, unit: "lb", confidence: "medium", forDishes: 2 },
  { id: "eggs", name: "Eggs", cat: "dairy", qty: 12, unit: "doz", confidence: "high", forDishes: 1 },
  { id: "espresso", name: "Espresso beans", cat: "drygoods", qty: 5, unit: "lb", confidence: "medium", forDishes: 1 },
];

export const PRICING = {
  asOf: "May 28, 2026",
  rows: [
    { id: "ground-beef", price: 4.62, unit: "lb", trend: -3.1, prov: "usda", src: "USDA AMS · LM_XB403" },
    { id: "ground-pork", price: 3.18, unit: "lb", trend: 1.4, prov: "usda", src: "USDA AMS · LM_PK602" },
    { id: "veal-shank", price: 9.85, unit: "lb", trend: 2.2, prov: "estimated", src: "Modeled from regional veal index" },
    { id: "san-marzano", price: 3.40, unit: "lb", trend: 6.8, prov: "estimated", src: "Importer list avg (DOP tier)" },
    { id: "tomatoes", price: 2.10, unit: "lb", trend: -8.5, prov: "usda", src: "USDA AMS · Terminal Market NY" },
    { id: "basil", price: 12.00, unit: "lb", trend: 0.0, prov: "estimated", src: "Herb category proxy" },
    { id: "soffritto", price: 1.35, unit: "lb", trend: -1.2, prov: "usda", src: "USDA AMS · mixed veg" },
    { id: "parm", price: 16.40, unit: "lb", trend: 4.0, prov: "estimated", src: "Specialty cheese index" },
    { id: "pecorino", price: 18.90, unit: "lb", trend: 5.5, prov: "estimated", src: "Specialty cheese index" },
    { id: "bufala", price: null, unit: "lb", trend: null, prov: "no_data", src: "No public series — import-grade" },
    { id: "mascarpone", price: 7.20, unit: "lb", trend: 0.6, prov: "estimated", src: "Soft cheese proxy" },
    { id: "eggs", price: 3.95, unit: "doz", trend: -12.0, prov: "usda", src: "USDA AMS · Egg Markets" },
    { id: "tagliatelle", price: null, unit: "lb", trend: null, prov: "no_data", src: "Fresh pasta — no commodity series" },
    { id: "spaghetti", price: 1.85, unit: "lb", trend: 0.9, prov: "estimated", src: "Dry pasta retail proxy" },
    { id: "evoo", price: 38.50, unit: "gal", trend: 14.2, prov: "estimated", src: "Importer list avg" },
    { id: "espresso", price: 11.50, unit: "lb", trend: 3.3, prov: "estimated", src: "Green coffee + roast markup" },
  ] as PriceRow[],
};

export const DISTRIBUTORS: Distributor[] = [
  { id: "lombardi", name: "Lombardi Specialty Foods", cats: ["dairy", "drygoods", "produce"], dist: "1.2 mi", contact: "orders@lombardifoods.example", phone: "(718) 555-0142", prov: "verified", src: "Verified · NY DOH permit #BK-22841", blurb: "Full-line Italian importer & distributor. Carroll Gardens since 1971.", lat: 38, lng: 41 },
  { id: "gotham", name: "Gotham Produce Co.", cats: ["produce"], dist: "2.4 mi", contact: "sales@gothamproduce.example", phone: "(718) 555-0199", prov: "verified", src: "Verified · Hunts Point vendor", blurb: "Daily terminal-market produce, restaurant delivery 6×/week.", lat: 62, lng: 70 },
  { id: "hudson", name: "Hudson Meat Purveyors", cats: ["meat"], dist: "3.1 mi", contact: "wholesale@hudsonmeat.example", phone: "(212) 555-0177", prov: "verified", src: "Verified · USDA estab. #8841", blurb: "Whole-animal butcher, custom cuts, veal & game.", lat: 26, lng: 64 },
  { id: "costiera", name: "Costiera Imports", cats: ["drygoods", "produce"], dist: "5.8 mi", contact: "info@costieraimports.example", phone: "(718) 555-0123", prov: "estimated", src: "Estimated · listing only, unverified", blurb: "DOP specialty imports — San Marzano, EVOO, '00 flour.", lat: 74, lng: 22 },
];

export const EMAILS = {
  deadline: "Fri May 30, 2026 · 5:00 PM ET",
  threads: [
    { id: "lombardi", status: "replied", sentAt: "9:02 AM", repliedAt: "11:48 AM", attempts: 1 },
    { id: "gotham", status: "replied", sentAt: "9:02 AM", repliedAt: "1:20 PM", attempts: 1 },
    { id: "hudson", status: "followed_up", sentAt: "9:02 AM", repliedAt: null, attempts: 2, note: "No reply in 3h — auto follow-up sent 12:05 PM." },
    { id: "costiera", status: "failed", sentAt: "9:02 AM", repliedAt: null, attempts: 1, note: "Hard bounce — mailbox unavailable. Trying listed phone." },
  ] as EmailThread[],
};

// Which items each distributor was asked to quote (for the email preview).
export const RFP_ITEMS: Record<string, { rfp: string; subject: string; items: string[] }> = {
  lombardi: { rfp: "LMB", subject: "RFQ · Weekly dairy, dry goods & produce — Trattoria Lucia",
    items: ["san-marzano", "parm", "pecorino", "bufala", "mascarpone", "tagliatelle", "spaghetti", "evoo", "tomatoes", "soffritto", "eggs"] },
  gotham: { rfp: "GTH", subject: "RFQ · Weekly produce — Trattoria Lucia",
    items: ["tomatoes", "soffritto", "basil", "san-marzano"] },
  hudson: { rfp: "HDS", subject: "RFQ · Weekly meat incl. veal shank — Trattoria Lucia",
    items: ["ground-beef", "ground-pork", "veal-shank"] },
  costiera: { rfp: "CST", subject: "RFQ · DOP specialty imports — Trattoria Lucia",
    items: ["san-marzano", "evoo", "spaghetti", "espresso"] },
};

export const QUOTES: Quote[] = [
  { id: "lombardi", total: 2140, itemsQuoted: 13, itemsTotal: 16, delivery: "Mon · Thu", terms: "Net-30", lead: "2 days", complete: 81, note: "No veal, no fresh tagliatelle, no espresso." },
  { id: "gotham", total: 612, itemsQuoted: 4, itemsTotal: 16, delivery: "Daily (6×/wk)", terms: "Net-15", lead: "1 day", complete: 25, note: "Produce only — strong on tomatoes & soffritto." },
  { id: "hudson", total: 884, itemsQuoted: 3, itemsTotal: 16, delivery: "Tue · Fri", terms: "COD", lead: "2 days", complete: 19, note: "Meat only. Veal at $9.40/lb — under estimate." },
  { id: "costiera", total: null, itemsQuoted: 0, itemsTotal: 16, delivery: null, terms: null, lead: null, complete: 0, note: "No quote — email bounced." },
];

export const RECOMMENDATION: Recommendation = {
  confidence: "medium",
  needsApproval: true,
  primary: "lombardi",
  headline: "Award the core basket to Lombardi Specialty Foods",
  rationale: "Lombardi covers 13 of 16 lines at the lowest blended price and Net-30 terms. Pair with Hudson for veal (quoted under our estimate) to cover meat. Together they fill 16 of 16 lines.",
  splits: [
    { id: "lombardi", role: "Core — dairy, dry goods, produce", value: 2140 },
    { id: "hudson", role: "Meat — veal under estimate", value: 884 },
  ],
  gaps: [
    { item: "San Marzano tomatoes (DOP)", reason: "Only Costiera carries DOP grade — email bounced." },
    { item: "Extra-virgin olive oil", reason: "Costiera unreached; Lombardi grade unconfirmed." },
  ],
  estSavings: 312,
  estBaseline: 3336,
};

// The 5 pipeline stages with demo timing (seconds) for the animated replay.
export const STAGES: { key: StageKey; n: number; title: string; start: number; end: number; run: string; done: string }[] = [
  { key: "parse_menu", n: 1, title: "Parse Menu", start: 0.3, end: 4.6, run: "Reading the menu and extracting dishes", done: "6 dishes · 16 ingredient lines" },
  { key: "fetch_pricing", n: 2, title: "Fetch Pricing", start: 5.1, end: 11.0, run: "Querying USDA market data + indices", done: "14 priced · 2 no public data" },
  { key: "find_distributors", n: 3, title: "Find Distributors", start: 11.6, end: 16.2, run: "Searching verified suppliers nearby", done: "4 distributors within 6 mi" },
  { key: "send_rfps", n: 4, title: "Send RFPs", start: 16.8, end: 23.0, run: "Emailing distributors for quotes", done: "4 sent · 2 replied · 1 bounced" },
  { key: "collect_quotes", n: 5, title: "Collect Quotes", start: 23.6, end: 30.0, run: "Normalizing and comparing quotes", done: "3 quotes · recommendation ready" },
];
export const PIPELINE_TOTAL = 30.0;

// lookups
export const ingredientById = (id: string) => INGREDIENTS.find((i) => i.id === id);
export const distributorById = (id: string) => DISTRIBUTORS.find((d) => d.id === id);
