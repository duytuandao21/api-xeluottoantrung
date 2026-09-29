export type RangeGroup = 'budget' | 'year' | 'mileage';
export type FilterRange = { min?: number; max?: number };
export type RangeOption = { name: string; minValue?: number | null; maxValue?: number | null };

export function parseRangeQuery(value?: string): FilterRange | undefined {
  const match = value?.match(/^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  const min = match[1] ? Number(match[1]) : undefined;
  const max = match[2] ? Number(match[2]) : undefined;
  return min !== undefined && max !== undefined && min > max ? undefined : { min, max };
}

// Older admin records only have a label. Prefer explicit bounds when present;
// otherwise interpret the displayed label, never the slug (which stays unchanged after renaming).
// Budget bounds use millions of VND, matching the public range inputs.
export function optionRange(option: RangeOption, group: RangeGroup): FilterRange | undefined {
  let result: FilterRange;
  if (option.minValue != null || option.maxValue != null) {
    result = { min: option.minValue ?? undefined, max: option.maxValue ?? undefined };
  } else {
    const label = option.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const tokens = [...label.matchAll(/(\d+(?:[.,]\d+)*)\s*(ty|trieu|km)?/g)];
    if (!tokens.length || tokens.length > 2) return undefined;
    const sharedUnit = tokens.at(-1)?.[2];
    const values = tokens.map(token => {
      const raw = token[1];
      const number = Number(/^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? raw.replace(/[.,]/g, '') : raw.replace(',', '.'));
      return number * (group === 'budget' && (token[2] || sharedUnit) === 'ty' ? 1000 : 1);
    });
    if (values.length === 2) result = { min: values[0], max: values[1] };
    else if (/duoi|den|toi da/.test(label)) result = { min: group === 'year' ? undefined : 0, max: values[0] };
    else if (/tren|tu|toi thieu/.test(label)) result = { min: values[0] };
    else result = { min: values[0], max: values[0] };
  }
  const bounds = [result.min, result.max].filter((value): value is number => value !== undefined);
  if (bounds.some(value => !Number.isFinite(value) || value < 0 || (group !== 'budget' && !Number.isInteger(value)) ||
    (group === 'year' && (value < 1886 || value > 2100)))) return undefined;
  return result.min !== undefined && result.max !== undefined && result.min > result.max ? undefined : result;
}
