import { BadRequestException } from '@nestjs/common';
import type { PolicyConfig } from './domain.js';
import { OPTION_CATEGORIES, RANGE_CATEGORIES } from './domain.js';
import type { valuationOptions, valuationReferencePrices, valuationRules } from '../../database/schema/valuation.js';
type Rule = typeof valuationRules.$inferSelect;
type Reference = typeof valuationReferencePrices.$inferSelect;
type Option = typeof valuationOptions.$inferSelect;
export function assertConfig(config: PolicyConfig) {
  if (config.dealerMarginMinPercent > config.dealerMarginMaxPercent) throw new BadRequestException('Biên thu mua tối thiểu không được lớn hơn tối đa.');
  if (config.mediumConfidenceThreshold >= config.highConfidenceThreshold) throw new BadRequestException('Ngưỡng dữ liệu cao phải lớn hơn ngưỡng trung bình.');
  if (Object.values(config.confidenceWeights).reduce((sum, weight) => sum + weight, 0) <= 0) throw new BadRequestException('Tổng trọng số đầy đủ dữ liệu phải lớn hơn 0.');
}
export function datesOverlap(a: { effectiveFrom: Date | null; effectiveTo: Date | null }, b: { effectiveFrom: Date | null; effectiveTo: Date | null }) {
  return (a.effectiveFrom?.getTime() ?? -Infinity) < (b.effectiveTo?.getTime() ?? Infinity)
    && (b.effectiveFrom?.getTime() ?? -Infinity) < (a.effectiveTo?.getTime() ?? Infinity);
}
export function rulesOverlap(a: Rule, b: Rule) {
  if (!a.active || !b.active || a.category !== b.category || a.scope !== b.scope
    || a.brandId !== b.brandId || a.modelId !== b.modelId || a.variantId !== b.variantId
    || a.optionId !== b.optionId || a.colorId !== b.colorId || !datesOverlap(a, b)) return false;
  if (!RANGE_CATEGORIES.includes(a.category)) return true;
  return (a.minValue ?? -Infinity) < (b.maxValue ?? Infinity) && (b.minValue ?? -Infinity) < (a.maxValue ?? Infinity);
}
export function assertNoRuleOverlap(row: Rule, existing: Rule[]) {
  if (existing.some(rule => rule.id !== row.id && rulesOverlap(row, rule))) throw new BadRequestException('Quy tắc trùng phạm vi, lựa chọn/khoảng hoặc thời gian hiệu lực. Khoảng dùng [từ, đến), để trống đến = không giới hạn.');
}
export function assertNoPriceOverlap(row: Reference, existing: Reference[]) {
  if (row.active && existing.some(price => price.id !== row.id && price.active && price.variantId === row.variantId && price.modelYear === row.modelYear && datesOverlap(row, price))) throw new BadRequestException('Giá tham chiếu cùng phiên bản/năm bị chồng thời gian hiệu lực.');
}
export function validateMasterData(rules: Rule[], options: Option[], references: Reference[], config: PolicyConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  try { assertConfig(config); } catch (error) { errors.push(error instanceof Error ? error.message : 'Cấu hình không hợp lệ.'); }
  if (!references.some(price => price.active && price.effectiveFrom <= new Date() && (!price.effectiveTo || price.effectiveTo > new Date()))) errors.push('Cần ít nhất một giá tham chiếu đang có hiệu lực, có nguồn được kiểm tra.');
  for (const price of references) { try { assertNoPriceOverlap(price, references); } catch { errors.push(`Giá trùng: ${price.variantId} / ${price.modelYear}.`); } }
  for (const rule of rules) { try { assertNoRuleOverlap(rule, rules); } catch { errors.push(`Quy tắc trùng: ${rule.label}.`); } }
  for (const [category, domainMin] of [['AGE', 0], ['ODO', -100], ['OWNERS', 1]] as const) {
    const ranges = rules.filter(rule => rule.active && rule.category === category && rule.scope === 'GLOBAL' && !rule.effectiveFrom && !rule.effectiveTo).sort((a, b) => (a.minValue ?? -Infinity) - (b.minValue ?? -Infinity));
    let boundary: number | null = domainMin;
    for (const rule of ranges) {
      if (boundary === null || rule.minValue !== boundary) { errors.push(`${category}: khoảng GLOBAL cần liên tục từ ${domainMin}, không trùng/hở.`); break; }
      boundary = rule.maxValue;
    }
    if (!ranges.length || boundary !== null) errors.push(`${category}: cần bộ khoảng GLOBAL đầy đủ đến không giới hạn.`);
  }
  for (const category of OPTION_CATEGORIES) {
    const active = options.filter(option => option.category === category && option.active);
    if (active.filter(option => option.isUnknown).length !== 1) errors.push(`${category}: cần đúng một lựa chọn “Chưa rõ” đang hoạt động.`);
    if (!active.some(option => !option.isUnknown)) errors.push(`${category}: cần lựa chọn tình trạng đang hoạt động.`);
    for (const option of active) {
      const global = rules.find(rule => rule.active && rule.scope === 'GLOBAL' && rule.optionId === option.id && !rule.effectiveFrom && !rule.effectiveTo);
      if (!global) errors.push(`Thiếu quy tắc GLOBAL cho “${option.label}” (${category}).`);
      if (option.requiresInspection && rules.some(rule => rule.active && rule.optionId === option.id && !rule.manualInspectionRequired)) errors.push(`“${option.label}” phải yêu cầu kiểm tra trực tiếp ở mọi phạm vi.`);
    }
  }
  if (!rules.some(rule => rule.active && rule.category === 'COLOR')) warnings.push('Chưa có hệ số màu: áp dụng hệ số trung tính.');
  if (!rules.some(rule => rule.active && rule.category === 'MARKET')) warnings.push('Chưa có hệ số thị trường: áp dụng hệ số trung tính.');
  warnings.push('Kiểm tra này xác nhận cấu trúc dữ liệu, không xác minh mức giá và tỷ lệ với thị trường. Quản trị viên cần rà soát nguồn giá và quy tắc trước khi áp dụng.');
  return { errors: [...new Set(errors)], warnings };
}
