import { DAY_MS, MAX_YEAR, MIN_YEAR } from './timezone.js';
export function julianDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Ngày phải theo định dạng YYYY-MM-DD.');
  const parsed = new Date(`${date}T00:00:00Z`);
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || year < MIN_YEAR || year > MAX_YEAR)
    throw new RangeError(`Ngày không hợp lệ hoặc ngoài khoảng ${MIN_YEAR}–${MAX_YEAR}.`);
  return Math.floor(parsed.getTime() / DAY_MS) + 2440588;
}
export function dateFromJulianDay(day: number): string { return new Date((day - 2440588) * DAY_MS).toISOString().slice(0, 10); }
export function addDays(date: string, days: number): string { return dateFromJulianDay(julianDay(date) + days); }
