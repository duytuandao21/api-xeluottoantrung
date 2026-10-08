import type { Candidate, ComponentScore, Criteria, Group, RankedCar, RecommendationConfig, TechnicalKey } from './domain.js';
export function technicalValue(car: Candidate, key: TechnicalKey): string | null {
  return key === 'brand' ? car.brand.slug : key === 'fuel' ? car.fuel : key === 'bodyStyle' ? car.bodyStyle.slug : car.transmission.slug;
}
export function passesHardFilters(car: Candidate, criteria: Criteria): boolean {
  return Number.isSafeInteger(car.price) && car.price > 0 && car.price <= criteria.budgetMax &&
    (criteria.minimumSeats === null || car.seatCount !== null && car.seatCount >= criteria.minimumSeats) &&
    criteria.requiredTechnical.every(key => technicalValue(car, key) === criteria.technical[key]);
}
export function rankCars(candidates: Candidate[], criteria: Criteria, config: RecommendationConfig): RankedCar[] {
  const label = (question: string, key: string) => config.questions.find(q => q.key === question)?.options.find(o => o.key === key)?.label || key;
  const tech = Object.entries(criteria.technical) as [TechnicalKey, string][];
  const weights = { ...config.weights, technical: tech.length ? config.weights.technical : 0 };
  const denominator = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const distinct = [...new Map(candidates.map(car => [car.id, car])).values()];
  const scored = distinct.filter(car => passesHardFilters(car, criteria)).map(car => {
    const components: ComponentScore[] = [], reasons: string[] = [], matchedFactors: RankedCar['matchedFactors'] = [];
    const add = (key: Group, score: number, coverage: number) => components.push({ key, score, coverage, weight: weights[key] });
    const reason = (key: string, text: string) => { reasons.push(text); matchedFactors.push({ key, label: text }); };
    add('budget', car.price >= criteria.budgetMin ? 100 : 80, 1);
    reason('budget', car.price >= criteria.budgetMin ? 'Giá niêm yết nằm trong khoảng ngân sách bạn chọn.' : 'Giá niêm yết thấp hơn khoảng bạn chọn và không vượt mức tối đa.');
    add('seats', car.seatCount === null ? 0 : Math.min(100, car.seatCount / criteria.preferredSeats * 100), car.seatCount === null ? 0 : 1);
    if (car.seatCount !== null && car.seatCount >= criteria.preferredSeats) reason('seats', `${car.seatCount} chỗ, đáp ứng nhóm ${criteria.preferredSeats} người bạn chọn.`);
    const assessments = (group: Group, selected: string[], multipliers: number[]) => {
      let numerator = 0, known = 0;
      const total = multipliers.reduce((sum, value) => sum + value, 0);
      selected.forEach((code, index) => {
        const assessment = car.assessments?.[`${group}.${code}`];
        if (!assessment || !Number.isInteger(assessment.score) || assessment.score < 1 || assessment.score > 5 || typeof assessment.source !== 'string' || assessment.source.trim().length < 3) return;
        const score = (assessment.score - 1) * 25;
        numerator += score * multipliers[index]; known += multipliers[index];
        if (score >= 75) reason(`${group}.${code}`, `Có đánh giá có nguồn phù hợp với ${label(group, code).toLocaleLowerCase('vi-VN')}.`);
      });
      add(group, known ? numerator / known : 0, total ? known / total : 0);
    };
    assessments('purposes', criteria.purposes, criteria.purposes.map(() => 1));
    assessments('environment', [criteria.environment], [1]);
    assessments('priorities', criteria.priorities, criteria.priorities.map((_, index) => 3 - index));
    let knownTechnical = 0, technicalMatches = 0;
    for (const [key, selected] of tech) {
      const value = technicalValue(car, key);
      if (value !== null) knownTechnical++;
      if (value === selected) {
        technicalMatches++;
        const detail = key === 'brand' ? car.brand.name : key === 'fuel' ? car.fuel : key === 'bodyStyle' ? car.bodyStyle.name : car.transmission.name;
        reason(`technical.${key}`, `Đúng lựa chọn ${detail} của bạn.`);
      }
    }
    add('technical', knownTechnical ? technicalMatches / knownTechnical * 100 : 0, tech.length ? knownTechnical / tech.length : 0);
    const caveats: string[] = [];
    if (components.some(c => c.weight > 0 && c.coverage < 1)) caveats.push('Đánh giá còn hạn chế: một số tiêu chí chưa có dữ liệu hoặc đánh giá có nguồn.');
    if (car.seatCount === null) caveats.push('Chưa có thông tin số ghế.');
    else if (car.seatCount < criteria.preferredSeats) caveats.push(`Xe có ${car.seatCount} chỗ, ít hơn nhóm người bạn chọn; yêu cầu số ghế chưa được đánh dấu bắt buộc.`);
    if (tech.some(([key, selected]) => technicalValue(car, key) !== selected)) caveats.push('Chưa khớp đầy đủ sở thích kỹ thuật không bắt buộc.');
    const { assessments: _private, ...publicCar } = car;
    void _private;
    return { car: publicCar, score: Math.round(components.reduce((sum, c) => sum + c.weight * c.score * c.coverage, 0) / denominator),
      coverage: Math.round(components.reduce((sum, c) => sum + c.weight * c.coverage, 0) / denominator * 100),
      reasons: reasons.slice(0, 4), matchedFactors: matchedFactors.slice(0, 4), caveats, components };
  });
  return scored.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.car.price - b.car.price || b.car.year - a.car.year || (a.car.id < b.car.id ? -1 : a.car.id > b.car.id ? 1 : 0)).slice(0, config.maxResults);
}
