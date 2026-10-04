import type { LunarDate } from './lunar-calendar.js';
export const STEMS = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'] as const;
export const BRANCHES = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'] as const;
export const mod = (number: number, size: number) => (number % size + size) % size;
export interface CanChi { stem: number; branch: number; label: string; cycle: number }
export function canChi(stem: number, branch: number): CanChi {
  const cycle = Array.from({ length: 60 }, (_, i) => i).find(i => i % 10 === stem && i % 12 === branch);
  if (cycle === undefined) throw new RangeError('Cặp Can Chi không hợp lệ.');
  return { stem, branch, label: `${STEMS[stem]} ${BRANCHES[branch]}`, cycle };
}
export function yearCanChi(year: number): CanChi { return canChi(mod(year + 6, 10), mod(year + 8, 12)); }
export function monthCanChi(lunar: LunarDate): CanChi { return canChi(mod(lunar.year * 12 + lunar.month + 3, 10), mod(lunar.month + 1, 12)); }
export function dayCanChi(jd: number): CanChi { return canChi(mod(jd + 9, 10), mod(jd + 1, 12)); }
export function hourCanChi(dayStem: number, branch: number): CanChi { return canChi(mod(dayStem * 2 + branch, 10), branch); }
