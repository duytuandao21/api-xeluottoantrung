import type { AlmanacData } from '../almanac/almanac.js';
import type { CalendarData } from '../calendar/calendar.js';
import type { compatibility } from '../compatibility/compatibility.js';
import type { Handler, Purpose, RuleParameters } from '../domain.js';
export interface RuleContext { calendar: CalendarData; almanac: AlmanacData; compatibility: ReturnType<typeof compatibility>; purpose: Purpose }
export interface MatchResult { matched: boolean; metadata: Record<string, unknown> }
type HandlerFn = (context: RuleContext, parameters: RuleParameters) => MatchResult;
export const registry: Record<Handler, HandlerFn> = {
  DIRECT_AGE_CONFLICT: context => ({ matched: context.compatibility.relations.includes('CLASH'), metadata: { relations: context.compatibility.relations } }),
  BRANCH_HARMONY: context => ({ matched: context.compatibility.relations.some(item => ['TRINE', 'SIX_HARMONY'].includes(item)), metadata: { relations: context.compatibility.relations } }),
  FIVE_ELEMENT_RELATION: context => ({ matched: ['GENERATES', 'SAME'].includes(context.compatibility.element), metadata: { relation: context.compatibility.element } }),
  TRADITIONAL_TABOO: context => ({ matched: context.almanac.tabooCodes.length > 0, metadata: { codes: context.almanac.tabooCodes } }),
  AUSPICIOUS_DAY: context => ({ matched: context.almanac.auspicious, metadata: {} }),
  PURPOSE_OFFICER: (context, parameters) => ({ matched: (parameters.officers ?? []).includes(context.almanac.officer.index), metadata: { officer: context.almanac.officer.label, purpose: context.purpose } }),
  GOOD_HOURS: context => ({ matched: context.almanac.goodHours.length > 0, metadata: { count: context.almanac.goodHours.length } }),
};
