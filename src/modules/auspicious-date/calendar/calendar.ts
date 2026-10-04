import { solarLongitude } from './astronomy.js';
import { dayCanChi, monthCanChi, yearCanChi } from './can-chi.js';
import { julianDay } from './julian-day.js';
import { solarToLunar } from './lunar-calendar.js';
import { localMidnight, TIMEZONE } from './timezone.js';

export const SOLAR_TERMS = ['Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng', 'Hạ chí', 'Tiểu thử', 'Đại thử', 'Lập thu', 'Xử thử', 'Bạch lộ', 'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết', 'Đông chí', 'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập'] as const;
export function calendar(date: string) {
  const jd = julianDay(date), lunar = solarToLunar(date);
  return { solarDate: date, julianDay: jd, timezone: TIMEZONE, weekday: (jd + 1) % 7, lunar,
    canChi: { year: yearCanChi(lunar.year), month: monthCanChi(lunar), day: dayCanChi(jd) },
    solarTerm: SOLAR_TERMS[Math.floor(solarLongitude(localMidnight(date)) / 15)] };
}
export type CalendarData = ReturnType<typeof calendar>;
