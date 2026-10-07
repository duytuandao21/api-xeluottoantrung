import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ValuationEngineService, vietnamDate } from '../src/modules/valuation/valuation-engine.service.js';
import { ValuationRuleResolver } from '../src/modules/valuation/valuation-rule-resolver.js';
import type { Category } from '../src/modules/valuation/domain.js';
import type { EstimateInput, Rule, Snapshot } from '../src/modules/valuation/estimate.types.js';
import { FIXTURE_NOW, fixtureId, valuationFixture } from './valuation-fixture.js';
const engine = new ValuationEngineService();
const calculate = (patch: Partial<EstimateInput> = {}, edit?: (snapshot: Snapshot) => void, at = FIXTURE_NOW) => { const { input, snapshot } = valuationFixture(); edit?.(snapshot); return engine.evaluate({ ...input, ...patch }, snapshot, at); };
const adjustment = (result: ReturnType<typeof calculate>, type: Category) => result.adjustments.find(row => row.type === type)!;
const scoped = (snapshot: Snapshot, scope: Rule['scope'], percent: number) => {
  const row = snapshot.rules.find(rule => rule.category === 'AGE' && rule.minValue === 3)!;
  snapshot.rules.push({ ...row, id: fixtureId(501 + snapshot.rules.length), scope, brandId: scope === 'BRAND' ? fixtureId(3) : null, modelId: scope === 'MODEL' ? fixtureId(4) : null, variantId: scope === 'VARIANT' ? fixtureId(5) : null, adjustmentPercent: percent });
};

test('new car / low ODO: age zero and expected ODO floor do not divide by zero', () => {
  const result = calculate({ modelYear: 2026, odometerKm: 0 }, snapshot => { snapshot.references[0].modelYear = 2026; });
  assert.equal(result.ageYears, 0); assert.equal(result.expectedOdometerKm, 7500); assert.equal(result.odometerDeviationPercent, -100);
  assert.equal(result.estimatedMarketValue, 845000000); assert.equal(result.status, 'ESTIMATED');
});
test('3-year car with expected ODO uses the documented multiplicative model', () => {
  const result = calculate(); assert.equal(result.estimatedMarketValue, 684000000); assert.equal(result.expectedOdometerKm, 45000);
  assert.equal(result.odometerDeviationPercent, 0); assert.equal(result.confidenceScore, 100);
  assert.deepEqual(result.adjustments.map(row => row.type), ['AGE', 'ODO', 'EXTERIOR', 'INTERIOR', 'ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION', 'SERVICE', 'OWNERS', 'USAGE', 'COLOR', 'MARKET']);
});
test('high ODO applies the correct band and policy penalty cap', () => {
  const result = calculate({ odometerKm: 90000 }); assert.equal(result.estimatedMarketValue, 616000000);
  assert.equal(adjustment(result, 'ODO').configuredPercentage, -10);
  const capped = calculate({ odometerKm: 90000 }, snapshot => { snapshot.policy.config.odoMaxPenaltyPercent = 4; });
  assert.equal(capped.estimatedMarketValue, 657000000);
});
test('repainted panels reduce value', () => { assert.equal(calculate({ exteriorCondition: 'REPAINT_3_5' }).estimatedMarketValue, 657000000); });
test('light accident adjusts price without automatically requiring inspection', () => { const result = calculate({ accidentLevel: 'LIGHT' }); assert.equal(result.estimatedMarketValue, 663000000); assert.equal(result.manualInspectionRequired, false); });
test('chassis damage requires inspection and hides ranges by default', () => {
  const result = calculate({ accidentLevel: 'CHASSIS' }); assert.equal(result.status, 'MANUAL_INSPECTION'); assert.equal(result.manualInspectionRequired, true);
  assert.equal(result.marketRange, null); assert.equal(result.dealerBuyingRange, null); assert.ok(result.candidateMarketRange); assert.ok(result.estimatedMarketValue! > 0);
});
test('flooding/hydrolock requires inspection', () => { for (const floodLevel of ['FLOOR', 'SEVERE', 'HYDROLOCK']) assert.equal(calculate({ floodLevel }).manualInspectionRequired, true); });
test('critical engine/transmission issues and unknown serious history require inspection', () => { for (const patch of [{ engineCondition: 'MAJOR' }, { transmissionCondition: 'WARNING' }, { accidentLevel: 'UNKNOWN' }, { floodLevel: 'UNKNOWN' }]) assert.equal(calculate(patch).manualInspectionRequired, true); });
test('service use applies the configured usage penalty', () => { assert.equal(calculate({ usageType: 'SERVICE' }).estimatedMarketValue, 657000000); });
test('full service history applies the configured bonus', () => { assert.equal(calculate({ serviceHistory: 'FULL' }).estimatedMarketValue, 698000000); });
test('color and active market overrides apply at the correct point in the product', () => {
  const result = calculate({}, snapshot => {
    const common = { ...snapshot.rules[0], minValue: null, maxValue: null };
    snapshot.rules.push({ ...common, id: fixtureId(301), category: 'COLOR', colorId: fixtureId(6), adjustmentPercent: 1 });
    snapshot.rules.push({ ...common, id: fixtureId(302), category: 'COLOR', colorId: fixtureId(6), scope: 'MODEL', modelId: fixtureId(4), adjustmentPercent: 2 });
    snapshot.rules.push({ ...common, id: fixtureId(303), category: 'MARKET', scope: 'VARIANT', variantId: fixtureId(5), adjustmentPercent: 5 });
  });
  assert.equal(result.estimatedMarketValue, 733000000); assert.equal(adjustment(result, 'COLOR').scope, 'MODEL'); assert.equal(adjustment(result, 'MARKET').scope, 'VARIANT');
});
test('model override wins over brand and global', () => { const result = calculate({}, snapshot => { scoped(snapshot, 'BRAND', -22); scoped(snapshot, 'MODEL', -20); }); assert.equal(result.estimatedMarketValue, 720000000); assert.equal(adjustment(result, 'AGE').scope, 'MODEL'); });
test('variant override wins over model regardless of insertion order', () => { const result = calculate({}, snapshot => { scoped(snapshot, 'VARIANT', -10); scoped(snapshot, 'MODEL', -20); scoped(snapshot, 'BRAND', -22); snapshot.rules.reverse(); }); assert.equal(result.estimatedMarketValue, 810000000); assert.equal(adjustment(result, 'AGE').scope, 'VARIANT'); });
test('missing reference never fabricates prices', () => { const result = calculate({}, snapshot => { snapshot.references = []; }); assert.equal(result.status, 'MISSING_REFERENCE'); assert.equal(result.referencePrice, null); assert.equal(result.marketRange, null); assert.equal(result.estimatedMarketValue, null); assert.equal(result.confidenceScore, 0); assert.equal(result.manualInspectionRequired, true); });
test('invalid, fractional, NaN, Infinity and excessive ODO are rejected', () => { for (const odometerKm of [-1, 0.5, NaN, Infinity, 2000001]) assert.throws(() => calculate({ odometerKm }), BadRequestException); });
test('invalid, future and too-old model years are rejected', () => { for (const modelYear of [1880, 2027, 1900, 2023.5, NaN]) assert.throws(() => calculate({ modelYear }), BadRequestException); });
test('inactive rules are ignored, including a more specific override', () => { const result = calculate({}, snapshot => { scoped(snapshot, 'VARIANT', -10); snapshot.rules.at(-1)!.active = false; }); assert.equal(result.estimatedMarketValue, 684000000); });
test('expired/future market rules are ignored and end time is exclusive', () => {
  const edit = (snapshot: Snapshot) => snapshot.rules.push({ ...snapshot.rules[0], id: fixtureId(999), category: 'MARKET', minValue: null, maxValue: null, adjustmentPercent: 10, effectiveFrom: new Date('2020-01-01Z'), effectiveTo: FIXTURE_NOW });
  assert.equal(calculate({}, edit).estimatedMarketValue, 684000000);
  assert.equal(calculate({}, snapshot => { edit(snapshot); snapshot.rules.at(-1)!.effectiveFrom = new Date('2027-01-01Z'); snapshot.rules.at(-1)!.effectiveTo = null; }).estimatedMarketValue, 684000000);
});
test('extreme combined penalties cannot produce zero/negative or below-floor values', () => { const result = calculate({}, snapshot => { snapshot.rules.forEach(row => { row.adjustmentPercent = -95; }); }); assert.equal(result.estimatedMarketValue, 135000000); assert.equal(result.cap!.applied, true); assert.ok(result.marketRange!.min > 0); assert.ok(result.dealerBuyingRange!.min > 0); });
test('extreme bonuses respect ceiling and safe integer monetary outputs', () => { const result = calculate({}, snapshot => { snapshot.rules.forEach(row => { row.adjustmentPercent = 100; }); }); assert.equal(result.estimatedMarketValue, 1125000000); for (const value of [...Object.values(result.marketRange!), ...Object.values(result.dealerBuyingRange!)]) assert.ok(Number.isSafeInteger(value) && value > 0 && value <= 1125000000); });
test('confidence uses configurable completeness weights; unknown values earn no weight', () => {
  const result = calculate({ odometerKm: null, ownerCount: null }); assert.equal(result.confidenceScore, 80); assert.equal(result.confidenceLevel, 'HIGH'); assert.ok(result.missingFields.includes('odometerKm'));
  assert.equal(calculate({ engineCondition: 'UNKNOWN' }).confidenceScore, 92);
  const configured = calculate({ odometerKm: null }, snapshot => { for (const key of Object.keys(snapshot.policy.config.confidenceWeights) as (keyof typeof snapshot.policy.config.confidenceWeights)[]) snapshot.policy.config.confidenceWeights[key] = key === 'odo' ? 100 : 0; });
  assert.equal(configured.confidenceScore, 0); assert.equal(configured.confidenceLevel, 'LOW');
});
test('dealer margin and outward rounding match hand calculations', () => {
  const result = calculate(); assert.deepEqual(result.marketRange, { min: 663000000, max: 705000000 });
  assert.deepEqual(result.dealerBuyingRange, { min: 636000000, max: 657000000 });
  const exact = calculate({}, snapshot => { snapshot.policy.config.roundingVnd = 1; }); assert.deepEqual(exact.dealerBuyingRange, { min: 636120000, max: 656640000 });
});
test('manual flag from a scoped rule is respected even when percentage is zero', () => { const result = calculate({}, snapshot => { snapshot.rules.find(row => row.category === 'AGE' && row.minValue === 3)!.manualInspectionRequired = true; }); assert.equal(result.manualInspectionRequired, true); assert.equal(result.marketRange, null); });
test('Admin policy can permit indicative ranges for a severe condition', () => { const result = calculate({ accidentLevel: 'CHASSIS' }, snapshot => { snapshot.policy.config.showSeverePriceRange = true; }); assert.equal(result.status, 'MANUAL_INSPECTION'); assert.ok(result.marketRange); });
test('manufacturing date is preferred over registration and calendar years', () => { const result = calculate({ manufacturingDate: '2023-12-31', registrationDate: '2024-02-01' }); assert.equal(result.ageSource, 'MANUFACTURING_DATE'); assert.ok(result.ageYears > 2 && result.ageYears < 3); assert.equal(adjustment(result, 'AGE').configuredPercentage, -18); });
test('registration date fallback and young-car expected ODO are finite', () => { const result = calculate({ modelYear: 2026, registrationDate: '2026-10-06' }, snapshot => { snapshot.references[0].modelYear = 2026; }); assert.equal(result.ageSource, 'REGISTRATION_DATE'); assert.equal(result.expectedOdometerKm, 7500); });
test('exact anniversary switches the age band without average-year rounding drift', () => {
  const edit = (snapshot: Snapshot) => { snapshot.references[0].modelYear = 2024; };
  const before = calculate({ modelYear: 2024, manufacturingDate: '2024-10-06' }, edit, new Date('2027-10-05T05:00:00Z'));
  const birthday = calculate({ modelYear: 2024, manufacturingDate: '2024-10-06' }, edit, new Date('2027-10-06T05:00:00Z'));
  assert.ok(before.ageYears < 3); assert.equal(birthday.ageYears, 3); assert.equal(adjustment(birthday, 'AGE').configuredPercentage, -24);
  const leap = calculate({ modelYear: 2024, manufacturingDate: '2024-02-29' }, edit, new Date('2025-03-01T05:00:00Z')); assert.equal(leap.ageYears, 1);
});
test('impossible, future or inconsistent production/registration dates are rejected', () => {
  for (const patch of [{ manufacturingDate: '2023-02-30' }, { manufacturingDate: '2024-01-01' }, { registrationDate: '2027-01-01' }, { manufacturingDate: '2023-06-01', registrationDate: '2023-05-01' }]) assert.throws(() => calculate(patch), BadRequestException);
});
test('Vietnam calendar year is used at UTC year boundary', () => { assert.equal(vietnamDate(new Date('2025-12-31T18:00:00Z')), '2026-01-01'); const result = calculate({}, undefined, new Date('2025-12-31T18:00:00Z')); assert.equal(result.ageYears, 3); });
test('market reference normalizes age and ODO instead of depreciating twice', () => {
  const edit = (snapshot: Snapshot) => { snapshot.references[0].basePriceType = 'MARKET_REFERENCE'; };
  assert.equal(calculate({}, edit).estimatedMarketValue, 680000000);
  assert.equal(calculate({}, edit, new Date('2027-10-06T05:00:00Z')).estimatedMarketValue, 633000000); // age .70/.76 and ODO bonus +1% for 45k vs expected 60k
  assert.equal(calculate({ odometerKm: 90000 }, snapshot => { edit(snapshot); snapshot.references[0].referenceOdometerKm = 90000; }).estimatedMarketValue, 680000000);
  assert.equal(calculate({}, snapshot => { edit(snapshot); snapshot.references[0].referenceOdometerKm = 90000; }).estimatedMarketValue, 694000000, 'Effective bonus after anchor normalization must also respect the 2% cap');
});
test('selected price type controls the base, without inferring MSRP from a car listing', () => { assert.equal(calculate({}, snapshot => { snapshot.references[0].basePriceType = 'CURRENT_MSRP'; }).referencePrice, 1000000000); });
test('inactive or expired references are missing; conflicting references fail closed', () => {
  assert.equal(calculate({}, snapshot => { snapshot.references[0].active = false; }).status, 'MISSING_REFERENCE');
  assert.equal(calculate({}, snapshot => { snapshot.references[0].effectiveTo = FIXTURE_NOW; }).status, 'MISSING_REFERENCE');
  assert.throws(() => calculate({}, snapshot => { snapshot.references.push({ ...snapshot.references[0], id: fixtureId(900) }); }), ServiceUnavailableException);
});
test('required rule gaps suppress estimates; optional color/market use neutral fallback', () => { const result = calculate({}, snapshot => { snapshot.rules = snapshot.rules.filter(row => row.category !== 'AGE'); }); assert.equal(result.status, 'INSUFFICIENT_DATA'); assert.equal(result.marketRange, null); assert.equal(result.manualInspectionRequired, true); assert.equal(adjustment(calculate(), 'COLOR').factor, 1); });
test('invalid or inactive condition codes are rejected rather than treated as good condition', () => { assert.throws(() => calculate({ accidentLevel: 'DOES_NOT_EXIST' }), BadRequestException); assert.throws(() => calculate({}, snapshot => { snapshot.options.find(row => row.category === 'EXTERIOR' && row.code === 'ORIGINAL')!.active = false; }), BadRequestException); });
test('overlapping equally specific rules fail closed', () => { assert.throws(() => calculate({}, snapshot => { scoped(snapshot, 'MODEL', -20); scoped(snapshot, 'MODEL', -10); }), ServiceUnavailableException); });
test('range boundaries use [min,max) and a matching foreign policy is never mixed in', () => { const { input, snapshot } = valuationFixture(); const resolver = new ValuationRuleResolver(snapshot.rules, input, FIXTURE_NOW); assert.equal(resolver.resolve('ODO', { value: 10 })!.adjustmentPercent, -2); assert.equal(resolver.resolve('ODO', { value: 100 })!.adjustmentPercent, -10); assert.equal(calculate({}, snapshot => { snapshot.rules.push({ ...snapshot.rules[3], id: fixtureId(900), policyId: fixtureId(901) }); }).estimatedMarketValue, 684000000); });
test('invalid config is rejected and identical input/snapshot/clock is deterministic', () => { assert.throws(() => calculate({}, snapshot => { snapshot.policy.config.dealerMarginMinPercent = 90; snapshot.policy.config.dealerMarginMaxPercent = 4; }), ServiceUnavailableException); assert.deepEqual(calculate(), calculate()); });
