import { INITIAL_RULES } from './defaults.js';
import type { Classification, Handler, Purpose, ReferenceExpectation, RuleDefinition } from './domain.js';

// Curated factual tables, not generated from evaluate()/simulate().
// See docs/auspicious-date/09-activation.md for provenance and manual score worksheet.
export const ACTIVATION_VERSION = '1.1.0';
export const ACTIVATION_NAME = 'Toàn Trung - lịch tham khảo 2026.10';
export const PURPOSE_OFFICERS: Record<Purpose, number[]> = {
  BUY_CAR: [2], RECEIVE_CAR: [0, 8], SIGN_CONTRACT: [2, 4],
};
const dailyUrl = (day: number) => `https://lichngaytot.com/xem-ngay-tot-xau-${String(day).padStart(2, '0')}-10-2026`;
const transactionUrl = 'https://www.shidianguji.com/book/SK1619/chapter/1l9llrr8p9fkz';
export interface ActivationSource { title: string; author: string; publisher: string; url: string; pageReference: string; note: string }
const source = (title: string, url: string, pageReference: string, note: string): ActivationSource => ({ title, url, pageReference, note, author: 'Ban biên tập Lịch ngày Tốt', publisher: 'Lichngaytot.com' });
export function activationSources(handler: Handler, purpose: Purpose): ActivationSource[] {
  const checked = 'Đối chiếu kỹ thuật ngày 03/10/2026 theo yêu cầu chủ website. VERIFIED xác nhận nội dung nguồn khớp quy tắc; không xác nhận khả năng dự báo hoặc bảo đảm an toàn/tài lộc. ';
  if (handler === 'DIRECT_AGE_CONFLICT' || handler === 'BRANCH_HARMONY') return [source('Quan hệ địa chi ngày: xung, lục hợp, nhóm tam hợp', dailyUrl(1), 'Ngũ hành; quan hệ địa chi Thân', checked + 'Thân đối xung Dần, lục hợp Tỵ, cùng nhóm tam hợp Tý/Thìn. Các trang ngày 02–12/10/2026 đối chiếu các chi còn lại. Áp dụng cặp chi ngày và năm sinh là tiêu chí tham khảo của tiện ích, không phải luận giải đủ lá số.')];
  if (handler === 'TRADITIONAL_TABOO') return [source('Danh sách ngày Tam nương và Nguyệt kỵ', 'https://lichngaytot.com/tu-vi/ngay-tam-nuong-la-ngay-gi-304-188097.html', 'Mục 2: danh sách ngày âm lịch', checked + 'Chỉ dùng các ngày Tam nương 3/7/13/18/22/27 và Nguyệt kỵ 5/14/23; không sử dụng các giải thích hay khẳng định nhân quả trong bài.')];
  if (handler === 'AUSPICIOUS_DAY') return [source('Đối chiếu ngày hoàng đạo theo tháng âm lịch', dailyUrl(2), 'Lịch âm dương; nhãn ngày hoàng đạo', checked + 'Đối chiếu lịch ngày 01–12/10/2026: tháng âm 8 sang 9. Hoàng đạo là một tiêu chí độc lập, không thay thế quy tắc loại trừ và mục đích.')];
  if (handler === 'GOOD_HOURS') return [source('Đối chiếu sáu bảng giờ hoàng đạo theo địa chi ngày', dailyUrl(1), 'Giờ Hoàng đạo; các trang ngày 01–06/10/2026', checked + 'Sáu trang tương ứng Thân/Dậu/Tuất/Hợi/Tý/Sửu bao phủ sáu bảng giờ. Ca tham chiếu kiểm tra đủ danh sách chi giờ và thứ tự; kiểm thử kiểm tra cả khoảng giờ. Không diễn giải đây là giờ bảo đảm an toàn.')];
  if (handler === 'PURPOSE_OFFICER') {
    if (purpose === 'RECEIVE_CAR') return [source('Trực Kiến và Thành cho xuất hành', dailyUrl(2), 'Xem ngày theo trực; đối chiếu ngày 11/10/2026', checked + 'Nguồn ghi Kiến và Thành phù hợp xuất hành. Tiện ích áp dụng cho chuyến đi nhận xe, không khẳng định tài liệu cổ có mục nhận ô tô.')];
    const classical: ActivationSource = { title: 'Hiệp kỷ biện phương thư - Lập khoán giao dịch', author: 'Doãn Lộc, Mai Cốc Thành và cộng sự', publisher: 'Tứ khố toàn thư; bản số hóa Thức Điển Cổ Tịch', url: transactionUrl, pageReference: 'Lập khoán giao dịch (立劵交易): Mãn nhật', note: checked + 'Nguồn có Mãn nhật trong nhóm phù hợp lập khoán/giao dịch. BUY_CAR áp dụng giao dịch mua xe; SIGN_CONTRACT áp dụng lập hợp đồng. Đây là quy tắc tham khảo có phạm vi giới hạn, không phải tính toàn bộ thần sát của sách.' };
    return purpose === 'SIGN_CONTRACT' ? [classical, source('Trực Định cho ký hợp đồng', dailyUrl(6), 'Xem ngày theo trực: Định', checked + 'Nguồn ghi trực Định phù hợp ký hợp đồng. Bộ tham khảo chọn Mãn hoặc Định; không gán thêm các Trực chưa có nguồn.')] : [classical];
  }
  return [];
}
export function activationRules(purpose: Purpose): (Omit<RuleDefinition, 'id'> & { title: string; description: string })[] {
  return INITIAL_RULES.map(rule => ({ ...rule, isEnabled: rule.engineHandler !== 'FIVE_ELEMENT_RELATION',
    parameters: rule.engineHandler === 'PURPOSE_OFFICER' ? { officers: [...PURPOSE_OFFICERS[purpose]] } : {},
    description: rule.engineHandler === 'DIRECT_AGE_CONFLICT' ? 'Địa chi ngày đối xung với địa chi năm sinh âm lịch. Tiện ích ưu tiên tránh ngày này theo tiêu chí tham khảo.'
      : rule.engineHandler === 'TRADITIONAL_TABOO' ? 'Ngày âm lịch thuộc nhóm Tam nương hoặc Nguyệt kỵ theo danh sách dân gian đang áp dụng.'
      : rule.engineHandler === 'PURPOSE_OFFICER' ? purpose === 'BUY_CAR' ? 'Trực Mãn được dùng làm tiêu chí tham khảo cho giao dịch mua xe.' : purpose === 'SIGN_CONTRACT' ? 'Trực Mãn hoặc Định được dùng làm tiêu chí tham khảo khi ký hợp đồng.' : 'Trực Kiến hoặc Thành được dùng làm tiêu chí tham khảo cho chuyến đi nhận xe.'
      : rule.engineHandler === 'GOOD_HOURS' ? 'Sáu khung giờ hoàng đạo theo địa chi ngày, chỉ mang tính tham khảo; hãy ưu tiên lịch hẹn thực tế với cửa hàng.' : rule.description,
  }));
}

interface Fixture {
  day: number; lunarDay: number; lunarMonth: number; dayName: string; officer: number;
  auspicious: boolean; taboo: string[]; harmony: boolean; clash: boolean;
  classes: [Classification, Classification, Classification]; // BUY / RECEIVE / SIGN, hand checked.
  hours?: string[]; birthDate?: string;
}
export const ACTIVATION_FIXTURES: Fixture[] = [
  { day: 1, lunarDay: 21, lunarMonth: 8, dayName: 'Mậu Thân', officer: 11, auspicious: false, taboo: [], harmony: true, clash: false, classes: ['NORMAL','NORMAL','NORMAL'], hours: ['Tý','Sửu','Thìn','Tỵ','Mùi','Tuất'] },
  { day: 2, lunarDay: 22, lunarMonth: 8, dayName: 'Kỷ Dậu', officer: 0, auspicious: true, taboo: ['TAM_NUONG'], harmony: false, clash: false, classes: ['AVOID','AVOID','AVOID'], hours: ['Tý','Dần','Mão','Ngọ','Mùi','Dậu'] },
  { day: 3, lunarDay: 23, lunarMonth: 8, dayName: 'Canh Tuất', officer: 1, auspicious: false, taboo: ['NGUYET_KY'], harmony: false, clash: false, classes: ['AVOID','AVOID','AVOID'], hours: ['Dần','Thìn','Tỵ','Thân','Dậu','Hợi'] },
  { day: 4, lunarDay: 24, lunarMonth: 8, dayName: 'Tân Hợi', officer: 2, auspicious: false, taboo: [], harmony: false, clash: false, classes: ['GOOD','NORMAL','GOOD'], hours: ['Sửu','Thìn','Ngọ','Mùi','Tuất','Hợi'] },
  { day: 5, lunarDay: 25, lunarMonth: 8, dayName: 'Nhâm Tý', officer: 3, auspicious: true, taboo: [], harmony: false, clash: false, classes: ['GOOD','GOOD','GOOD'], hours: ['Tý','Sửu','Mão','Ngọ','Thân','Dậu'] },
  { day: 6, lunarDay: 26, lunarMonth: 8, dayName: 'Quý Sửu', officer: 4, auspicious: false, taboo: [], harmony: true, clash: false, classes: ['NORMAL','NORMAL','GOOD'], hours: ['Dần','Mão','Tỵ','Thân','Tuất','Hợi'] },
  { day: 7, lunarDay: 27, lunarMonth: 8, dayName: 'Giáp Dần', officer: 5, auspicious: true, taboo: ['TAM_NUONG'], harmony: false, clash: false, classes: ['AVOID','AVOID','AVOID'] },
  { day: 8, lunarDay: 28, lunarMonth: 8, dayName: 'Ất Mão', officer: 5, auspicious: true, taboo: [], harmony: false, clash: false, classes: ['GOOD','GOOD','GOOD'] },
  { day: 9, lunarDay: 29, lunarMonth: 8, dayName: 'Bính Thìn', officer: 6, auspicious: false, taboo: [], harmony: true, clash: false, classes: ['NORMAL','NORMAL','NORMAL'] },
  { day: 10, lunarDay: 1, lunarMonth: 9, dayName: 'Đinh Tỵ', officer: 7, auspicious: true, taboo: [], harmony: false, clash: false, classes: ['GOOD','GOOD','GOOD'] },
  { day: 11, lunarDay: 2, lunarMonth: 9, dayName: 'Mậu Ngọ', officer: 8, auspicious: false, taboo: [], harmony: false, clash: true, classes: ['AVOID','AVOID','AVOID'] },
  { day: 12, lunarDay: 3, lunarMonth: 9, dayName: 'Kỷ Mùi', officer: 9, auspicious: false, taboo: ['TAM_NUONG'], harmony: false, clash: false, classes: ['AVOID','AVOID','AVOID'] },
  { day: 16, lunarDay: 7, lunarMonth: 9, dayName: 'Quý Hợi', officer: 1, auspicious: true, taboo: ['TAM_NUONG'], harmony: true, clash: false, classes: ['AVOID','AVOID','AVOID'], birthDate: '1998-08-15' },
  { day: 28, lunarDay: 19, lunarMonth: 9, dayName: 'Ất Hợi', officer: 1, auspicious: true, taboo: [], harmony: true, clash: false, classes: ['GOOD','GOOD','GOOD'], birthDate: '1998-08-15' },
];
export function activationReferences(purpose: Purpose) {
  const purposeIndex = ({ BUY_CAR: 0, RECEIVE_CAR: 1, SIGN_CONTRACT: 2 } as const)[purpose];
  return ACTIVATION_FIXTURES.map(f => {
    const expected: ReferenceExpectation = {
      classification: f.classes[purposeIndex],
      calendar: { lunar: { day: f.lunarDay, month: f.lunarMonth, year: 2026, leap: false }, canChi: { day: { label: f.dayName }, year: { label: 'Bính Ngọ' }, month: { label: f.lunarMonth === 8 ? 'Đinh Dậu' : 'Mậu Tuất' } } },
      almanac: { officer: { index: f.officer }, auspicious: f.auspicious, tabooCodes: f.taboo, ...(f.hours ? { goodHours: f.hours.map(branch => ({ branch })) } : {}) },
      rules: [
        { code: 'DIRECT_AGE_CONFLICT', matched: f.clash }, { code: 'BRANCH_HARMONY', matched: f.harmony },
        { code: 'TRADITIONAL_TABOO', matched: f.taboo.length > 0 }, { code: 'AUSPICIOUS_DAY', matched: f.auspicious },
        { code: 'PURPOSE_OFFICER', matched: PURPOSE_OFFICERS[purpose].includes(f.officer) }, { code: 'GOOD_HOURS', matched: true },
        { code: 'FIVE_ELEMENT_RELATION', matched: false, status: 'NOT_APPLICABLE' },
      ],
    };
    return { name: `Đối chiếu 2026-10-${String(f.day).padStart(2, '0')} (${f.birthDate ? 'tuổi Dần' : 'tuổi Tý'})`,
      birthDate: f.birthDate ?? '1984-02-02', purpose, targetDate: `2026-10-${String(f.day).padStart(2, '0')}`, expected, isActive: true,
      sourceNote: `Dữ liệu lịch/Trực/giờ/địa chi nhập từ ${dailyUrl(f.day)}; ngày sinh minh họa công khai, không phải dữ liệu khách hàng. Kỳ vọng phân loại tính tay theo chính sách 50/+10/+15/-40; xem docs/auspicious-date/09-activation.md. Không lấy expected từ engine.` };
  });
}
