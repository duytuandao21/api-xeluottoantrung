import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { calendar } from '../calendar/calendar.js';
import { almanac } from '../almanac/almanac.js';
import { birthProfile } from '../compatibility/compatibility.js';
import { HANDLERS, type ReferenceExpectation, type ValidationReport } from '../domain.js';
import { validClassification } from '../auspicious-date.dto.js';
import { AuspiciousRepository, type Snapshot } from '../repository.js';
import { evaluate } from './rule-engine.js';

export function differences(expected: unknown, actual: unknown, path = ''): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return [path || 'value'];
    return expected.flatMap((item, index) => differences(item, actual[index], `${path}.${index}`));
  }
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== 'object') return [path || 'value'];
    return Object.entries(expected).flatMap(([key, value]) => differences(value, (actual as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return JSON.stringify(expected) === JSON.stringify(actual) ? [] : [path || 'value'];
}
export function assertExpectation(value: ReferenceExpectation) {
  if (!validClassification(value.classification) || Object.keys(value).some(key => !['calendar', 'almanac', 'rules', 'classification'].includes(key))) throw new BadRequestException('Expected cần classification hợp lệ, calendar/almanac/rules tùy chọn.');
  if (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.length > 100 || value.rules.some(rule => !rule || typeof rule.code !== 'string' || typeof rule.matched !== 'boolean' || Object.keys(rule).some(key => !['code', 'matched', 'status'].includes(key)) || (rule.status !== undefined && !['PASS', 'MATCH', 'FAIL', 'NOT_APPLICABLE'].includes(rule.status))))) throw new BadRequestException('Expected rules không hợp lệ.');
  if (value.calendar !== undefined && (value.calendar === null || typeof value.calendar !== 'object' || Array.isArray(value.calendar) || Object.keys(value.calendar).length === 0 || differences(value.calendar, calendar('2026-01-01')).some(path => path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key))))) throw new BadRequestException('Expected calendar không hợp lệ.');
  if (value.almanac !== undefined && (value.almanac === null || typeof value.almanac !== 'object' || Array.isArray(value.almanac) || Object.keys(value.almanac).length === 0 || differences(value.almanac, almanac(calendar('2026-01-01'))).some(path => path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key))))) throw new BadRequestException('Expected almanac không hợp lệ.');
  if (JSON.stringify(value).length > 16000) throw new BadRequestException('Dữ liệu tham chiếu quá lớn.');
}
@Injectable()
export class ReferenceValidation {
  constructor(@Inject(AuspiciousRepository) private readonly repo: AuspiciousRepository) {}
  run(snapshot: Snapshot, includeStructure = true): ValidationReport {
    const errors: string[] = [];
    const enabled = snapshot.rules.filter(rule => rule.isEnabled);
    if (includeStructure) {
      if (!enabled.length) errors.push('Chưa có quy tắc đang bật.');
      if (!enabled.some(rule => rule.engineHandler === 'PURPOSE_OFFICER')) errors.push('Chưa có quy tắc mục đích được xác minh (PURPOSE_OFFICER).');
      for (const rule of enabled) {
        if (!HANDLERS.includes(rule.engineHandler)) errors.push(`${rule.code}: handler không hỗ trợ.`);
        try { this.repo.assertRule(rule); } catch (error) { errors.push(`${rule.code}: ${error instanceof Error ? error.message : 'Cấu hình không hợp lệ'}`); }
        if (!snapshot.contents.some(content => content.ruleId === rule.id && content.locale === 'vi-VN' && content.title.trim() && content.shortDescription.trim())) errors.push(`${rule.code}: thiếu nội dung tiếng Việt.`);
        if (!snapshot.sources.some(source => source.ruleId === rule.id && source.verificationStatus === 'VERIFIED' && source.verifiedBy && source.verifiedAt && source.note.trim() && (source.url || source.pageReference))) errors.push(`${rule.code}: chưa có nguồn được xác minh.`);
      }
    }
    const active = snapshot.cases.filter(item => item.isActive);
    if (!active.length) errors.push('Cần ít nhất một ca tham chiếu độc lập trước khi xuất bản.');
    const cases = active.map(item => {
      const changed = item.ruleSetVersion !== snapshot.set.version;
      const diffs: string[] = [];
      try {
        assertExpectation(item.expected);
        if (item.purpose !== snapshot.set.purpose) diffs.push('purpose');
        const result = evaluate(item.targetDate, birthProfile(item.birthDate), item.purpose, snapshot.rules, snapshot.contents);
        if (item.expected.classification !== result.classification) diffs.push('classification');
        if (item.expected.calendar) diffs.push(...differences(item.expected.calendar, result.calendar, 'calendar'));
        if (item.expected.almanac) diffs.push(...differences(item.expected.almanac, result.almanac, 'almanac'));
        for (const expected of item.expected.rules ?? []) {
          const actual = result.trace.find(rule => rule.code === expected.code);
          diffs.push(...differences(expected, actual, `rules.${expected.code}`));
        }
      } catch (error) { diffs.push(error instanceof Error ? error.message : 'Invalid case'); }
      return { id: item.id, name: item.name, status: diffs.length ? 'FAIL' as const : changed ? 'CHANGED' as const : 'PASS' as const, differences: diffs };
    });
    if (includeStructure) for (const rule of enabled) {
      const outcomes = active.flatMap(item => item.expected.rules?.filter(expected => expected.code === rule.code).map(expected => expected.matched) ?? []);
      if (!outcomes.includes(true) || (rule.engineHandler !== 'GOOD_HOURS' && !outcomes.includes(false))) errors.push(`${rule.code}: cần ca tham chiếu match và non-match với kết quả kỳ vọng được nhập độc lập (GOOD_HOURS chỉ cần match).`);
    }
    const fail = cases.filter(item => item.status === 'FAIL').length, changed = cases.filter(item => item.status === 'CHANGED').length;
    return { passed: !errors.length && !fail && !changed, errors, total: cases.length, pass: cases.length - fail - changed, fail, changed, cases };
  }
}
