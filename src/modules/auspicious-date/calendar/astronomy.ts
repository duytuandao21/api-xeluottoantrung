import { SearchMoonPhase, SearchSunLongitude, SunPosition } from 'astronomy-engine';

// Astronomy Engine 2.1.19 (MIT). This adapter isolates the dependency from calendar/business rules.
export function nextNewMoon(start: Date): Date {
  const result = SearchMoonPhase(0, start, 35);
  if (!result) throw new Error('Không tìm thấy Sóc trong khoảng thiên văn.');
  return result.date;
}
export function winterSolstice(year: number): Date {
  const result = SearchSunLongitude(270, new Date(`${year}-12-01T00:00:00Z`), 30);
  if (!result) throw new Error('Không tìm thấy Đông chí.');
  return result.date;
}
export function solarLongitude(at: Date): number { return SunPosition(at).elon; }
