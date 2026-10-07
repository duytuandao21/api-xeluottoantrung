import { valuationOptions, valuationRules } from '../../database/schema/index.js';
import { OPTION_EXAMPLES, RANGE_EXAMPLES } from './defaults.js';
import type { OptionCategory } from './domain.js';
import type { Tx } from './valuation.repository.js';
export async function seedDraftExamples(tx: Tx, policyId: string) {
  await tx.insert(valuationRules).values(RANGE_EXAMPLES.map(rule => ({ ...rule, policyId, scope: 'GLOBAL' as const, note: 'Dữ liệu khởi tạo từ prompt; cần Admin rà soát trước khi áp dụng.' })));
  for (const [category, examples] of Object.entries(OPTION_EXAMPLES) as [OptionCategory, typeof OPTION_EXAMPLES[OptionCategory]][]) {
    const rows = [...examples, ['UNKNOWN', 'Chưa rõ', 0, ['ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION'].includes(category)] as typeof examples[number]];
    for (const [sortOrder, [code, label, adjustmentPercent, inspection]] of rows.entries()) {
      const [option] = await tx.insert(valuationOptions).values({ policyId, category, code, label, sortOrder, isUnknown: code === 'UNKNOWN', requiresInspection: !!inspection, description: 'Dữ liệu mẫu cần rà soát.' }).returning();
      await tx.insert(valuationRules).values({ policyId, category, optionId: option.id, scope: 'GLOBAL', adjustmentPercent, manualInspectionRequired: !!inspection, label, note: 'Tỷ lệ mẫu, chưa xác minh thị trường.' });
    }
  }
}
