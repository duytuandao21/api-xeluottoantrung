export const TIMEZONE = 'Asia/Ho_Chi_Minh';
export const OFFSET_HOURS = 7;
export const DAY_MS = 86_400_000;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2099;
export function currentDate(now = new Date()): string { return new Date(now.getTime() + OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10); }
export function localMidnight(date: string): Date { return new Date(`${date}T00:00:00+07:00`); }
export function civilDay(instant: Date): number { return Math.floor((instant.getTime() + OFFSET_HOURS * 3_600_000) / DAY_MS) + 2440588; }
