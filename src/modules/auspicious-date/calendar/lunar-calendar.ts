import { nextNewMoon, solarLongitude, winterSolstice } from './astronomy.js';
import { dateFromJulianDay, julianDay } from './julian-day.js';
import { civilDay, DAY_MS, localMidnight, MAX_YEAR, MIN_YEAR } from './timezone.js';

export interface LunarDate { day: number; month: number; year: number; leap: boolean }
interface LunarMonth { start: number; end: number; month: number; year: number; leap: boolean }
const cache = new Map<number, readonly LunarMonth[]>();

// Vietnamese civil-day rules: month 11 contains winter solstice; a 13-month sui
// repeats the first following month without a major solar term. Timezone is ALWAYS UTC+7.
function sui(year: number): readonly LunarMonth[] {
  const existing = cache.get(year);
  if (existing) return existing;
  const solstice = civilDay(winterSolstice(year));
  const following = civilDay(winterSolstice(year + 1));
  const starts: number[] = [];
  let moon = nextNewMoon(new Date(`${year}-11-01T00:00:00Z`));
  while (civilDay(moon) <= following + 35) {
    starts.push(civilDay(moon));
    moon = nextNewMoon(new Date(moon.getTime() + DAY_MS));
  }
  const first = starts.reduce((found, day, index) => day <= solstice ? index : found, -1);
  const last = starts.reduce((found, day, index) => day <= following ? index : found, -1);
  const count = last - first;
  if (first < 0 || ![12, 13].includes(count)) throw new Error('Lỗi cấu trúc năm âm lịch.');
  let leapIndex = -1;
  if (count === 13) {
    for (let index = 1; index < count; index++) {
      const a = Math.floor(solarLongitude(localMidnight(dateFromJulianDay(starts[first + index]))) / 30);
      const b = Math.floor(solarLongitude(localMidnight(dateFromJulianDay(starts[first + index + 1]))) / 30);
      if (a === b) { leapIndex = index; break; }
    }
    if (leapIndex < 0) throw new Error('Không xác định được tháng nhuận.');
  }
  const months = Array.from({ length: count }, (_, index) => {
    const number = 11 + index - (leapIndex >= 0 && index >= leapIndex ? 1 : 0);
    const month = (number - 1) % 12 + 1;
    return { start: starts[first + index], end: starts[first + index + 1], month, year: month >= 11 ? year : year + 1, leap: index === leapIndex };
  });
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(year, Object.freeze(months));
  return months;
}
export function solarToLunar(date: string): LunarDate {
  const jd = julianDay(date);
  const year = Number(date.slice(0, 4));
  const month = [...sui(year - 1), ...sui(year)].find(item => jd >= item.start && jd < item.end);
  if (!month) throw new Error('Không xác định được tháng âm lịch.');
  return { day: jd - month.start + 1, month: month.month, year: month.year, leap: month.leap };
}
export function lunarToSolar(lunar: LunarDate): string {
  if (!Number.isInteger(lunar.year) || lunar.year < MIN_YEAR - 1 || lunar.year > MAX_YEAR || !Number.isInteger(lunar.day) || !Number.isInteger(lunar.month)) throw new RangeError('Ngày âm lịch không hợp lệ.');
  const month = [...sui(lunar.year - 1), ...sui(lunar.year)].find(item => item.year === lunar.year && item.month === lunar.month && item.leap === lunar.leap);
  if (!month || lunar.day < 1 || lunar.day > month.end - month.start) throw new RangeError('Ngày âm lịch hoặc tháng nhuận không hợp lệ.');
  const date = dateFromJulianDay(month.start + lunar.day - 1);
  julianDay(date);
  return date;
}
