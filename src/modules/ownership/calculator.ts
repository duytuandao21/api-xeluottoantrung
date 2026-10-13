import type { Answers, Calculation, Fuel, Profile, Resolved, SettingsConfig, Vehicle } from './domain.js';
import { numberIn, validateAnswers, validatePolicy } from './validation.js';
export function money(value: number) {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) throw new Error('Chi phí vượt giới hạn tính toán.');
  return rounded;
}
export function normalizeFuel(value: string | null): Fuel | null {
  const text = (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  if (/^(dien|electric|ev|bev)$/.test(text)) return 'electric';
  if (/^(dau|diesel)$/.test(text)) return 'diesel';
  if (/^(xang|gasoline|petrol|hybrid|xang.?dien|phev)$/.test(text)) return 'gasoline';
  return null;
}
export function resolvePolicy(car: Vehicle, config: SettingsConfig, profiles: Profile[]): Resolved {
  const knownFuel = normalizeFuel(car.fuel), fuel = knownFuel || config.defaultFuel;
  const targets = { car: car.id, version: car.versionId, model: car.modelId, body: car.bodyStyleId, fuel };
  const profile = (['car', 'version', 'model', 'body', 'fuel'] as const).map(scope => profiles.find(p => p.scope === scope && p.target === targets[scope])).find(Boolean) || null;
  const assumptions = ['Các định mức là dự toán do Toàn Trung cấu hình, không phải số đo hay báo giá được bảo đảm.'];
  if (!profile || !['car', 'version'].includes(profile.scope)) assumptions.push('Tiêu hao ước tính từ định mức dòng/nhóm/nhiên liệu hoặc mặc định; chưa có định mức riêng cho xe/phiên bản.');
  if (!knownFuel) assumptions.push(`Nhiên liệu chưa xác định; ước tính theo mặc định ${fuel === 'electric' ? 'điện' : fuel === 'diesel' ? 'dầu' : 'xăng'} do admin chọn.`);
  if (/hybrid|phev|xăng.?điện/i.test(car.fuel || '')) assumptions.push('Xe hybrid được ước tính bằng ngân sách xăng; mức sạc ngoài chưa được mô hình hóa riêng.');
  if (car.mileage === null) assumptions.push(`ODO chưa cập nhật; dùng ODO dự phòng ${config.fallbackOdo.toLocaleString('vi-VN')} km (ước tính).`);
  const policy = profile?.policy || config.policy; validatePolicy(policy);
  if (policy.maintenanceMode === 'aggregate') assumptions.push('Bảo dưỡng là ngân sách dự phòng theo km và năm, không cộng thêm lịch thay dầu/lốp riêng.');
  else assumptions.push('Lịch bảo dưỡng lấy mốc km kế tiếp sau ODO hiện tại; chu kỳ thời gian tính từ lúc mua vì chưa có lịch sử bảo dưỡng. Khi có cả km và tháng, tính mốc đến trước và đặt lại chu kỳ, không cộng hai lần.');
  if (fuel === 'electric') assumptions.push(`Hao hụt sạc: cộng ${(policy.chargingLoss * 100).toFixed(1)}% trên điện tiêu thụ của xe; chưa bao gồm gói thuê pin.`);
  return { fuel, odo: car.mileage ?? config.fallbackOdo, policy, profile: profile ? { id: profile.id, name: profile.name, scope: profile.scope } : null, assumptions };
}
export function loanSchedule(principal: number, months: number, annualRate: number) {
  if (!numberIn(principal, 0, 100000000000, true) || !numberIn(months, 1, 240, true) || !numberIn(annualRate, 0, 40)) throw new Error('Khoản vay không hợp lệ.');
  const r = annualRate / 1200;
  const payment = principal === 0 ? 0 : money(r === 0 ? principal / months : principal * r / -Math.expm1(-months * Math.log1p(r)));
  let balance = principal;
  const schedule = Array.from({ length: months }, (_, index) => {
    const interest = money(balance * r), paidPrincipal = index === months - 1 ? balance : Math.min(balance, Math.max(0, payment - interest));
    balance -= paidPrincipal;
    return { month: index + 1, principal: paidPrincipal, interest, payment: paidPrincipal + interest, balance };
  });
  return { payment, schedule };
}
/** Pure calculation: same monthly ledger powers breakdown, TCO and every chart point. */
export function calculateOwnership(car: Vehicle, answers: Answers, config: SettingsConfig, resolved: Resolved, currentYear: number): Calculation {
  validateAnswers(answers, config); validatePolicy(resolved.policy);
  if (!numberIn(car.price, 1, 100000000000, true) || !numberIn(car.year, 1886, currentYear + 1, true) || !numberIn(resolved.odo, 0, 2000000, true)) throw new Error('Giá, năm sản xuất hoặc ODO chưa đủ điều kiện để dự toán.');
  const p = resolved.policy, months = answers.years * 12, horizon = Math.max(120, months), age = Math.max(0, currentYear - car.year);
  const consumption = p.consumption[resolved.fuel] * p.factors[answers.driving];
  const energy = money(answers.monthlyKm / 100 * consumption * (resolved.fuel === 'electric' ? 1 + p.chargingLoss : 1) * answers.energyPrice);
  const fees = config.fees.filter(f => (f.fuel === 'any' || f.fuel === resolved.fuel) && (!f.bodyId || f.bodyId === car.bodyStyleId) && (!f.region || f.region === answers.region) && (!f.transaction || f.transaction === answers.transaction)
    && (f.kind !== 'comprehensive' || answers.insurance === 'comprehensive') && (f.kind !== 'finance' || answers.financed))
    .map(f => ({ name: f.name, kind: f.kind, amount: money(f.amount + car.price * f.pricePct / 100) }));
  const initialFees = money(fees.filter(f => f.kind === 'initial').reduce((sum, f) => sum + f.amount, 0)), financeFees = money(fees.filter(f => f.kind === 'finance').reduce((sum, f) => sum + f.amount, 0));
  const annualFees = money(fees.filter(f => ['annual', 'mandatory', 'comprehensive'].includes(f.kind)).reduce((sum, f) => sum + f.amount, 0));
  const maintenanceLedger = Array<number>(horizon).fill(0), events: Calculation['maintenanceEvents'] = []; let eventCount = 0;
  if (p.maintenanceMode === 'scheduled') for (const item of p.maintenance) {
    let nextOdo = item.everyKm === null ? Infinity : (Math.floor(resolved.odo / item.everyKm) + 1) * item.everyKm;
    let nextTime = item.everyMonths ?? Infinity;
    while (true) {
      const kmDue = answers.monthlyKm === 0 ? Infinity : (nextOdo - resolved.odo) / answers.monthlyKm;
      const due = Math.min(kmDue, nextTime);
      if (!Number.isFinite(due) || due > horizon) break;
      const month = Math.max(1, Math.ceil(due - 1e-9)), odo = resolved.odo + due * answers.monthlyKm;
      maintenanceLedger[month - 1] += item.amount;
      if (month <= months) { eventCount++; if (events.length < 120) events.push({ month, odo: Math.round(odo), name: item.name, amount: item.amount }); }
      nextOdo = item.everyKm === null ? Infinity : odo + item.everyKm;
      nextTime = item.everyMonths === null ? Infinity : due + item.everyMonths;
    }
  }
  const annualPart = (annual: number, index: number) => Math.floor(annual / 12) + (index % 12 < annual % 12 ? 1 : 0);
  const ledgers = {
    energy: Array<number>(horizon).fill(energy), parking: Array<number>(horizon).fill(answers.parking), wash: Array<number>(horizon).fill(answers.wash), toll: Array<number>(horizon).fill(answers.toll),
    insurance: Array.from({ length: horizon }, (_, i) => annualPart(annualFees, i)),
    maintenance: p.maintenanceMode === 'scheduled' ? maintenanceLedger : Array.from({ length: horizon }, (_, i) => money(answers.monthlyKm * p.maintenancePerKm) + annualPart(p.maintenanceAnnual, i)),
    repair: Array.from({ length: horizon }, (_, i) => annualPart(money(p.repairAnnual * (1 + p.repairAgeFactor * (age + Math.floor(i / 12)) + p.repairOdoFactor * (resolved.odo + answers.monthlyKm * Math.floor(i / 12) * 12) / 100000)), i)),
  };
  const labels = { energy: resolved.fuel === 'electric' ? 'Điện sạc' : 'Nhiên liệu', parking: 'Gửi xe', wash: 'Rửa xe', toll: 'Cầu đường / đỗ phát sinh', insurance: 'Bảo hiểm & phí định kỳ', maintenance: 'Bảo dưỡng / hao mòn', repair: 'Dự phòng sửa chữa' };
  const breakdown = Object.entries(ledgers).map(([key, values]) => { const total = money(values.slice(0, months).reduce((s, v) => s + v, 0)); return { key, label: labels[key as keyof typeof labels], total, monthly: money(total / months), annual: money(total / answers.years) }; });
  const operatingTotal = money(breakdown.reduce((s, row) => s + row.total, 0)), operatingMonthly = money(breakdown.reduce((s, row) => s + row.monthly, 0)), operatingAnnual = money(breakdown.reduce((s, row) => s + row.annual, 0));
  const downPayment = answers.financed ? money(car.price * answers.downPct! / 100) : car.price;
  const principal = car.price - downPayment, loan = answers.financed ? loanSchedule(principal, answers.termMonths!, answers.annualRate!) : null;
  const interestAt = (n: number) => money(loan?.schedule.slice(0, n).reduce((s, row) => s + row.interest, 0) || 0);
  const resaleAt = (years: number) => {
    let retained = 1;
    for (let y = 0; y < years; y++) {
      const rate = Math.min(0.9, p.depreciationAnnualPct / 100 * (1 + p.depreciationAgeFactor * (age + y) + p.depreciationOdoFactor * (resolved.odo + answers.monthlyKm * 12 * y) / 100000));
      retained *= 1 - rate;
    }
    return money(Math.min(car.price, Math.max(car.price * p.residualFloorPct / 100, car.price * retained)));
  };
  const operatingAt = (n: number) => money(Object.values(ledgers).reduce((s, rows) => s + rows.slice(0, n).reduce((a, v) => a + v, 0), 0));
  const resale = resaleAt(answers.years), interest = interestAt(months), remainingPrincipal = loan && months < loan.schedule.length ? loan.schedule[months - 1].balance : 0;
  const tco = money(car.price + initialFees + operatingTotal + interest + financeFees - resale);
  const financing = loan ? { downPayment, principal, monthlyPayment: loan.payment, interest, remainingPrincipal, paidPrincipal: principal - remainingPrincipal, payments: Math.min(months, loan.schedule.length) } : null;
  const explanations = [
    `Vận hành là ngân sách bình quân trong ${answers.years} năm, gồm bảo dưỡng và dự phòng; số chi từng tháng có thể khác.`,
    'TCO = giá mua + phí ban đầu + vận hành + lãi vay/phí tài chính − giá bán lại. Gốc vay và khấu hao không cộng thêm vào dòng tiền vận hành.',
    ...(loan ? ['Khoản vay giả định trả đều, lãi suất danh nghĩa cố định trên dư nợ giảm dần; không phải báo giá ngân hàng. Dòng tiền tháng hiển thị trong thời gian còn trả góp.', ...(remainingPrincipal ? ['Khi bán trước khi hết khoản vay, phải trả dư nợ; tiền bán ròng đã trừ khoản này (có thể âm). Chưa tính phí tất toán trước hạn nếu admin chưa cấu hình.'] : [])] : []),
    ...(!fees.some(f => f.kind === 'initial') ? ['Chưa có phí giao dịch ban đầu phù hợp: tạm chưa cộng; hãy xác nhận chi phí sang tên/đăng ký thực tế với tư vấn viên.'] : []),
    ...(answers.monthlyKm === 0 ? ['Không di chuyển nên nhiên liệu bằng 0; phí theo năm và bảo dưỡng theo thời gian vẫn có thể phát sinh.'] : []),
    ...resolved.assumptions,
  ];
  return { vehicle: car, answers, resolved, consumption, energyUnit: resolved.fuel === 'electric' ? 'kWh' : 'lít', months,
    operatingMonthly, operatingAnnual, operatingTotal, cashMonthly: operatingMonthly + (loan?.payment || 0), initialCash: downPayment + initialFees + financeFees,
    initialFees, financeFees, tco, resale, netResale: resale - remainingPrincipal, depreciation: car.price - resale, breakdown, feeDetails: fees,
    maintenanceEvents: events.sort((a, b) => a.month - b.month), maintenanceEventCount: eventCount, financing,
    series: [...new Set([1, 3, 5, 7, 10, answers.years])].sort((a, b) => a - b).map(years => { const operating = operatingAt(years * 12), resale = resaleAt(years); return { years, operating, resale, tco: money(car.price + initialFees + operating + interestAt(years * 12) + financeFees - resale) }; }), explanations };
}
