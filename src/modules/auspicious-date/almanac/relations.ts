import { mod } from '../calendar/can-chi.js';
export type BranchRelation = 'TRINE' | 'SIX_HARMONY' | 'CLASH' | 'PUNISHMENT' | 'HARM' | 'BREAK';
const groups = [[0, 4, 8], [1, 5, 9], [2, 6, 10], [3, 7, 11]];
const harmony = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
const harm = [[0, 7], [1, 6], [2, 5], [3, 4], [8, 11], [9, 10]];
const breaks = [[0, 9], [1, 4], [2, 11], [3, 6], [5, 8], [7, 10]];
const punishments = [[0, 3], [1, 7], [1, 10], [7, 10], [2, 5], [2, 8], [5, 8]];
const pair = (pairs: number[][], a: number, b: number) => pairs.some(group => group.includes(a) && group.includes(b) && a !== b);
export function branchRelations(a: number, b: number): BranchRelation[] {
  if (![a, b].every(value => Number.isInteger(value) && value >= 0 && value < 12)) throw new RangeError('Địa chi không hợp lệ.');
  const results: BranchRelation[] = [];
  if (a !== b && groups.some(group => group.includes(a) && group.includes(b))) results.push('TRINE');
  if (pair(harmony, a, b)) results.push('SIX_HARMONY');
  if (mod(a - b, 12) === 6) results.push('CLASH');
  if (pair(punishments, a, b) || (a === b && [4, 6, 9, 11].includes(a))) results.push('PUNISHMENT');
  if (pair(harm, a, b)) results.push('HARM');
  if (pair(breaks, a, b)) results.push('BREAK');
  return results;
}
export const ELEMENTS = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'] as const;
export type Element = typeof ELEMENTS[number];
export function elementRelation(from: Element, to: Element): 'SAME' | 'GENERATES' | 'GENERATED_BY' | 'CONTROLS' | 'CONTROLLED_BY' {
  const a = ELEMENTS.indexOf(from), b = ELEMENTS.indexOf(to);
  if (a === b) return 'SAME';
  if (mod(b - a, 5) === 1) return 'GENERATES';
  if (mod(a - b, 5) === 1) return 'GENERATED_BY';
  if (mod(b - a, 5) === 2) return 'CONTROLS';
  return 'CONTROLLED_BY';
}
