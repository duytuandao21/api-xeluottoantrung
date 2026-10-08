import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RECOMMENDATION_CONFIG as config } from '../src/modules/car-recommendations/defaults.js';
import { normalizeAnswers, validateConfig } from '../src/modules/car-recommendations/validation.js';
import { rankCars } from '../src/modules/car-recommendations/engine.js';
import type { Answers, Candidate } from '../src/modules/car-recommendations/domain.js';
export const needsAnswers: Answers = { purposes: ['family'], budget: { min: 200000000, max: 500000000 }, passengers: '3_5', requireSeats: true, environment: 'city', priorities: ['safety', 'space'], technical: { required: [] } };
export const needsCar = (id: string, changes: Partial<Candidate> = {}): Candidate => ({ id, slug: `car-${id}`, name: `Xe ${id}`, price: 300000000, year: 2023, mileage: 40000, seatCount: 5, brand: { name: 'Toyota', slug: 'toyota' }, model: { name: 'Vios', slug: 'vios' }, bodyStyle: { name: 'Sedan', slug: 'sedan' }, transmission: { name: 'Tự động', slug: 'tu-dong' }, fuel: 'Xăng', cover: null, branch: null, assessments: null, ...changes });
test('recommendations: hard max budget, required seats/technical, unknown seats excluded, min budget soft', () => {
  const criteria = normalizeAnswers(needsAnswers, config);
  const result = rankCars([needsCar('a'), needsCar('b', { price: 501000000 }), needsCar('c', { seatCount: 4 }), needsCar('d', { seatCount: null }), needsCar('e', { price: 100000000 }), needsCar('f', { price: 0 })], criteria, config);
  assert.deepEqual(result.map(r => r.car.id), ['a', 'e']);
  assert.match(result[1].reasons[0], /thấp hơn/);
  const forced = normalizeAnswers({ ...needsAnswers, technical: { brand: 'honda', required: ['brand'] } }, config);
  assert.equal(rankCars([needsCar('a')], forced, config).length, 0);
});
test('recommendations: missing data never yields invented profile scores/reasons', () => {
  const ranked = rankCars([needsCar('a')], normalizeAnswers(needsAnswers, config), config)[0];
  assert.equal(ranked.score, 39); assert.equal(ranked.coverage, 39);
  assert.deepEqual(ranked.components.filter(c => ['purposes', 'priorities', 'environment'].includes(c.key)).map(c => c.coverage), [0, 0, 0]);
  assert.equal(ranked.reasons.length, 2); assert.doesNotMatch(ranked.reasons.join(' '), /an toàn|giữ giá/i);
  assert.match(ranked.caveats.join(' '), /hạn chế/);
  const badSource = rankCars([needsCar('a', { assessments: { 'priorities.safety': { score: 5, source: '' } } })], normalizeAnswers(needsAnswers, config), config)[0];
  assert.equal(badSource.score, ranked.score);
});
test('recommendations: source-backed assessments, priority order and weights change scoring, style does not', () => {
  const a = needsCar('a', { assessments: { 'priorities.safety': { score: 5, source: 'Kiểm tra tài liệu trang thiết bị của đúng xe' }, 'priorities.space': { score: 1, source: 'Đo khoang cabin xe cụ thể' } } });
  const b = needsCar('b', { assessments: { 'priorities.safety': { score: 1, source: 'Đối chiếu trang thiết bị xe' }, 'priorities.space': { score: 5, source: 'Đo khoang cabin xe cụ thể' } } });
  const criteria = normalizeAnswers(needsAnswers, config);
  assert.equal(rankCars([b, a], criteria, config)[0].car.id, 'a');
  assert.equal(rankCars([b, a], { ...criteria, priorities: ['space', 'safety'] }, config)[0].car.id, 'b');
  assert.deepEqual(rankCars([a], criteria, config), rankCars([a], { ...criteria, style: 'luxury' }, config));
  const changed = { ...config, weights: { budget: 75, purposes: 0, priorities: 5, environment: 0, seats: 20, technical: 0 } };
  validateConfig(changed); assert.notEqual(rankCars([a], criteria, changed)[0].score, rankCars([a], criteria, config)[0].score);
});
test('recommendations: null technical data, stable ties, duplicate-free deterministic results and configurable total limit', () => {
  const criteria = normalizeAnswers({ ...needsAnswers, requireSeats: false, technical: { transmission: 'tu-dong' } }, config);
  const noTransmission = needsCar('a', { transmission: { name: null, slug: null }, seatCount: null });
  const known = rankCars([needsCar('b')], criteria, config)[0], missing = rankCars([noTransmission], criteria, config)[0];
  assert.ok(missing.score < known.score && missing.coverage < known.coverage);
  const cars = ['f', 'e', 'd', 'c', 'b', 'a'].map(id => needsCar(id));
  assert.deepEqual(rankCars(cars, criteria, config), rankCars([...cars].reverse(), criteria, config));
  assert.deepEqual(rankCars(cars, criteria, config).map(r => r.car.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(rankCars(cars, criteria, { ...config, maxResults: 5 }).map(r => r.car.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(rankCars([...cars, cars[0], cars[1]], criteria, config), rankCars(cars, criteria, config));
});
test('recommendations: protected question keys, selection limits, weights, budget, extra input validation', () => {
  assert.throws(() => normalizeAnswers({ ...needsAnswers, purposes: ['family', 'family'] }, config));
  assert.throws(() => normalizeAnswers({ ...needsAnswers, budget: { min: 700000000, max: 500000000 } }, config));
  assert.throws(() => normalizeAnswers({ ...needsAnswers, extras: { phone: '0901234567' } }, config));
  assert.throws(() => validateConfig({ ...config, questions: config.questions.filter(q => q.key !== 'budget') }));
  assert.throws(() => validateConfig({ ...config, weights: { ...config.weights, budget: 24 } }));
  assert.throws(() => validateConfig({ ...config, questions: [...config.questions, { ...config.questions[6], key: 'toString' }] }));
  assert.throws(() => validateConfig({ ...config, questions: config.questions.map(q => q.key === 'passengers' ? { ...q, options: [] } : q) }));
});
