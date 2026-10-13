import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateOwnership, loanSchedule, resolvePolicy } from '../src/modules/ownership/calculator.js';
import { DEFAULT_POLICY, DEFAULT_SETTINGS } from '../src/modules/ownership/defaults.js';
import { validateAnswers, validatePolicy, validateSettings } from '../src/modules/ownership/validation.js';
import type { Answers, Policy, Profile, Vehicle } from '../src/modules/ownership/domain.js';
const car: Vehicle = { id: 'car', name: 'Toyota Vios', slug: 'vios', price: 500000000, year: 2023, mileage: 49000, fuel: 'Xăng', modelId: 'model', versionId: 'version', bodyStyleId: 'body', brand: 'Toyota', model: 'Vios', cover: null };
const calculate = (answers: Partial<Answers> = {}, vehicle: Partial<Vehicle> = {}, policy: Partial<Policy> = {}) => {
  const config = structuredClone(DEFAULT_SETTINGS); config.policy = { ...config.policy, ...policy };
  const v = { ...car, ...vehicle }; return calculateOwnership(v, { ...config.defaults, ...answers }, config, resolvePolicy(v, config, []), 2026);
};
test('ownership defaults and strict policy validation', () => {
  validateSettings(DEFAULT_SETTINGS);
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, maintenanceMode: 'scheduled', maintenance: [{ key: 'oil', name: 'Dầu', amount: 200000, everyKm: 5000, everyMonths: 6 }] }));
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, maintenance: [{ key: 'oil', name: 'Dầu', amount: 200000, everyKm: 5000, everyMonths: 6 }] }));
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, maintenanceMode: 'scheduled', maintenanceAnnual: 0, maintenancePerKm: 0, maintenance: [{ key: 'oil', name: 'Dầu', amount: 200000, everyKm: 5000, everyMonths: 6 }, { key: 'oil', name: 'Dầu 2', amount: 200000, everyKm: 5000, everyMonths: 6 }] }));
});
test('gasoline, diesel, EV formulas and travel factor', () => {
  assert.equal(calculate().breakdown[0].monthly, 1920000);
  assert.equal(calculate({ driving: 'city' }).breakdown[0].monthly, 2304000);
  assert.equal(calculate({ energyPrice: 22000 }, { fuel: 'Dầu' }).breakdown[0].monthly, 1540000);
  const ev = calculate({ energyPrice: 3500 }, { fuel: 'Điện' }); assert.equal(ev.breakdown[0].monthly, 616000); assert.equal(ev.energyUnit, 'kWh');
});
test('zero distance still retains time-based expenses; min/max stable', () => {
  const idle = calculate({ monthlyKm: 0 }); assert.equal(idle.breakdown[0].monthly, 0); assert.ok(idle.operatingMonthly > 0);
  const max = calculate({ monthlyKm: 20000, energyPrice: 100000, years: 20, parking: 20000000, wash: 20000000, toll: 20000000, financed: true, downPct: 0, termMonths: 240, annualRate: 40 }, { price: 100000000000, mileage: 2000000 });
  assert.ok(Number.isSafeInteger(max.tco)); assert.ok(max.resale >= 0); assert.ok(max.resale <= max.vehicle.price); assert.ok(max.financing!.remainingPrincipal === 0);
});
test('maintenance uses existing ODO and first due km/month, no duplicate combined triggers', () => {
  const schedule: Partial<Policy> = { maintenanceMode: 'scheduled', maintenancePerKm: 0, maintenanceAnnual: 0, maintenance: [{ key: 'oil', name: 'Dầu', amount: 300000, everyKm: 5000, everyMonths: 6 }] };
  const result = calculate({ monthlyKm: 1000, years: 1 }, {}, schedule);
  assert.deepEqual(result.maintenanceEvents.map(e => e.month), [1, 6, 11]); assert.equal(result.breakdown.find(b => b.key === 'maintenance')!.total, 900000);
  assert.equal(calculate({ monthlyKm: 0, years: 1 }, {}, schedule).breakdown.find(b => b.key === 'maintenance')!.total, 600000);
  assert.equal(calculate({ monthlyKm: 1000, years: 1 }, { mileage: 45000 }, schedule).maintenanceEvents[0].month, 5);
  const coincident = calculate({ monthlyKm: 1000, years: 1 }, { mileage: 40000 }, { ...schedule, maintenance: [{ key: 'oil', name: 'Dầu', amount: 300000, everyKm: 6000, everyMonths: 6 }] }); assert.deepEqual(coincident.maintenanceEvents.map(e => e.month), [2, 8]);
});
test('annuity zero interest, positive interest, rounded final balance and short ownership', () => {
  const zero = loanSchedule(300000000, 60, 0); assert.equal(zero.payment, 5000000); assert.equal(zero.schedule[59].balance, 0); assert.equal(zero.schedule.reduce((n, r) => n + r.interest, 0), 0);
  const normal = loanSchedule(300000000, 60, 10); assert.ok(Math.abs(normal.payment - 6374113) <= 1); assert.equal(normal.schedule[59].balance, 0); assert.equal(normal.schedule.reduce((n, r) => n + r.principal, 0), 300000000);
  const short = calculate({ financed: true, downPct: 40, termMonths: 60, annualRate: 10, years: 1 });
  assert.equal(short.financing!.remainingPrincipal, normal.schedule[11].balance); assert.equal(short.netResale, short.resale - short.financing!.remainingPrincipal);
  assert.equal(short.cashMonthly, short.operatingMonthly + short.financing!.monthlyPayment);
  assert.equal(short.initialCash, 200000000); assert.equal(loanSchedule(0, 60, 10).payment, 0);
});
test('TCO excludes loan principal; cash and 0% loan equal economic costs', () => {
  const cash = calculate({ years: 1 }), zero = calculate({ financed: true, downPct: 0, termMonths: 60, annualRate: 0, years: 1 }), loan = calculate({ financed: true, downPct: 40, termMonths: 60, annualRate: 10, years: 1 });
  assert.equal(cash.tco, zero.tco); assert.equal(loan.tco - cash.tco, loan.financing!.interest);
  assert.equal(cash.tco, car.price + cash.initialFees + cash.operatingTotal - cash.resale);
  assert.equal(cash.operatingTotal, cash.breakdown.reduce((s, r) => s + r.total, 0)); assert.equal(cash.operatingMonthly, cash.breakdown.reduce((s, r) => s + r.monthly, 0));
  assert.equal(cash.series.find(p => p.years === 1)!.tco, cash.tco);
});
test('resale floor and zero depreciation', () => {
  const flat = calculate({ years: 20 }, {}, { depreciationAnnualPct: 0 }); assert.equal(flat.resale, car.price);
  const floor = calculate({ years: 20 }, {}, { depreciationAnnualPct: 60 }); assert.equal(floor.resale, 50000000);
});
test('profile precedence and labeled missing fuel/ODO fallbacks', () => {
  const profiles: Profile[] = (['fuel', 'body', 'model', 'version', 'car'] as const).map((scope, i) => ({ id: scope, name: scope, scope, target: scope === 'fuel' ? 'gasoline' : scope, policy: { ...DEFAULT_POLICY, consumption: { gasoline: i + 5, diesel: 7, electric: 16 } }, updatedAt: new Date() }));
  assert.equal(resolvePolicy(car, DEFAULT_SETTINGS, profiles).policy.consumption.gasoline, 9);
  assert.equal(resolvePolicy(car, DEFAULT_SETTINGS, profiles.slice(0, 4)).profile!.scope, 'version');
  const missing = calculate({}, { fuel: null, mileage: null }); assert.equal(missing.resolved.odo, DEFAULT_SETTINGS.fallbackOdo); assert.ok(missing.explanations.some(s => s.includes('ODO chưa cập nhật'))); assert.ok(missing.explanations.some(s => s.includes('Nhiên liệu chưa xác định')));
});
test('conditional fees, selected insurance, one-off finance and no overlap with annual', () => {
  const c = structuredClone(DEFAULT_SETTINGS); c.fees.push({ key: 'transfer', name: 'Phí giao dịch', kind: 'initial', amount: 2000000, pricePct: 1, region: 'hcm', fuel: 'gasoline', bodyId: 'body', transaction: 'transfer' }, { key: 'loan', name: 'Phí vay', kind: 'finance', amount: 1000000, pricePct: 0, region: '', fuel: 'any', bodyId: null, transaction: '' });
  const a = { ...c.defaults, region: 'hcm', years: 1, financed: true, downPct: 40, termMonths: 60, annualRate: 0, insurance: 'comprehensive' } as Answers;
  const result = calculateOwnership(car, a, c, resolvePolicy(car, c, []), 2026);
  assert.equal(result.initialFees, 7000000); assert.equal(result.financeFees, 1000000); assert.equal(result.initialCash, 208000000);
  assert.equal(result.breakdown.find(r => r.key === 'insurance')!.total, 9000000);
  assert.equal(result.tco, car.price + result.initialFees + result.financeFees + result.operatingTotal - result.resale);
});
test('bad input, unknown fields, huge price and invalid loan rejected', () => {
  for (const value of [-1, NaN, Infinity, 20001, 1.5]) assert.throws(() => calculate({ monthlyKm: value }));
  for (const price of [0, -1, NaN, Infinity, 100000000001]) assert.throws(() => calculate({}, { price }));
  assert.throws(() => calculate({ financed: true, downPct: 30, termMonths: 0, annualRate: 10 }));
  assert.throws(() => validateAnswers({ ...DEFAULT_SETTINGS.defaults, price: 1 } as Answers, DEFAULT_SETTINGS));
  assert.throws(() => calculate({ downPct: 30 }));
});
