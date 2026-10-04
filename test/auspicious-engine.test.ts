import assert from 'node:assert/strict';
import { test } from 'node:test';
import { almanac } from '../src/modules/auspicious-date/almanac/almanac.js';
import { branchRelations, elementRelation } from '../src/modules/auspicious-date/almanac/relations.js';
import { napAm } from '../src/modules/auspicious-date/almanac/nap-am.js';
import { calendar } from '../src/modules/auspicious-date/calendar/calendar.js';
import { birthProfile, compatibility } from '../src/modules/auspicious-date/compatibility/compatibility.js';
import { INITIAL_RULES } from '../src/modules/auspicious-date/defaults.js';
import type { RuleResult } from '../src/modules/auspicious-date/domain.js';
import { registry } from '../src/modules/auspicious-date/engine/registry.js';
import { evaluate } from '../src/modules/auspicious-date/engine/rule-engine.js';
import { rank, scoreAndClassify } from '../src/modules/auspicious-date/engine/scoring.js';

test('almanac relationships, five elements, nap-am, hours and taboos', () => {
  assert.deepEqual(branchRelations(0, 6), ['CLASH']);
  assert.ok(branchRelations(0, 4).includes('TRINE'));
  assert.ok(branchRelations(0, 1).includes('SIX_HARMONY'));
  assert.ok(branchRelations(0, 3).includes('PUNISHMENT'));
  assert.ok(branchRelations(0, 7).includes('HARM'));
  assert.ok(branchRelations(0, 9).includes('BREAK'));
  assert.equal(elementRelation('WOOD', 'FIRE'), 'GENERATES');
  assert.equal(elementRelation('METAL', 'WOOD'), 'CONTROLS');
  assert.deepEqual(napAm(0), { label: 'Hải trung kim', element: 'METAL' });
  assert.equal(napAm(59).label, 'Đại hải thủy');
  const day = almanac(calendar('2026-02-19'));
  assert.ok(day.tabooCodes.includes('TAM_NUONG'));
  assert.equal(day.goodHours.length, 6);
  assert.ok(day.officer.index >= 0 && day.officer.index < 12);
  assert.equal(day.stars, null);
});
test('registry match/non-match for every handler and disabled rule', () => {
  const profile = birthProfile('1998-08-15');
  const contexts = Array.from({ length: 60 }, (_, day) => {
    const date = new Date(Date.UTC(2026, 1, 1 + day)).toISOString().slice(0, 10);
    const data = calendar(date);
    return { calendar: data, almanac: almanac(data), compatibility: compatibility(profile, data), purpose: 'BUY_CAR' as const };
  });
  for (const [key, handler] of Object.entries(registry)) {
    const matches = contexts.map(context => handler(context, { officers: [8] }).matched);
    assert.ok(matches.includes(true), `${key} match`);
    if (key !== 'GOOD_HOURS') assert.ok(matches.includes(false), `${key} non-match`);
  }
  const rules = INITIAL_RULES.map((rule, index) => ({ ...rule, id: String(index), isEnabled: false }));
  const result = evaluate('2026-02-19', profile, 'BUY_CAR', rules, []);
  assert.equal(result.classification, 'NORMAL');
  assert.ok(result.trace.every(rule => rule.status === 'NOT_APPLICABLE'));
});
test('hard exclusion wins despite high score; score alone does not define classification; stable ranking', () => {
  const rule = (change: Partial<RuleResult>): RuleResult => ({ code: 'test', matched: true, status: 'MATCH', effect: 'POSITIVE', priority: 'LOW', scoreDelta: 50, hardExclusion: false, metadata: {}, ...change });
  assert.equal(scoreAndClassify([rule({}), rule({}), rule({ effect: 'NEGATIVE', priority: 'CRITICAL', hardExclusion: true, scoreDelta: -1 })]).classification, 'AVOID');
  assert.equal(scoreAndClassify([rule({})]).classification, 'GOOD');
  assert.equal(scoreAndClassify([rule({}), rule({})]).classification, 'VERY_GOOD');
  assert.equal(scoreAndClassify([rule({ effect: 'NEGATIVE', priority: 'HIGH', scoreDelta: 0 })]).classification, 'NOT_RECOMMENDED');
  const a = { date: '2026-10-02', score: 80, classification: 'GOOD' as const, criticalViolations: 0 };
  const b = { ...a, date: '2026-10-01' };
  assert.deepEqual(rank([a, b]), [b, a]);
});
