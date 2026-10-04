import { almanac } from '../almanac/almanac.js';
import { calendar } from '../calendar/calendar.js';
import { birthProfile, compatibility } from '../compatibility/compatibility.js';
import type { Explanation, Purpose, RuleDefinition, RuleResult } from '../domain.js';
import { registry } from './registry.js';
import { scoreAndClassify } from './scoring.js';

export interface ContentDefinition { ruleId: string; title: string; shortDescription: string; detailDescription: string }
export function evaluate(date: string, profile: ReturnType<typeof birthProfile>, purpose: Purpose, rules: RuleDefinition[], contents: ContentDefinition[]) {
  const data = calendar(date), attributes = almanac(data), personal = compatibility(profile, data);
  const context = { calendar: data, almanac: attributes, compatibility: personal, purpose };
  const trace: RuleResult[] = [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)).map(rule => {
    const handler = registry[rule.engineHandler];
    const match = rule.isEnabled && handler ? handler(context, rule.parameters) : null;
    return { code: rule.code, matched: match?.matched ?? false,
      status: !match ? 'NOT_APPLICABLE' : match.matched ? 'MATCH' : 'PASS', effect: rule.effect, priority: rule.priority,
      scoreDelta: match?.matched ? (rule.effect === 'NEGATIVE' ? -rule.weight : rule.effect === 'POSITIVE' ? rule.weight : 0) : 0,
      hardExclusion: Boolean(match?.matched && rule.hardExclusion), metadata: match?.metadata ?? {} };
  });
  const reasons: Explanation[] = trace.filter(rule => rule.matched).map(rule => {
    const definition = rules.find(item => item.code === rule.code)!;
    const content = contents.find(item => item.ruleId === definition.id);
    return { code: rule.code, effect: rule.effect, priority: rule.priority, title: content?.title ?? rule.code,
      shortDescription: content?.shortDescription ?? '', detailDescription: content?.detailDescription ?? '' };
  });
  return { date, ...scoreAndClassify(trace), calendar: data, almanac: attributes, reasons, trace };
}
export type Evaluation = ReturnType<typeof evaluate>;
