import type { Classification, RuleResult } from '../domain.js';
export function scoreAndClassify(trace: RuleResult[]) {
  const matches = trace.filter(rule => rule.matched);
  const criticalViolations = matches.filter(rule => rule.priority === 'CRITICAL' && rule.effect === 'NEGATIVE').length;
  const score = Math.max(0, Math.min(100, 50 + matches.reduce((sum, rule) => sum + rule.scoreDelta, 0)));
  const highNegative = matches.some(rule => rule.effect === 'NEGATIVE' && ['CRITICAL', 'HIGH'].includes(rule.priority));
  const positives = matches.filter(rule => rule.effect === 'POSITIVE').length;
  let classification: Classification = 'NORMAL';
  if (matches.some(rule => rule.hardExclusion)) classification = 'AVOID';
  else if (highNegative || score < 40) classification = 'NOT_RECOMMENDED';
  else if (score >= 80 && positives >= 2) classification = 'VERY_GOOD';
  else if (score >= 65 && positives > 0) classification = 'GOOD';
  return { score, criticalViolations, classification };
}
export function rank<T extends { date: string; classification: Classification; score: number; criticalViolations: number }>(days: T[]): T[] {
  const order: Record<Classification, number> = { VERY_GOOD: 0, GOOD: 1, NORMAL: 2, NOT_RECOMMENDED: 3, AVOID: 4 };
  return [...days].sort((a, b) => order[a.classification] - order[b.classification] || a.criticalViolations - b.criticalViolations || b.score - a.score || a.date.localeCompare(b.date));
}
