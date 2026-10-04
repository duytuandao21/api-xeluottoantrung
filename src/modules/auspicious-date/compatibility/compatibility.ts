import { calendar, type CalendarData } from '../calendar/calendar.js';
import { branchRelations, elementRelation } from '../almanac/relations.js';
import { napAm } from '../almanac/nap-am.js';
export function birthProfile(birthDate: string) { const data = calendar(birthDate); return { year: data.canChi.year, napAm: napAm(data.canChi.year.cycle) }; }
export function compatibility(profile: ReturnType<typeof birthProfile>, target: CalendarData) {
  return { relations: branchRelations(profile.year.branch, target.canChi.day.branch),
    element: elementRelation(napAm(target.canChi.day.cycle).element, profile.napAm.element) };
}
