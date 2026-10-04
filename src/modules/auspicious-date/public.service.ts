import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { auspiciousRuleSets } from '../../database/schema/index.js';
import { DetailDto, PersonDto, SearchDto } from './auspicious-date.dto.js';
import { calendar } from './calendar/calendar.js';
import { dateFromJulianDay, julianDay } from './calendar/julian-day.js';
import { currentDate, MAX_YEAR, MIN_YEAR, TIMEZONE } from './calendar/timezone.js';
import { birthProfile } from './compatibility/compatibility.js';
import { evaluate, type Evaluation } from './engine/rule-engine.js';
import { rank } from './engine/scoring.js';
import { AuspiciousRepository, type Settings } from './repository.js';

export function validatePerson(dto: PersonDto) {
  try { julianDay(dto.birthDate); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Ngày sinh không hợp lệ.'); }
  if (dto.birthDate > currentDate()) throw new BadRequestException('Ngày sinh không được ở tương lai.');
}
export function validateTarget(date: string) {
  try { return julianDay(date); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Ngày không hợp lệ.'); }
}
function publicDay(result: Evaluation, settings: Settings) {
  return { date: result.date, classification: result.classification, criticalViolations: result.criticalViolations,
    ...(settings.showScore ? { score: result.score } : {}),
    summaryReasons: settings.showExplanation ? result.reasons.map(({ detailDescription: _detail, ...reason }) => { void _detail; return reason; }) : [],
    ...(settings.showLunarDate ? { lunar: result.calendar.lunar } : {}) };
}
@Injectable()
export class AuspiciousPublicService {
  constructor(@Inject(AuspiciousRepository) private readonly repo: AuspiciousRepository) {}
  async config() {
    const settings = await this.repo.settings();
    const versions = await this.repo.database.db.select().from(auspiciousRuleSets).where(eq(auspiciousRuleSets.status, 'PUBLISHED'));
    const available = settings.supportedPurposes.flatMap(purpose => versions.filter(set => set.purpose === purpose));
    const defaultFrom = currentDate() > `${MAX_YEAR}-12-31` ? `${MAX_YEAR}-12-31` : currentDate();
    const defaultTo = dateFromJulianDay(Math.min(julianDay(defaultFrom) + Math.min(30, settings.maxSearchDays) - 1, julianDay(`${MAX_YEAR}-12-31`)));
    return { enabled: settings.isEnabled && available.length > 0, name: settings.name, maxSearchDays: settings.maxSearchDays,
      defaultPurpose: available.some(set => set.purpose === settings.defaultPurpose) ? settings.defaultPurpose : available[0]?.purpose ?? settings.defaultPurpose,
      purposes: available.map(set => set.purpose),
      display: { showLunarDate: settings.showLunarDate, showCanChi: settings.showCanChi, showGoodHours: settings.showGoodHours, showExplanation: settings.showExplanation, showScore: settings.showScore },
      disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel, seoTitle: settings.seoTitle, seoDescription: settings.seoDescription,
      timezone: TIMEZONE, currentDate: currentDate(), minDate: `${MIN_YEAR}-01-01`, maxDate: `${MAX_YEAR}-12-31`,
      defaultFrom, defaultTo,
      versions: Object.fromEntries(available.map(set => [set.purpose, set.version])) };
  }
  private async active(dto: PersonDto) {
    validatePerson(dto);
    const settings = await this.repo.settings();
    if (!settings.isEnabled) throw new ServiceUnavailableException('Tiện ích đang tạm bảo trì. Vui lòng quay lại sau.');
    if (!settings.supportedPurposes.includes(dto.purpose)) throw new BadRequestException('Mục đích chưa được hỗ trợ.');
    const [set] = await this.repo.database.db.select().from(auspiciousRuleSets).where(and(eq(auspiciousRuleSets.purpose, dto.purpose), eq(auspiciousRuleSets.status, 'PUBLISHED')));
    if (!set) throw new ServiceUnavailableException('Mục đích này chưa có bộ quy tắc được xuất bản.');
    return { settings, snapshot: await this.repo.snapshot(set.id), profile: birthProfile(dto.birthDate) };
  }
  async search(dto: SearchDto) {
    const from = validateTarget(dto.from), to = validateTarget(dto.to);
    if (to < from) throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
    const { settings, snapshot, profile } = await this.active(dto);
    if (to - from + 1 > settings.maxSearchDays) throw new BadRequestException(`Chỉ được xem tối đa ${settings.maxSearchDays} ngày (tính cả ngày đầu và cuối).`);
    const evaluated = Array.from({ length: to - from + 1 }, (_, offset) => evaluate(dateFromJulianDay(from + offset), profile, dto.purpose, snapshot.rules, snapshot.contents));
    const results = evaluated.map(day => publicDay(day, settings));
    // Calendar layout belongs to the backend; clients receive display-ready cells (Monday-first).
    const keys = [...new Set(results.map(day => day.date.slice(0, 7)))];
    const months = keys.map(key => {
      const first = julianDay(`${key}-01`), year = Number(key.slice(0, 4)), month = Number(key.slice(5));
      const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const offset = (calendar(`${key}-01`).weekday + 6) % 7;
      return { key, label: `Tháng ${month}/${year}`, cells: [...Array.from({ length: offset }, () => null), ...Array.from({ length: count }, (_, day) => {
        const date = dateFromJulianDay(first + day), result = results.find(item => item.date === date);
        return { date, day: day + 1, classification: result?.classification ?? null };
      })] };
    });
    return { rulesetVersion: snapshot.set.version, from: dto.from, to: dto.to, results, months,
      recommended: rank(evaluated).filter(day => ['VERY_GOOD', 'GOOD'].includes(day.classification)).slice(0, 6).map(day => publicDay(day, settings)),
      disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel };
  }
  async detail(dto: DetailDto) {
    validateTarget(dto.targetDate);
    const { settings, snapshot, profile } = await this.active(dto);
    if (dto.expectedRulesetVersion && dto.expectedRulesetVersion !== snapshot.set.version) throw new ConflictException('Bộ quy tắc vừa thay đổi. Vui lòng tra cứu lại để xem kết quả nhất quán.');
    const result = evaluate(dto.targetDate, profile, dto.purpose, snapshot.rules, snapshot.contents);
    return { ...publicDay(result, settings),
      calendar: { solarDate: result.date, ...(settings.showLunarDate ? { lunar: result.calendar.lunar } : {}),
        ...(settings.showCanChi ? { canChi: result.calendar.canChi, solarTerm: result.calendar.solarTerm } : {}) },
      reasonGroups: settings.showExplanation ? ['COMPATIBILITY', 'PURPOSE', 'ALMANAC'].map(category => ({ category,
        reasons: result.reasons.filter(reason => snapshot.rules.some(rule => rule.code === reason.code && rule.category === category)) })) : [],
      goodHours: settings.showGoodHours ? result.almanac.goodHours : [], disclaimer: settings.disclaimer, ctaLabel: settings.ctaLabel, rulesetVersion: snapshot.set.version };
  }
}
