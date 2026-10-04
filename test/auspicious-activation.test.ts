import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVATION_FIXTURES, activationReferences, activationRules, activationSources } from '../src/modules/auspicious-date/activation-pack.js';
import { PURPOSES } from '../src/modules/auspicious-date/domain.js';
import { birthProfile } from '../src/modules/auspicious-date/compatibility/compatibility.js';
import { evaluate } from '../src/modules/auspicious-date/engine/rule-engine.js';
import { assertExpectation, differences } from '../src/modules/auspicious-date/engine/reference-validation.js';
import { almanac } from '../src/modules/auspicious-date/almanac/almanac.js';
import { calendar } from '../src/modules/auspicious-date/calendar/calendar.js';

test('activation pack: independently published calendar/almanac, manually checked classifications and handler coverage', () => {
  assert.equal(ACTIVATION_FIXTURES.length, 14);
  for (const purpose of PURPOSES) {
    const rules = activationRules(purpose).map(rule => ({ ...rule, id: rule.code }));
    for (const rule of rules.filter(item => item.isEnabled)) assert.ok(activationSources(rule.engineHandler, purpose).length, `source for ${rule.code}`);
    const references = activationReferences(purpose);
    for (const reference of references) {
      assertExpectation(reference.expected);
      const result = evaluate(reference.targetDate, birthProfile(reference.birthDate), purpose, rules, []);
      assert.deepEqual(differences(reference.expected.calendar, result.calendar), [], `${purpose} ${reference.targetDate} calendar`);
      assert.deepEqual(differences(reference.expected.almanac, result.almanac), [], `${purpose} ${reference.targetDate} almanac`);
      assert.equal(result.classification, reference.expected.classification, `${purpose} ${reference.targetDate} classification`);
      for (const expected of reference.expected.rules!) assert.deepEqual(differences(expected, result.trace.find(rule => rule.code === expected.code)), [], `${purpose} ${reference.targetDate} ${expected.code}`);
    }
    for (const rule of rules.filter(item => item.isEnabled && item.code !== 'GOOD_HOURS')) {
      const outcomes = references.map(reference => reference.expected.rules!.find(item => item.code === rule.code)!.matched);
      assert.ok(outcomes.includes(true) && outcomes.includes(false), `${purpose} ${rule.code} match/non-match`);
    }
  }
});
test('solar-month officer changes on the term civil day; six source hour tables have correct two-hour windows', () => {
  assert.equal(almanac(calendar('2026-10-07')).officer.label, 'Chấp');
  assert.equal(almanac(calendar('2026-10-08')).officer.label, 'Chấp');
  assert.equal(almanac(calendar('2026-10-09')).officer.label, 'Phá');
  const windows: Record<string, [string, string]> = { Tý:['23:00','01:00'], Sửu:['01:00','03:00'], Dần:['03:00','05:00'], Mão:['05:00','07:00'], Thìn:['07:00','09:00'], Tỵ:['09:00','11:00'], Ngọ:['11:00','13:00'], Mùi:['13:00','15:00'], Thân:['15:00','17:00'], Dậu:['17:00','19:00'], Tuất:['19:00','21:00'], Hợi:['21:00','23:00'] };
  for (let day = 1; day <= 6; day++) for (const hour of almanac(calendar(`2026-10-0${day}`)).goodHours) {
    assert.deepEqual([hour.start, hour.end], windows[hour.branch]);
    assert.equal(hour.crossesMidnight, hour.branch === 'Tý');
  }
  assert.deepEqual(differences([{ branch: 'Tý' }], [{ branch: 'Tý', start: '23:00' }]), []);
  assert.notDeepEqual(differences([{ branch: 'Tý' }], [{ branch: 'Sửu' }]), []);
  assert.notDeepEqual(differences([], [{ branch: 'Tý' }]), []);
});
