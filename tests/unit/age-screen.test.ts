import { describe, expect, it } from "vitest";

import { ageInYears, birthYearOptions, isOldEnough, parseBirthMonth } from "@/lib/auth/age";

// A fixed "today": 25 October 2026.
const NOW = new Date(2026, 9, 25);

describe("age screen math", () => {
  it("counts whole years when the birth month has passed", () => {
    expect(ageInYears({ month: 3, year: 2011 }, NOW)).toBe(15);
  });

  it("subtracts a year when the birthday month has not arrived yet", () => {
    expect(ageInYears({ month: 12, year: 2013 }, NOW)).toBe(12);
    expect(isOldEnough({ month: 12, year: 2013 }, NOW)).toBe(false);
  });

  it("treats the birth month itself as reached", () => {
    expect(ageInYears({ month: 10, year: 2013 }, NOW)).toBe(13);
    expect(isOldEnough({ month: 10, year: 2013 }, NOW)).toBe(true);
  });

  it("passes exactly 13", () => {
    expect(isOldEnough({ month: 9, year: 2013 }, NOW)).toBe(true);
  });

  it("blocks 12 and under", () => {
    expect(isOldEnough({ month: 1, year: 2014 }, NOW)).toBe(false);
    expect(isOldEnough({ month: 10, year: 2020 }, NOW)).toBe(false);
  });

  it("passes adults", () => {
    expect(isOldEnough({ month: 6, year: 1980 }, NOW)).toBe(true);
  });
});

describe("parseBirthMonth", () => {
  it("accepts real months and years", () => {
    expect(parseBirthMonth("4", "2010", NOW)).toEqual({ month: 4, year: 2010 });
  });

  it("rejects out-of-range or missing values", () => {
    expect(parseBirthMonth("0", "2010", NOW)).toBeNull();
    expect(parseBirthMonth("13", "2010", NOW)).toBeNull();
    expect(parseBirthMonth("5", "1899", NOW)).toBeNull();
    expect(parseBirthMonth("5", "2027", NOW)).toBeNull();
    expect(parseBirthMonth("", "", NOW)).toBeNull();
    expect(parseBirthMonth(null, undefined, NOW)).toBeNull();
    expect(parseBirthMonth("5.5", "2010", NOW)).toBeNull();
  });
});

describe("birthYearOptions", () => {
  it("runs from this year back to 1900 with no cutoff gap", () => {
    const years = birthYearOptions(NOW);
    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(1900);
    expect(years).toHaveLength(127);
    // The years around the cutoff are all present, so nothing hints at it.
    expect(years).toContain(2013);
    expect(years).toContain(2014);
  });
});
