import type { CalendarData } from '../calendar/calendar.js';
import { BRANCHES, hourCanChi, mod } from '../calendar/can-chi.js';
import { solarLongitude } from '../calendar/astronomy.js';
import { localMidnight } from '../calendar/timezone.js';
import { napAm } from './nap-am.js';

export const OFFICERS = ['Kiến', 'Trừ', 'Mãn', 'Bình', 'Định', 'Chấp', 'Phá', 'Nguy', 'Thành', 'Thu', 'Khai', 'Bế'] as const;
const HOUR_MASKS = ['110100101100', '001101001011', '110011010010', '101100110100', '001011001101', '010010110011'];
// Twelve officers use the solar-term month of the civil day, including the day
// on which the new month term occurs (not the lunar month or just midnight).
// Independent reference: 2026-10-07 and 2026-10-08 both have officer Chấp.
// Leap lunar months repeat the lunar-month day-quality table.
export function almanac(data: CalendarData) {
  const dayBranch = data.canChi.day.branch;
  const civilDayEnd = new Date(localMidnight(data.solarDate).getTime() + 86_400_000 - 1);
  const solarMonthBranch = mod(Math.floor(mod(solarLongitude(civilDayEnd) + 45, 360) / 30) + 2, 12);
  const officer = mod(dayBranch - solarMonthBranch, 12);
  const auspiciousBranches = [0, 1, 4, 5, 7, 10].map(branch => mod(branch + (data.lunar.month - 1) * 2, 12));
  const tabooCodes: string[] = [];
  if ([3, 7, 13, 18, 22, 27].includes(data.lunar.day)) tabooCodes.push('TAM_NUONG');
  if ([5, 14, 23].includes(data.lunar.day)) tabooCodes.push('NGUYET_KY');
  const goodHours = [...HOUR_MASKS[dayBranch % 6]].flatMap((allowed, branch) => allowed === '1' ? [{
    branch: BRANCHES[branch], canChi: hourCanChi(data.canChi.day.stem, branch).label,
    start: `${String(mod(branch * 2 - 1, 24)).padStart(2, '0')}:00`,
    end: `${String(branch * 2 + 1).padStart(2, '0')}:00`, crossesMidnight: branch === 0,
  }] : []);
  return { auspicious: auspiciousBranches.includes(dayBranch), officer: { index: officer, label: OFFICERS[officer] },
    napAm: napAm(data.canChi.day.cycle), tabooCodes, goodHours,
    // TODO(BUSINESS-RULE): 28 Tú/cát thần/hung thần require an approved specification and sources.
    stars: null, positiveSpirits: null, negativeSpirits: null };
}
export type AlmanacData = ReturnType<typeof almanac>;
