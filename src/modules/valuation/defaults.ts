import type { OptionCategory, PolicyConfig } from './domain.js';
// Draft examples only. These are not verified market prices or a published buying policy.
export const DEFAULT_CONFIG: PolicyConfig = {
  expectedKmPerYear: 15000, youngVehicleAgeFloor: 0.5, odoMaxBonusPercent: 2, odoMaxPenaltyPercent: 10,
  minValueFactor: 0.15, maxValueFactor: 1.25, marketRangeMinusPercent: 3, marketRangePlusPercent: 3,
  dealerMarginMinPercent: 4, dealerMarginMaxPercent: 7, roundingVnd: 1000000,
  minModelYear: 1980, maxVehicleAge: 50, maxOdometerKm: 2000000, mediumConfidenceThreshold: 50, highConfidenceThreshold: 80,
  confidenceWeights: { odo: 15, exterior: 8, interior: 8, accident: 15, flood: 15, engine: 8, transmission: 8, service: 8, owners: 5, usage: 7, color: 3 },
  showSeverePriceRange: false,
};
export const DEFAULT_DISCLAIMER = 'Mức giá trên là giá tham khảo được tính từ thông tin bạn cung cấp và dữ liệu cấu hình hiện tại. Giá thu mua thực tế có thể thay đổi sau khi Toàn Trung kiểm tra trực tiếp tình trạng xe, giấy tờ và thị trường tại thời điểm giao dịch.';
type Example = [code: string, label: string, percent: number, inspection?: boolean];
export const OPTION_EXAMPLES: Record<OptionCategory, Example[]> = {
  EXTERIOR: [['ORIGINAL', 'Nguyên bản / rất tốt', 0], ['SCRATCHES', 'Trầy xước nhẹ', -1], ['REPAINT_1_2', 'Sơn lại 1–2 chi tiết', -2], ['REPAINT_3_5', 'Sơn lại 3–5 chi tiết', -4], ['REPAINT_MORE', 'Sơn lại hơn 5 chi tiết', -6], ['FULL_REPAINT', 'Sơn lại toàn bộ', -8], ['DAMAGE', 'Móp / hư hỏng', -10]],
  INTERIOR: [['EXCELLENT', 'Rất tốt', 1], ['GOOD', 'Tốt', 0], ['NORMAL', 'Hao mòn bình thường', -1], ['HEAVY_WEAR', 'Hao mòn nhiều', -4], ['DAMAGED', 'Hư hỏng', -8]],
  ACCIDENT: [['NONE', 'Không tai nạn', 0], ['LIGHT', 'Va chạm nhẹ / bên ngoài', -3], ['PANELS', 'Thay chi tiết bên ngoài', -5], ['STRUCTURAL', 'Ảnh hưởng kết cấu thân xe', -15, true], ['PILLAR', 'Ảnh hưởng trụ / khung', -20, true], ['CHASSIS', 'Hư hỏng chassis', -30, true]],
  FLOOD: [['NONE', 'Không ngập nước', 0], ['FLOOR', 'Ngập sàn', -10, true], ['SEVERE', 'Ngập nặng', -25, true], ['HYDROLOCK', 'Ngập máy / thủy kích', -35, true]],
  ENGINE: [['EXCELLENT', 'Rất tốt', 1], ['NORMAL', 'Bình thường', 0], ['MINOR', 'Cần bảo dưỡng nhẹ', -2], ['WARNING', 'Có cảnh báo / lỗi', -8, true], ['MAJOR', 'Cần sửa chữa lớn', -15, true]],
  TRANSMISSION: [['EXCELLENT', 'Rất tốt', 1], ['NORMAL', 'Bình thường', 0], ['MINOR', 'Cần bảo dưỡng nhẹ', -2], ['WARNING', 'Có cảnh báo / lỗi', -8, true], ['MAJOR', 'Cần sửa chữa lớn', -15, true]],
  SERVICE: [['FULL', 'Đầy đủ lịch sử bảo dưỡng hãng', 2], ['PARTIAL', 'Có một phần lịch sử', 0], ['NONE', 'Không có lịch sử', -2], ['INCONSISTENT', 'ODO / lịch sử bất nhất', -5, true]],
  USAGE: [['PERSONAL', 'Cá nhân', 0], ['COMPANY', 'Công ty', -1], ['SERVICE', 'Dịch vụ', -4], ['RIDE_HAILING', 'Xe công nghệ', -5], ['TAXI', 'Taxi', -8], ['RENTAL', 'Cho thuê', -5]],
};
export const RANGE_EXAMPLES = [
  ...[-8, -12, -18, -24, -30, -35, -40, -44, -48, -52, -55].map((percent, age) => ({ category: 'AGE' as const, minValue: age, maxValue: age === 10 ? null : age + 1, adjustmentPercent: percent, label: age === 10 ? 'Từ 10 năm' : `${age} đến dưới ${age + 1} năm` })),
  ...[[-100, -30, 2], [-30, -10, 1], [-10, 10, 0], [10, 30, -2], [30, 50, -4], [50, 100, -7], [100, null, -10]].map(([min, max, percent]) => ({ category: 'ODO' as const, minValue: min!, maxValue: max, adjustmentPercent: percent!, label: `Lệch ODO ${min}% đến ${max === null ? 'không giới hạn' : `dưới ${max}%`}` })),
  ...[[1, 2, 1], [2, 3, 0], [3, 4, -1], [4, null, -2]].map(([min, max, percent]) => ({ category: 'OWNERS' as const, minValue: min!, maxValue: max, adjustmentPercent: percent!, label: `${min} chủ${max === null ? ' trở lên' : ''}` })),
];
