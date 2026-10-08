import { BadRequestException } from '@nestjs/common';
import { ENVIRONMENTS, GROUPS, PASSENGERS, PRIORITIES, PURPOSES, STYLES, TECHNICAL, type Answers, type Criteria, type RecommendationConfig } from './domain.js';
const assert = (valid: unknown, message: string) => { if (!valid) throw new BadRequestException(message); };
const unique = (values: string[]) => new Set(values).size === values.length;
export function validateConfig(config: RecommendationConfig): void {
  assert(config && Array.isArray(config.questions) && config.questions.length >= 7 && config.questions.length <= 20, 'Cấu hình câu hỏi không hợp lệ.');
  assert(config.questions.every(q => q && typeof q.key === 'string' && Array.isArray(q.options) && q.options.every(o => o && typeof o.key === 'string' && typeof o.label === 'string') && typeof q.enabled === 'boolean' && typeof q.required === 'boolean') && unique(config.questions.map(q => q.key)), 'Mã hoặc cấu trúc câu hỏi không hợp lệ.');
  const stable = { purposes: ['multi', PURPOSES], budget: ['budget', []], passengers: ['single', PASSENGERS], environment: ['single', ENVIRONMENTS], priorities: ['multi', PRIORITIES], technical: ['technical', []], style: ['single', STYLES] } as const;
  for (const [key, [type, codes]] of Object.entries(stable)) {
    const q = config.questions.find(item => item.key === key);
    assert(q && q.type === type && codes.every(code => q.options.some(option => option.key === code)) && q.options.length === codes.length, `Không được thay mã scoring của câu hỏi ${key}.`);
    if (!['technical', 'style'].includes(key)) assert(q!.enabled && q!.required, `Câu hỏi ${key} là bắt buộc.`);
    if (type !== 'multi') assert(q!.maxSelections === 1, `Câu hỏi ${key} chỉ nhận một lựa chọn.`);
    if (key === 'technical') assert(!q!.required, 'Thông số kỹ thuật cần giữ tùy chọn Không quan trọng.');
    assert(q!.enabled || !q!.required, 'Câu hỏi bị ẩn không được đánh dấu bắt buộc.');
  }
  for (const q of config.questions) {
    assert(q.enabled || !q.required, 'Câu hỏi bị ẩn không được đánh dấu bắt buộc.');
    if (q.type === 'single') assert(q.maxSelections === 1, 'Câu hỏi một lựa chọn phải có giới hạn bằng 1.');
    assert(typeof q.title === 'string' && q.title.trim().length > 0 && q.title.length <= 240 && typeof q.description === 'string' && q.description.length <= 1000 && typeof q.helpText === 'string' && q.helpText.length <= 1000, 'Nội dung câu hỏi không hợp lệ.');
    assert(Number.isInteger(q.maxSelections) && q.maxSelections >= 1 && q.maxSelections <= 3 && unique(q.options.map(o => o.key)), 'Số lựa chọn không hợp lệ.');
    assert(q.options.every(o => /^[a-z0-9][a-z0-9_]{0,39}$/.test(o.key) && typeof o.label === 'string' && o.label.trim() && o.label.length <= 160), 'Lựa chọn câu hỏi không hợp lệ.');
    if (!Object.hasOwn(stable, q.key)) assert(/^custom_[a-z0-9_]{1,32}$/.test(q.key) && ['single', 'multi'].includes(q.type) && q.options.length > 0 && q.options.length <= 20, 'Câu hỏi bổ sung không hợp lệ.');
  }
  assert(config.questions.find(q => q.key === 'purposes')!.maxSelections <= 2, 'Chỉ chọn tối đa 2 mục đích.');
  assert(config.weights && Object.keys(config.weights).length === GROUPS.length && GROUPS.every(key => Number.isFinite(config.weights[key]) && config.weights[key] >= 0 && config.weights[key] <= 100) && Math.abs(Object.values(config.weights).reduce((sum, weight) => sum + weight, 0) - 100) < 0.00001, 'Tổng trọng số phải bằng 100.');
  assert(config.weights.budget > 0, 'Trọng số ngân sách phải lớn hơn 0.');
  assert(Number.isSafeInteger(config.minBudget) && Number.isSafeInteger(config.maxBudget) && config.minBudget >= 0 && config.maxBudget > config.minBudget && config.maxBudget <= 50000000000 && Number.isInteger(config.maxResults) && config.maxResults >= 1 && config.maxResults <= 5000, 'Giới hạn cấu hình không hợp lệ.');
  assert(Array.isArray(config.budgetPresets) && config.budgetPresets.length <= 12 && config.budgetPresets.every(p => p && typeof p.label === 'string' && p.label.trim() && p.label.length <= 100 && Number.isSafeInteger(p.min) && Number.isSafeInteger(p.max) && p.min >= config.minBudget && p.max <= config.maxBudget && p.max > p.min), 'Mốc ngân sách không hợp lệ.');
}
export function normalizeAnswers(answers: Answers, config: RecommendationConfig): Criteria {
  validateConfig(config);
  for (const key of ['purposes', 'priorities'] as const) {
    const q = config.questions.find(item => item.key === key)!;
    assert(Array.isArray(answers[key]) && answers[key].length >= 1 && answers[key].length <= q.maxSelections && unique(answers[key]) && answers[key].every(code => q.options.some(o => o.key === code)), `Lựa chọn ${q.title} không hợp lệ.`);
  }
  assert(PASSENGERS.includes(answers.passengers as typeof PASSENGERS[number]) && ENVIRONMENTS.includes(answers.environment as typeof ENVIRONMENTS[number]), 'Số người hoặc môi trường chưa hợp lệ.');
  assert(answers.budget && Number.isSafeInteger(answers.budget.min) && Number.isSafeInteger(answers.budget.max) && answers.budget.min >= config.minBudget && answers.budget.max <= config.maxBudget && answers.budget.max > 0 && answers.budget.max >= answers.budget.min, 'Ngân sách không hợp lệ.');
  assert(!answers.style || STYLES.includes(answers.style as typeof STYLES[number]), 'Phong cách không hợp lệ.');
  const styleQuestion = config.questions.find(q => q.key === 'style')!;
  assert(styleQuestion.enabled || !answers.style, 'Phong cách đang được ẩn. Vui lòng tải lại khảo sát.');
  assert(!styleQuestion.enabled || !styleQuestion.required || !!answers.style, 'Vui lòng chọn phong cách.');
  const technical = Object.fromEntries(TECHNICAL.filter(key => !!answers.technical?.[key]).map(key => [key, answers.technical![key]!]));
  const requiredTechnical = answers.technical?.required || [];
  assert(unique(requiredTechnical) && requiredTechnical.every(key => TECHNICAL.includes(key) && !!technical[key]), 'Thông số bắt buộc phải được chọn.');
  assert(config.questions.find(q => q.key === 'technical')!.enabled || !Object.keys(technical).length && !requiredTechnical.length, 'Thông số kỹ thuật đang được ẩn. Vui lòng tải lại khảo sát.');
  for (const q of config.questions.filter(q => q.key.startsWith('custom_'))) {
    const value = answers.extras?.[q.key], values = Array.isArray(value) ? value : value ? [value] : [];
    assert((q.enabled || !values.length) && (!q.required || !q.enabled || values.length > 0) && values.length <= (q.type === 'single' ? 1 : q.maxSelections) && unique(values) && values.every(v => q.options.some(o => o.key === v)), 'Câu trả lời bổ sung không hợp lệ.');
  }
  assert(Object.keys(answers.extras || {}).every(key => config.questions.some(q => q.key === key && q.key.startsWith('custom_'))), 'Không nhận câu trả lời ngoài khảo sát.');
  const preferredSeats = { '1_2': 2, '3_5': 5, '6_7': 7, over7: 8 }[answers.passengers]!;
  return { budgetMin: answers.budget.min, budgetMax: answers.budget.max, purposes: answers.purposes, priorities: answers.priorities, environment: answers.environment, preferredSeats, minimumSeats: answers.requireSeats ? preferredSeats : null, technical, requiredTechnical, style: answers.style || null };
}
