import { describe, it, expect } from "vitest";
import { normalize, sumCompatible, sumOccurrences, formatQty } from "../units";

describe("normalize", () => {
  it("converts 8 oz to 0.5 lb", () => {
    const n = normalize(8, "oz");
    expect(n.qty).toBeCloseTo(0.5);
    expect(n.unit).toBe("lb");
    expect(n.dimension).toBe("mass");
    expect(n.original).toEqual({ qty: 8, unit: "oz" });
  });

  it("converts 1 doz to 12 each", () => {
    const n = normalize(1, "doz");
    expect(n.qty).toBe(12);
    expect(n.unit).toBe("each");
    expect(n.dimension).toBe("count");
  });

  it("converts 1 kg to ~2.20462 lb", () => {
    const n = normalize(1, "kg");
    expect(n.qty).toBeCloseTo(2.20462, 4);
    expect(n.dimension).toBe("mass");
  });

  it("converts 2 qt to 0.5 gal", () => {
    const n = normalize(2, "qt");
    expect(n.qty).toBeCloseTo(0.5);
    expect(n.dimension).toBe("volume");
  });

  it("passes unknown units through with dimension 'unknown'", () => {
    const n = normalize(3, "bunch");
    expect(n.qty).toBe(3);
    expect(n.unit).toBe("bunch");
    expect(n.dimension).toBe("unknown");
  });

  it("accepts case + pluralization variations", () => {
    expect(normalize(1, "Pounds").unit).toBe("lb");
    expect(normalize(1, "DOZEN").qty).toBe(12);
  });
});

describe("sumCompatible", () => {
  it("sums two masses correctly", () => {
    const a = normalize(0.5, "lb");
    const b = normalize(8, "oz");
    const r = sumCompatible(a, b);
    expect(r).not.toBeNull();
    expect(r!.qty).toBeCloseTo(1.0);
    expect(r!.unit).toBe("lb");
  });

  it("returns null when dimensions differ (mass vs volume)", () => {
    const r = sumCompatible(normalize(1, "lb"), normalize(1, "gal"));
    expect(r).toBeNull();
  });

  it("returns null when either side is unknown", () => {
    expect(sumCompatible(normalize(1, "lb"), normalize(1, "bunch"))).toBeNull();
  });
});

describe("sumOccurrences", () => {
  it("sums same-dimension lb + oz into a single lb total", () => {
    const r = sumOccurrences([
      { qty: 0.5, unit: "lb" },
      { qty: 8, unit: "oz" },
      { qty: 1, unit: "lb" },
    ]);
    expect(r.qty).toBeCloseTo(2.0);
    expect(r.unit).toBe("lb");
    expect(r.dimension).toBe("mass");
    expect(r.mixed).toBe(false);
  });

  it("flags mixed=true when dimensions differ and picks the dominant by quantity", () => {
    const r = sumOccurrences([
      { qty: 0.5, unit: "lb" },   // mass=0.5
      { qty: 2, unit: "gal" },    // volume=2 (dominant)
      { qty: 1, unit: "qt" },     // volume=0.25
    ]);
    expect(r.mixed).toBe(true);
    expect(r.dimension).toBe("volume");
    expect(r.unit).toBe("gal");
    expect(r.qty).toBeCloseTo(2.25);
  });

  it("preserves unknown unit when only one and it's unknown", () => {
    const r = sumOccurrences([
      { qty: 1, unit: "bunch" },
      { qty: 2, unit: "bunch" },
    ]);
    expect(r.qty).toBe(3);
    expect(r.unit).toBe("bunch");
    expect(r.dimension).toBe("unknown");
    expect(r.mixed).toBe(false);
  });

  it("handles empty array safely", () => {
    const r = sumOccurrences([]);
    expect(r.qty).toBe(0);
  });
});

describe("formatQty", () => {
  it("rounds to 2 decimals in the base unit by default", () => {
    expect(formatQty(normalize(1.234, "lb"))).toBe("1.23 lb");
  });

  it("converts back to a requested display unit", () => {
    expect(formatQty(normalize(1, "lb"), "oz")).toBe("16 oz");
  });

  it("falls back to base when display unit's dimension doesn't match", () => {
    expect(formatQty(normalize(1, "lb"), "gal")).toBe("1 lb");
  });
});
