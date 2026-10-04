import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendar } from '../src/modules/auspicious-date/calendar/calendar.js';
import { julianDay, dateFromJulianDay } from '../src/modules/auspicious-date/calendar/julian-day.js';
import { lunarToSolar, solarToLunar } from '../src/modules/auspicious-date/calendar/lunar-calendar.js';
import { currentDate } from '../src/modules/auspicious-date/calendar/timezone.js';

// Independent published fixtures: Ho Ngoc Duc calendar rules (1984/2004),
// HKO 2026 conversion table (UTC+8; these dates agree at UTC+7), Vietnamese Tet 1985.
const fixtures = [
  ['1984-02-02', 1, 1, 1984, false], ['2004-03-21', 1, 2, 2004, true],
  ['2004-04-18', 29, 2, 2004, true], ['2004-04-19', 1, 3, 2004, false],
  ['2023-03-22', 1, 2, 2023, true], ['2024-02-10', 1, 1, 2024, false],
  ['2026-02-16', 29, 12, 2025, false], ['2026-02-17', 1, 1, 2026, false],
  ['1985-01-21', 1, 1, 1985, false], // Vietnamese calendar: Chinese new year is a month later.
] as const;
test('Vietnamese solar/lunar reference dates including leap, Tet and timezone difference', () => {
  for (const [date, day, month, year, leap] of fixtures) {
    assert.deepEqual(solarToLunar(date), { day, month, year, leap }, date);
    assert.equal(lunarToSolar({ day, month, year, leap }), date);
  }
});
test('Julian day, strict dates, fixed Vietnamese timezone and Can Chi Tet boundary', () => {
  assert.equal(julianDay('2000-01-01'), 2451545);
  assert.equal(dateFromJulianDay(2451545), '2000-01-01');
  for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '1899-12-31', '2100-01-01', '2026-2-01']) assert.throws(() => julianDay(date));
  assert.equal(currentDate(new Date('2026-10-02T17:00:00Z')), '2026-10-03');
  assert.equal(calendar('2026-02-16').canChi.year.label, 'Ất Tỵ');
  assert.equal(calendar('2026-02-17').canChi.year.label, 'Bính Ngọ');
  assert.equal(calendar('2000-01-07').canChi.day.label, 'Giáp Tý');
  assert.throws(() => lunarToSolar({ day: 30, month: 2, year: 2004, leap: true }));
});
test('calendar deterministic, roundtrip across full supported year boundaries including 2033', () => {
  for (let year = 1900; year <= 2099; year++) {
    for (const suffix of ['01-01', '02-15', '06-30', '12-31']) {
      const date = `${year}-${suffix}`;
      assert.equal(lunarToSolar(solarToLunar(date)), date);
    }
  }
  assert.deepEqual(calendar('2026-10-01'), calendar('2026-10-01'));
});
