import type { Answers, Policy, SettingsConfig } from './domain.js';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function numberIn(v: unknown, min: number, max: number, integer = false): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isSafeInteger(v));
}
function keys(v: unknown, allowed: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).some(key => !allowed.includes(key))) throw new Error('Trường dữ liệu không hợp lệ.');
}
function requireNumber(v: unknown, min: number, max: number, label: string, integer = false) {
  if (!numberIn(v, min, max, integer)) throw new Error(`${label}: giá trị phải từ ${min} đến ${max}.`);
}
export function validatePolicy(p: Policy) {
  keys(p, ['consumption', 'factors', 'chargingLoss', 'maintenanceMode', 'maintenancePerKm', 'maintenanceAnnual', 'maintenance', 'repairAnnual', 'repairAgeFactor', 'repairOdoFactor', 'depreciationAnnualPct', 'depreciationAgeFactor', 'depreciationOdoFactor', 'residualFloorPct']);
  keys(p.consumption, ['gasoline', 'diesel', 'electric']); keys(p.factors, ['city', 'mixed', 'highway']);
  for (const fuel of ['gasoline', 'diesel', 'electric'] as const) requireNumber(p.consumption[fuel], 0.1, 100, 'Tiêu hao');
  for (const driving of ['city', 'mixed', 'highway'] as const) requireNumber(p.factors[driving], 0.2, 3, 'Hệ số di chuyển');
  requireNumber(p.chargingLoss, 0, 0.5, 'Hao hụt sạc');
  if (!['aggregate', 'scheduled'].includes(p.maintenanceMode)) throw new Error('Chọn cách dự toán bảo dưỡng.');
  for (const field of ['maintenancePerKm', 'maintenanceAnnual', 'repairAnnual'] as const) requireNumber(p[field], 0, field === 'maintenancePerKm' ? 10000 : 100000000, field, true);
  for (const field of ['repairAgeFactor', 'repairOdoFactor', 'depreciationAgeFactor', 'depreciationOdoFactor'] as const) requireNumber(p[field], 0, 1, field);
  requireNumber(p.depreciationAnnualPct, 0, 60, 'Khấu hao'); requireNumber(p.residualFloorPct, 0, 100, 'Giá trị còn lại tối thiểu');
  if (!Array.isArray(p.maintenance) || p.maintenance.length > 30) throw new Error('Tối đa 30 hạng mục bảo dưỡng.');
  const seen = new Set<string>();
  for (const item of p.maintenance) {
    keys(item, ['key', 'name', 'amount', 'everyKm', 'everyMonths']);
    if (typeof item.key !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(item.key) || seen.has(item.key) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) throw new Error('Hạng mục bảo dưỡng cần mã duy nhất và tên.');
    seen.add(item.key); requireNumber(item.amount, 0, 100000000, 'Chi phí hạng mục', true);
    if (item.everyKm !== null) requireNumber(item.everyKm, 1000, 500000, 'Chu kỳ km', true);
    if (item.everyMonths !== null) requireNumber(item.everyMonths, 1, 120, 'Chu kỳ tháng', true);
    if (item.everyKm === null && item.everyMonths === null) throw new Error('Bảo dưỡng cần chu kỳ km hoặc tháng.');
  }
  if (p.maintenanceMode === 'scheduled' && (!p.maintenance.length || p.maintenancePerKm !== 0 || p.maintenanceAnnual !== 0)) throw new Error('Chế độ lịch cần hạng mục; định mức tổng phải bằng 0 để tránh cộng trùng.');
  if (p.maintenanceMode === 'aggregate' && p.maintenance.length) throw new Error('Chế độ định mức tổng không kèm lịch hạng mục.');
}
export function validateAnswers(a: Answers, config: SettingsConfig): Answers {
  keys(a, ['monthlyKm', 'driving', 'energyPrice', 'parking', 'wash', 'toll', 'insurance', 'financed', 'downPct', 'termMonths', 'annualRate', 'years', 'region', 'transaction']);
  requireNumber(a.monthlyKm, 0, 20000, 'Km/tháng', true); requireNumber(a.energyPrice, 1, 100000, 'Giá năng lượng', true);
  for (const key of ['parking', 'wash', 'toll'] as const) requireNumber(a[key], 0, 20000000, key, true);
  if (!['city', 'mixed', 'highway'].includes(a.driving) || !['mandatory', 'comprehensive'].includes(a.insurance) || typeof a.financed !== 'boolean') throw new Error('Lựa chọn khảo sát không hợp lệ.');
  requireNumber(a.years, 1, 20, 'Thời gian sở hữu', true);
  if (!config.regions.some(row => row.key === a.region) || !config.transactions.some(row => row.key === a.transaction)) throw new Error('Khu vực / trường hợp giao dịch không hợp lệ.');
  if (a.financed) { requireNumber(a.downPct, 0, 100, 'Trả trước (%)'); requireNumber(a.termMonths, 1, 240, 'Kỳ hạn vay', true); requireNumber(a.annualRate, 0, 40, 'Lãi suất (%)'); }
  else if (a.downPct !== null || a.termMonths !== null || a.annualRate !== null) throw new Error('Mua tiền mặt không kèm thông số vay.');
  return a;
}
export function validateSettings(c: SettingsConfig) {
  keys(c, ['defaultFuel', 'fallbackOdo', 'policy', 'energyPrices', 'loanDefaults', 'defaults', 'parkingOptions', 'washOptions', 'tollOptions', 'yearOptions', 'regions', 'transactions', 'fees']);
  keys(c.loanDefaults, ['downPct', 'termMonths', 'annualRate']); requireNumber(c.loanDefaults.downPct, 0, 100, 'Trả trước mặc định'); requireNumber(c.loanDefaults.termMonths, 1, 240, 'Kỳ hạn mặc định', true); requireNumber(c.loanDefaults.annualRate, 0, 40, 'Lãi suất mặc định');
  if (!['gasoline', 'diesel', 'electric'].includes(c.defaultFuel)) throw new Error('Nhiên liệu mặc định không hợp lệ.');
  requireNumber(c.fallbackOdo, 0, 2000000, 'ODO dự phòng', true); validatePolicy(c.policy);
  keys(c.energyPrices, ['gasoline', 'diesel', 'electric']); for (const f of ['gasoline', 'diesel', 'electric'] as const) requireNumber(c.energyPrices[f], 1, 100000, 'Giá năng lượng', true);
  for (const field of ['parkingOptions', 'washOptions', 'tollOptions', 'yearOptions'] as const) {
    if (!Array.isArray(c[field]) || !c[field].length || c[field].length > 8 || new Set(c[field]).size !== c[field].length) throw new Error('Cần 1–8 lựa chọn nhanh khác nhau.');
    for (const value of c[field]) requireNumber(value, field === 'yearOptions' ? 1 : 0, field === 'yearOptions' ? 20 : 20000000, field, true);
  }
  for (const field of ['regions', 'transactions'] as const) {
    if (!Array.isArray(c[field]) || !c[field].length || c[field].length > 30) throw new Error('Danh mục cần 1–30 lựa chọn.');
    const seen = new Set<string>(); for (const row of c[field]) { keys(row, ['key', 'label']); if (typeof row.key !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(row.key) || seen.has(row.key) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 120) throw new Error('Mã danh mục phải duy nhất, tên tối đa 120 ký tự.'); seen.add(row.key); }
  }
  validateAnswers(c.defaults, c);
  if (!Array.isArray(c.fees) || c.fees.length > 40) throw new Error('Tối đa 40 quy tắc phí.');
  const seen = new Set<string>(); for (const f of c.fees) {
    keys(f, ['key', 'name', 'kind', 'amount', 'pricePct', 'fuel', 'bodyId', 'region', 'transaction']);
    if (typeof f.key !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(f.key) || seen.has(f.key) || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 120) throw new Error('Phí cần mã duy nhất và tên.'); seen.add(f.key);
    if (!['initial', 'annual', 'mandatory', 'comprehensive', 'finance'].includes(f.kind) || !['any', 'gasoline', 'diesel', 'electric'].includes(f.fuel)) throw new Error('Loại phí không hợp lệ.');
    requireNumber(f.amount, 0, 100000000, 'Phí cố định', true); requireNumber(f.pricePct, 0, 30, 'Phí theo % giá');
    if (f.bodyId !== null && (typeof f.bodyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(f.bodyId))) throw new Error('Nhóm xe không hợp lệ.');
    if (f.region !== '' && !c.regions.some(r => r.key === f.region) || f.transaction !== '' && !c.transactions.some(r => r.key === f.transaction)) throw new Error('Điều kiện phí không thuộc danh mục.');
  }
}
