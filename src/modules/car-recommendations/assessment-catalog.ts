import { DEFAULT_RECOMMENDATION_CONFIG } from './defaults.js';
import { ENVIRONMENTS, PRIORITIES, PURPOSES } from './domain.js';
const bases: Record<string, string> = {
  purposes: 'Đối chiếu khả năng sử dụng thực tế của đúng xe với mục đích này; ghi tài liệu hoặc kết quả kiểm tra.',
  environment: 'Đối chiếu kích thước, trang bị và khả năng vận hành đã kiểm tra với môi trường sử dụng.',
  priorities: 'Ghi căn cứ của đúng xe: trang bị, số liệu đo/kiểm tra hoặc nguồn dữ liệu có thể đối chiếu. Không suy từ hãng.',
};
export const ASSESSMENT_CATALOG = Object.entries({ purposes: PURPOSES, environment: ENVIRONMENTS, priorities: PRIORITIES }).flatMap(([group, codes]) => codes.map(code => ({
  key: `${group}.${code}`, group, label: DEFAULT_RECOMMENDATION_CONFIG.questions.find(q => q.key === group)?.options.find(o => o.key === code)?.label || code,
  guidance: code === 'safety' ? 'Dùng trang bị an toàn/tài liệu đúng xe và tình trạng đã kiểm tra, không cam kết an toàn tuyệt đối.'
    : code === 'resale' ? 'Cần dữ liệu giá giao dịch/thị trường có ngày và phạm vi tương đồng; thiếu dữ liệu để chưa rõ.'
      : code === 'economy' || code === 'low_cost' ? 'Cần số liệu tiêu hao/chi phí có nguồn và điều kiện sử dụng; không suy từ nhiên liệu hoặc hãng.' : bases[group],
})));
