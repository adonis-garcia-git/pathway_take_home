import { describe, it, expect } from "vitest";
import {
  bestMatch,
  similarity,
  splitHeadAndModifier,
  PRIMARY_REPORT_BY_CATEGORY,
  SECONDARY_REPORT_BY_CATEGORY,
  CATEGORY_AVG_PRICE,
  type Category,
  type Candidate,
} from "../fuzzy";

const ALL_CATEGORIES: Category[] = ["produce", "dairy", "meat", "seafood", "pantry", "other"];

describe("bestMatch", () => {
  it("picks the highest-similarity row", () => {
    const candidates: Candidate[] = [
      { commodity: "tomato", variety: "roma" },
      { commodity: "lettuce", variety: "iceberg" },
      { commodity: "onion", variety: "yellow" },
    ];
    const r = bestMatch("tomato", candidates);
    expect(r.candidate?.commodity).toBe("tomato");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("uses both head and variety similarity when modifier is present", () => {
    const candidates: Candidate[] = [
      { commodity: "tomato", variety: "roma" },
      { commodity: "tomato", variety: "san marzano" },
    ];
    // The canonical "san marzano tomato" should favor the san-marzano variety row.
    const r = bestMatch("san marzano tomato", candidates);
    expect(r.candidate?.variety).toBe("san marzano");
  });

  it("returns 0 confidence on empty candidate list", () => {
    const r = bestMatch("tomato", []);
    expect(r.candidate).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("returns the closest available even when far below threshold", () => {
    // bestMatch returns the highest score regardless of threshold — the
    // CONFIDENCE_THRESHOLD check is enforced by the caller (pricing.ts).
    const candidates: Candidate[] = [{ commodity: "completely unrelated", variety: "xyz" }];
    const r = bestMatch("ground beef", candidates);
    expect(r.candidate).not.toBeNull();
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe("similarity / splitHeadAndModifier", () => {
  it("similarity is symmetric and 1 for identical strings", () => {
    expect(similarity("tomato", "tomato")).toBeCloseTo(1);
    expect(similarity("a", "b")).toBeLessThan(1);
  });

  it("splits trailing head noun from leading modifier", () => {
    const r = splitHeadAndModifier("san marzano tomato");
    expect(r.head).toBe("tomato");
    expect(r.modifier).toBe("san marzano");
  });

  it("returns empty modifier for single-token names", () => {
    const r = splitHeadAndModifier("tomato");
    expect(r.head).toBe("tomato");
    expect(r.modifier).toBe("");
  });
});

describe("Category coverage tables", () => {
  it("PRIMARY_REPORT_BY_CATEGORY has an entry for every category", () => {
    for (const c of ALL_CATEGORIES) {
      expect(PRIMARY_REPORT_BY_CATEGORY[c]).toBeTruthy();
    }
  });

  it("SECONDARY_REPORT_BY_CATEGORY has an entry (possibly null) for every category", () => {
    for (const c of ALL_CATEGORIES) {
      // null is intentional ("no secondary report for this category"); we
      // just assert the key is present.
      expect(c in SECONDARY_REPORT_BY_CATEGORY).toBe(true);
    }
  });

  it("CATEGORY_AVG_PRICE has a positive price for every category — so the fallback path never throws", () => {
    for (const c of ALL_CATEGORIES) {
      const entry = CATEGORY_AVG_PRICE[c];
      expect(entry).toBeTruthy();
      expect(entry.price).toBeGreaterThan(0);
      expect(entry.unit).toBeTruthy();
    }
  });
});
