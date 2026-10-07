import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfigDto } from './valuation.dto.js';
import { EstimateDto } from './estimate.dto.js';
import { OPTION_CATEGORIES, type Category } from './domain.js';
import { CONDITION_FIELDS, type Adjustment, type EstimateInput, type Evaluation, type PriceRange, type Rule, type Snapshot } from './estimate.types.js';
import { ValuationRuleResolver } from './valuation-rule-resolver.js';
import { assertConfig } from './validation.js';

const labels: Record<Category, string> = {
  AGE: 'Tuổi xe', ODO: 'Số km đã sử dụng', EXTERIOR: 'Tình trạng ngoại thất', INTERIOR: 'Tình trạng nội thất',
  ACCIDENT: 'Lịch sử tai nạn', FLOOD: 'Tình trạng ngập nước', ENGINE: 'Tình trạng động cơ', TRANSMISSION: 'Tình trạng hộp số',
  SERVICE: 'Lịch sử bảo dưỡng', OWNERS: 'Số chủ sở hữu', USAGE: 'Mục đích sử dụng', COLOR: 'Màu xe', MARKET: 'Cung cầu thị trường',
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function vietnamDate(at: Date) {
  if (!Number.isFinite(at.getTime())) throw new BadRequestException('Thời điểm tính không hợp lệ.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dateOnly(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Ngày sản xuất/đăng ký không hợp lệ.');
  return date;
}
function calendarAge(start: Date, today: Date) {
  const anniversary = (year: number) => new Date(Date.UTC(year, start.getUTCMonth(), start.getUTCDate()));
  let years = today.getUTCFullYear() - start.getUTCFullYear();
  if (anniversary(start.getUTCFullYear() + years) > today) years--;
  const last = anniversary(start.getUTCFullYear() + years), next = anniversary(start.getUTCFullYear() + years + 1);
  // A Feb 29 production anniversary is March 1 in non-leap years.
  return years + (today.getTime() - last.getTime()) / (next.getTime() - last.getTime());
}
function safeMoney(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ServiceUnavailableException('Giá/cấu hình vượt giới hạn tính toán an toàn. Cần quản trị viên kiểm tra.');
  return value;
}

/** Pure calculation over a supplied snapshot/clock; does not fetch prices, call AI, or write history. */
@Injectable()
export class ValuationEngineService {
  evaluate(input: EstimateInput, snapshot: Snapshot, at: Date): Evaluation {
    const config = snapshot.policy.config;
    if (validateSync(plainToInstance(ConfigDto, config), { whitelist: true, forbidNonWhitelisted: true }).length) throw new ServiceUnavailableException('Cấu hình định giá không hợp lệ.');
    try { assertConfig(config); } catch { throw new ServiceUnavailableException('Cấu hình định giá không nhất quán.'); }
    if (validateSync(plainToInstance(EstimateDto, input), { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException('Thông tin xe không hợp lệ.');
    const today = vietnamDate(at), year = Number(today.slice(0, 4));
    if (input.modelYear > year || input.modelYear < config.minModelYear || year - input.modelYear > config.maxVehicleAge) throw new BadRequestException('Năm xe nằm ngoài giới hạn cấu hình hoặc ở tương lai.');
    if (input.odometerKm != null && input.odometerKm > config.maxOdometerKm) throw new BadRequestException('ODO vượt giới hạn cấu hình.');
    for (const value of [input.manufacturingDate, input.registrationDate]) if (value) { dateOnly(value); if (value > today || Number(value.slice(0, 4)) < input.modelYear) throw new BadRequestException('Ngày sản xuất/đăng ký ở tương lai hoặc trước năm xe.'); }
    if (input.manufacturingDate && Number(input.manufacturingDate.slice(0, 4)) !== input.modelYear) throw new BadRequestException('Ngày sản xuất phải khớp năm xe.');
    if (input.manufacturingDate && input.registrationDate && input.registrationDate < input.manufacturingDate) throw new BadRequestException('Ngày đăng ký không được trước ngày sản xuất.');
    const exactDate = input.manufacturingDate ?? input.registrationDate;
    const ageYears = exactDate ? calendarAge(dateOnly(exactDate), dateOnly(today)) : year - input.modelYear;
    if (ageYears > config.maxVehicleAge) throw new BadRequestException('Tuổi xe vượt giới hạn cấu hình.');
    const expectedOdo = (age: number) => Math.max(age, config.youngVehicleAgeFloor) * config.expectedKmPerYear;
    const deviation = (odo: number, age: number) => (odo - expectedOdo(age)) / expectedOdo(age) * 100;
    const resolver = new ValuationRuleResolver(snapshot.rules.filter(row => row.policyId === snapshot.policy.id), input, at);
    const options = snapshot.options.filter(row => row.active && row.policyId === snapshot.policy.id);
    const selected = new Map<typeof OPTION_CATEGORIES[number], typeof options[number]>();
    const missingFields: string[] = [], known: Record<keyof typeof config.confidenceWeights, boolean> = {
      odo: input.odometerKm != null, exterior: false, interior: false, accident: false, flood: false, engine: false, transmission: false,
      service: false, owners: input.ownerCount != null, usage: false, color: input.colorId != null,
    };
    const weightKeys = { EXTERIOR: 'exterior', INTERIOR: 'interior', ACCIDENT: 'accident', FLOOD: 'flood', ENGINE: 'engine', TRANSMISSION: 'transmission', SERVICE: 'service', USAGE: 'usage' } as const;
    let manual = false;
    const reasons: Evaluation['reasons'] = [];
    const reason = (code: string, message: string) => { if (!reasons.some(row => row.code === code)) reasons.push({ code, message }); };
    for (const category of OPTION_CATEGORIES) {
      const field = CONDITION_FIELDS[category], code = input[field];
      const candidates = options.filter(row => row.category === category && (code ? row.code === code : row.isUnknown));
      if (candidates.length !== 1) {
        if (code) throw new BadRequestException(`Lựa chọn ${labels[category]} không tồn tại hoặc đã ngừng sử dụng.`);
        throw new ServiceUnavailableException('Danh mục tình trạng thiếu hoặc trùng lựa chọn chưa rõ.');
      }
      const option = candidates[0]; selected.set(category, option); known[weightKeys[category]] = !option.isUnknown;
      if (!known[weightKeys[category]]) missingFields.push(field);
      if (option.requiresInspection) { manual = true; reason(`INSPECTION_${category}`, `${labels[category]} cần được kiểm tra trực tiếp.`); }
    }
    if (!known.odo) missingFields.push('odometerKm');
    if (!known.owners) missingFields.push('ownerCount');
    if (!known.color) missingFields.push('colorId');
    const totalWeight = Object.values(config.confidenceWeights).reduce((sum, weight) => sum + weight, 0);
    const score = Math.round(Object.entries(config.confidenceWeights).reduce((sum, [field, weight]) => sum + (known[field as keyof typeof known] ? weight : 0), 0) / totalWeight * 100);
    const reference = resolver.reference(snapshot.references.filter(row => row.policyId === snapshot.policy.id), input.modelYear);
    const result: Evaluation = {
      status: 'ESTIMATED', policyId: snapshot.policy.id, policyVersion: snapshot.policy.version, policyRevision: snapshot.policy.revision, calculatedAt: at.toISOString(),
      ageYears, ageSource: input.manufacturingDate ? 'MANUFACTURING_DATE' : input.registrationDate ? 'REGISTRATION_DATE' : 'MODEL_YEAR',
      expectedOdometerKm: expectedOdo(ageYears), odometerDeviationPercent: input.odometerKm == null ? null : deviation(input.odometerKm, ageYears),
      referencePrice: null, referenceType: null, referenceId: null, referenceBasis: null,
      estimatedMarketValue: null, marketRange: null, dealerBuyingRange: null, candidateMarketRange: null, candidateDealerBuyingRange: null,
      confidenceScore: score, confidenceLevel: score >= config.highConfidenceThreshold ? 'HIGH' : score >= config.mediumConfidenceThreshold ? 'MEDIUM' : 'LOW',
      missingFields, manualInspectionRequired: manual, reasons, adjustments: [], cap: null,
    };
    if (!reference) {
      result.status = 'MISSING_REFERENCE'; result.manualInspectionRequired = true; result.confidenceScore = 0; result.confidenceLevel = 'LOW';
      result.missingFields.push('referencePrice'); reason('MISSING_REFERENCE', 'Chưa có giá tham chiếu phù hợp. Xe cần kiểm định trực tiếp để được định giá.'); return result;
    }
    const base = reference.basePriceType === 'ORIGINAL_MSRP' ? reference.originalMsrp : reference.basePriceType === 'CURRENT_MSRP' ? reference.currentMsrp : reference.marketReference;
    if (!base || !Number.isSafeInteger(base) || base < 1) throw new ServiceUnavailableException('Giá nền chưa hợp lệ.');
    result.referencePrice = base; result.referenceId = reference.id; result.referenceType = reference.basePriceType;
    let value = base, incomplete = false;
    const ruleFactor = (rule: Rule) => {
      if (!Number.isFinite(rule.adjustmentPercent) || rule.adjustmentPercent < -95 || rule.adjustmentPercent > 100) throw new ServiceUnavailableException('Tỷ lệ định giá không hợp lệ.');
      if (rule.manualInspectionRequired) { manual = true; reason(`INSPECTION_${rule.category}`, `${labels[rule.category]} cần được kiểm tra trực tiếp.`); }
      return 1 + (rule.category === 'ODO' ? clamp(rule.adjustmentPercent, -config.odoMaxPenaltyPercent, config.odoMaxBonusPercent) : rule.adjustmentPercent) / 100;
    };
    const requireRule = (category: Category, rule: Rule | null) => {
      if (!rule) { incomplete = true; manual = true; reason(`MISSING_RULE_${category}`, `Thiếu dữ liệu cấu hình cho ${labels[category].toLowerCase()}, cần kiểm định trực tiếp.`); }
      return rule;
    };
    const apply = (category: Category, rule: Rule | null, factor = rule ? ruleFactor(rule) : 1) => {
      const before = value; value *= factor;
      const adjustment: Adjustment = { type: category, label: labels[category], ruleId: rule?.id ?? null, scope: rule?.scope ?? null,
        configuredPercentage: rule?.adjustmentPercent ?? 0, percentage: (factor - 1) * 100, factor, before, after: value,
        manualInspectionRequired: rule?.manualInspectionRequired ?? false, fallback: !rule };
      result.adjustments.push(adjustment);
    };
    const ageRule = requireRule('AGE', resolver.resolve('AGE', { value: ageYears }));
    let ageFactor = ageRule ? ruleFactor(ageRule) : 1, odoBaseline = 1;
    if (reference.basePriceType === 'MARKET_REFERENCE') {
      if (reference.referenceAgeYears == null || reference.referenceOdometerKm == null || !Number.isFinite(reference.referenceAgeYears) || reference.referenceAgeYears < 0 || !Number.isInteger(reference.referenceOdometerKm) || reference.referenceOdometerKm < 0 || reference.basisNote.trim().length < 3) throw new ServiceUnavailableException('Giá thị trường chưa có giả định nền hợp lệ.');
      const anchorAgeRule = requireRule('AGE', resolver.resolve('AGE', { value: reference.referenceAgeYears }));
      const anchorOdoRule = requireRule('ODO', resolver.resolve('ODO', { value: deviation(reference.referenceOdometerKm, reference.referenceAgeYears) }));
      const anchorAgeFactor = anchorAgeRule ? ruleFactor(anchorAgeRule) : 1;
      odoBaseline = anchorOdoRule ? ruleFactor(anchorOdoRule) : 1;
      ageFactor /= anchorAgeFactor;
      result.referenceBasis = { ageYears: reference.referenceAgeYears, odometerKm: reference.referenceOdometerKm, ageFactor: anchorAgeFactor, odoFactor: odoBaseline, note: reference.basisNote };
    }
    apply('AGE', ageRule, ageFactor);
    const odoRule = input.odometerKm == null ? null : requireRule('ODO', resolver.resolve('ODO', { value: result.odometerDeviationPercent! }));
    // Unknown ODO is neutral, including for market anchors: no invented bonus or penalty.
    apply('ODO', odoRule, odoRule ? clamp(ruleFactor(odoRule) / odoBaseline, 1 - config.odoMaxPenaltyPercent / 100, 1 + config.odoMaxBonusPercent / 100) : 1);
    for (const category of ['EXTERIOR', 'INTERIOR', 'ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION', 'SERVICE'] as const) apply(category, requireRule(category, resolver.resolve(category, { optionId: selected.get(category)!.id })));
    apply('OWNERS', input.ownerCount == null ? null : requireRule('OWNERS', resolver.resolve('OWNERS', { value: input.ownerCount })));
    apply('USAGE', requireRule('USAGE', resolver.resolve('USAGE', { optionId: selected.get('USAGE')!.id })));
    apply('COLOR', input.colorId ? resolver.resolve('COLOR', { colorId: input.colorId }) : null);
    apply('MARKET', resolver.resolve('MARKET'));
    result.manualInspectionRequired = manual;
    if (incomplete) { result.status = 'INSUFFICIENT_DATA'; result.confidenceScore = 0; result.confidenceLevel = 'LOW'; return result; }
    const minimum = Math.max(1, Math.ceil(base * config.minValueFactor)), maximum = Math.floor(Math.min(Number.MAX_SAFE_INTEGER, base * config.maxValueFactor));
    const capped = clamp(value, minimum, maximum);
    result.cap = { before: value, after: capped, min: minimum, max: maximum, applied: value !== capped };
    if (!Number.isFinite(value)) throw new ServiceUnavailableException('Kết quả định giá vượt giới hạn tính toán.');
    const rounded = safeMoney(clamp(Math.round(capped / config.roundingVnd) * config.roundingVnd, minimum, maximum));
    result.estimatedMarketValue = rounded;
    const range = (low: number, high: number, floor: number, ceiling: number): PriceRange => {
      const min = safeMoney(clamp(Math.floor(low / config.roundingVnd) * config.roundingVnd, floor, ceiling));
      const max = safeMoney(clamp(Math.ceil(high / config.roundingVnd) * config.roundingVnd, floor, ceiling));
      return { min, max: Math.max(min, max) };
    };
    result.candidateMarketRange = range(rounded * (1 - config.marketRangeMinusPercent / 100), rounded * (1 + config.marketRangePlusPercent / 100), minimum, maximum);
    result.candidateDealerBuyingRange = range(rounded * (1 - config.dealerMarginMaxPercent / 100), rounded * (1 - config.dealerMarginMinPercent / 100), 1, rounded);
    if (manual) result.status = 'MANUAL_INSPECTION';
    if (!manual || config.showSeverePriceRange) { result.marketRange = result.candidateMarketRange; result.dealerBuyingRange = result.candidateDealerBuyingRange; }
    return result;
  }
}
