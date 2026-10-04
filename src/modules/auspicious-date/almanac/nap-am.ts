import type { Element } from './relations.js';
const table: readonly [string, Element][] = [
  ['Hải trung kim', 'METAL'], ['Lư trung hỏa', 'FIRE'], ['Đại lâm mộc', 'WOOD'], ['Lộ bàng thổ', 'EARTH'],
  ['Kiếm phong kim', 'METAL'], ['Sơn đầu hỏa', 'FIRE'], ['Giản hạ thủy', 'WATER'], ['Thành đầu thổ', 'EARTH'],
  ['Bạch lạp kim', 'METAL'], ['Dương liễu mộc', 'WOOD'], ['Tuyền trung thủy', 'WATER'], ['Ốc thượng thổ', 'EARTH'],
  ['Tích lịch hỏa', 'FIRE'], ['Tùng bách mộc', 'WOOD'], ['Trường lưu thủy', 'WATER'], ['Sa trung kim', 'METAL'],
  ['Sơn hạ hỏa', 'FIRE'], ['Bình địa mộc', 'WOOD'], ['Bích thượng thổ', 'EARTH'], ['Kim bạc kim', 'METAL'],
  ['Phú đăng hỏa', 'FIRE'], ['Thiên hà thủy', 'WATER'], ['Đại trạch thổ', 'EARTH'], ['Thoa xuyến kim', 'METAL'],
  ['Tang đố mộc', 'WOOD'], ['Đại khê thủy', 'WATER'], ['Sa trung thổ', 'EARTH'], ['Thiên thượng hỏa', 'FIRE'],
  ['Thạch lựu mộc', 'WOOD'], ['Đại hải thủy', 'WATER'],
];
export function napAm(cycle: number) {
  if (!Number.isInteger(cycle) || cycle < 0 || cycle > 59) throw new RangeError('Chu kỳ Can Chi không hợp lệ.');
  const [label, element] = table[Math.floor(cycle / 2)];
  return { label, element };
}
