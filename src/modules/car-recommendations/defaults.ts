import type { Question, RecommendationConfig } from './domain.js';
const choices = (entries: [string, string][]) => entries.map(([key, label]) => ({ key, label }));
const question = (key: string, title: string, type: Question['type'], options: [string, string][], required = true, maxSelections = 1, helpText = ''): Question => ({ key, title, description: '', type, required, enabled: true, maxSelections, helpText, options: choices(options) });
export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  weights: { budget: 25, purposes: 20, priorities: 25, environment: 10, seats: 10, technical: 10 }, minBudget: 0, maxBudget: 50000000000, maxResults: 5000,
  budgetPresets: [{ label: 'Dưới 300 triệu', min: 0, max: 300000000 }, { label: '300 – 500 triệu', min: 300000000, max: 500000000 }, { label: '500 – 800 triệu', min: 500000000, max: 800000000 }, { label: '800 triệu – 1 tỷ', min: 800000000, max: 1000000000 }, { label: '1 – 2 tỷ', min: 1000000000, max: 2000000000 }],
  questions: [
    question('purposes', 'Bạn mua xe để làm gì?', 'multi', [['commute', 'Đi làm hằng ngày'], ['family', 'Đưa đón gia đình'], ['travel', 'Đường dài / du lịch'], ['business', 'Phục vụ công việc'], ['service', 'Chạy dịch vụ'], ['rough_roads', 'Đi đường xấu'], ['personal', 'Sở thích cá nhân']], true, 2, 'Chọn tối đa 2 mục đích.'),
    question('budget', 'Ngân sách mua xe của bạn', 'budget', [], true, 1, 'Dùng giá xe niêm yết, chưa bao gồm chi phí lăn bánh. Mức tối đa là giới hạn bắt buộc; xe rẻ hơn mức tối thiểu vẫn có thể được gợi ý.'),
    question('passengers', 'Thường có bao nhiêu người đi cùng?', 'single', [['1_2', '1 – 2 người'], ['3_5', '3 – 5 người'], ['6_7', '6 – 7 người'], ['over7', 'Trên 7 người']], true, 1, 'Chọn thêm yêu cầu bắt buộc số ghế nếu xe nhất thiết phải đủ chỗ.'),
    question('environment', 'Bạn thường di chuyển ở đâu?', 'single', [['city', 'Trong đô thị'], ['mixed', 'Đô thị và đường trường'], ['highway', 'Chủ yếu đường trường'], ['rough_roads', 'Đường xấu / địa hình']]),
    question('priorities', 'Điều gì quan trọng nhất với bạn?', 'multi', [['economy', 'Tiết kiệm nhiên liệu'], ['safety', 'An toàn'], ['space', 'Rộng rãi'], ['comfort', 'Thoải mái'], ['low_cost', 'Chi phí sử dụng thấp'], ['power', 'Vận hành mạnh'], ['technology', 'Nhiều công nghệ'], ['resale', 'Giữ giá'], ['luxury', 'Sang trọng'], ['value', 'Giá tốt']], true, 3, 'Chọn tối đa 3 ưu tiên. Thứ tự chọn là thứ tự quan trọng; bạn có thể sắp xếp lại.'),
    question('technical', 'Bạn có thông số mong muốn không?', 'technical', [], false, 1, 'Để “Không quan trọng” nếu muốn Toàn Trung gợi ý. Chỉ giới hạn kho khi bạn đánh dấu bắt buộc.'),
    question('style', 'Phong cách bạn yêu thích', 'single', [['modern', 'Hiện đại'], ['sporty', 'Thể thao'], ['luxury', 'Sang trọng'], ['practical', 'Mạnh mẽ / thực dụng']], false, 1, 'Thông tin để tư vấn thêm, chưa dùng để chấm điểm khi không có dữ liệu đánh giá phù hợp.'),
  ],
};
