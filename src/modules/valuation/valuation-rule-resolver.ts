import { ServiceUnavailableException } from '@nestjs/common';
import type { Category } from './domain.js';
import type { EstimateInput, Reference, Rule } from './estimate.types.js';

export function isEffective(row: { active: boolean; effectiveFrom: Date | null; effectiveTo: Date | null }, at: Date) {
  return row.active && (!row.effectiveFrom || row.effectiveFrom <= at) && (!row.effectiveTo || at < row.effectiveTo);
}
/** Builds one index per evaluation. There are no database reads in the resolver. */
export class ValuationRuleResolver {
  private readonly groups = new Map<Category, Rule[]>();
  constructor(rules: Rule[], private readonly vehicle: Pick<EstimateInput, 'brandId' | 'modelId' | 'variantId'>, private readonly at: Date) {
    for (const row of rules) if (isEffective(row, at)) {
      const group = this.groups.get(row.category);
      if (group) group.push(row); else this.groups.set(row.category, [row]);
    }
  }
  resolve(category: Category, selector: { value?: number; optionId?: string; colorId?: string } = {}) {
    const rows = (this.groups.get(category) ?? []).filter(row =>
      (selector.value === undefined || (row.minValue !== null && row.minValue <= selector.value && (row.maxValue === null || selector.value < row.maxValue))) &&
      (selector.optionId === undefined || row.optionId === selector.optionId) && (selector.colorId === undefined || row.colorId === selector.colorId));
    for (const scope of ['VARIANT', 'MODEL', 'BRAND', 'GLOBAL'] as const) {
      const matches = rows.filter(row => row.scope === scope && (scope === 'GLOBAL' || scope === 'BRAND' && row.brandId === this.vehicle.brandId || scope === 'MODEL' && row.modelId === this.vehicle.modelId || scope === 'VARIANT' && row.variantId === this.vehicle.variantId));
      if (matches.length > 1) throw new ServiceUnavailableException('Quy tắc định giá bị chồng lấn. Cần quản trị viên kiểm tra cấu hình.');
      if (matches[0]) return matches[0];
    }
    return null;
  }
  reference(rows: Reference[], year: number) {
    const matches = rows.filter(row => row.variantId === this.vehicle.variantId && row.modelYear === year && isEffective(row, this.at));
    if (matches.length > 1) throw new ServiceUnavailableException('Giá tham chiếu bị chồng thời gian hiệu lực. Cần kiểm tra cấu hình.');
    return matches[0] ?? null;
  }
}
