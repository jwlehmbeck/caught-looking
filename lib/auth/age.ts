/**
 * Age math for the neutral age screen. Pure, so it can be unit-tested and
 * imported by both the server action and the page.
 *
 * The screen asks for birth month and year only (never the day), so age is
 * counted in whole months: someone born in October 2013 turns 13 on
 * 1 October 2026 as far as this app is concerned. Nothing from this module
 * is stored except, for people who pass, the birth year.
 */

export const MIN_AGE = 13;
export const MIN_BIRTH_YEAR = 1900;

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface BirthMonth {
  /** 1–12 */
  month: number;
  year: number;
}

/** Whole years lived as of `now`, counting the birth month as reached. */
export function ageInYears(birth: BirthMonth, now: Date = new Date()): number {
  const years = now.getFullYear() - birth.year;
  const monthNotReached = now.getMonth() + 1 < birth.month;
  return monthNotReached ? years - 1 : years;
}

export function isOldEnough(birth: BirthMonth, now: Date = new Date()): boolean {
  return ageInYears(birth, now) >= MIN_AGE;
}

/** Parses the two select values; null when they are not a real month/year. */
export function parseBirthMonth(
  monthRaw: unknown,
  yearRaw: unknown,
  now: Date = new Date(),
): BirthMonth | null {
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < MIN_BIRTH_YEAR || year > now.getFullYear()) return null;
  return { month, year };
}

/** Every selectable year, newest first, with no hint of a cutoff. */
export function birthYearOptions(now: Date = new Date()): number[] {
  const years: number[] = [];
  for (let y = now.getFullYear(); y >= MIN_BIRTH_YEAR; y -= 1) years.push(y);
  return years;
}
