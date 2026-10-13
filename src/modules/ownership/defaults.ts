import type { Policy, SettingsConfig } from './domain.js';
// Illustrative budgets only. Admin must tailor these to the actual vehicle/transaction.
export const DEFAULT_POLICY: Policy = {
  consumption: { gasoline: 8, diesel: 7, electric: 16 }, factors: { city: 1.2, mixed: 1, highway: 0.85 }, chargingLoss: 0.1,
  maintenanceMode: 'aggregate', maintenancePerKm: 500, maintenanceAnnual: 1000000, maintenance: [],
  repairAnnual: 1500000, repairAgeFactor: 0.08, repairOdoFactor: 0.1,
  depreciationAnnualPct: 10, depreciationAgeFactor: 0, depreciationOdoFactor: 0, residualFloorPct: 10,
};
export const DEFAULT_SETTINGS: SettingsConfig = {
  defaultFuel: 'gasoline', fallbackOdo: 50000, policy: DEFAULT_POLICY,
  energyPrices: { gasoline: 24000, diesel: 22000, electric: 3500 },
  loanDefaults: { downPct: 30, termMonths: 60, annualRate: 10 },
  defaults: { monthlyKm: 1000, driving: 'mixed', energyPrice: 24000, parking: 500000, wash: 200000, toll: 200000,
    insurance: 'mandatory', financed: false, downPct: null, termMonths: null, annualRate: null, years: 5, region: 'other', transaction: 'transfer' },
  parkingOptions: [0, 500000, 1500000], washOptions: [0, 200000, 400000], tollOptions: [0, 200000, 1000000], yearOptions: [1, 3, 5, 7, 10],
  regions: [{ key: 'other', label: 'Khu vực khác / chưa xác định' }, { key: 'hcm', label: 'TP. Hồ Chí Minh' }, { key: 'hanoi', label: 'Hà Nội' }],
  transactions: [{ key: 'transfer', label: 'Mua xe đã đăng ký / sang tên' }, { key: 'same_plate', label: 'Giữ đăng ký hiện có' }, { key: 'new_registration', label: 'Đăng ký mới' }],
  fees: [
    { key: 'mandatory', name: 'Ngân sách bảo hiểm bắt buộc (minh họa)', kind: 'mandatory', amount: 500000, pricePct: 0, fuel: 'any', bodyId: null, region: '', transaction: '' },
    { key: 'comprehensive', name: 'Bảo hiểm vật chất (minh họa)', kind: 'comprehensive', amount: 0, pricePct: 1.3, fuel: 'any', bodyId: null, region: '', transaction: '' },
    { key: 'annual', name: 'Ngân sách phí định kỳ (minh họa)', kind: 'annual', amount: 2000000, pricePct: 0, fuel: 'any', bodyId: null, region: '', transaction: '' },
  ],
};
