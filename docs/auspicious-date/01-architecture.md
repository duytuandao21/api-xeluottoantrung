# Architecture

Pure calendar -> almanac attributes -> compatibility -> registered handlers -> exclusions -> score/classification -> deterministic ranking -> versioned explanations.

Backend modules độc lập trong src/modules/auspicious-date. Calendar dùng thiên văn UTC+7, không phụ thuộc DB/thư viện lịch UTC+8. Adapter astronomy-engine 2.1.19 (MIT, khóa phiên bản) chỉ tính Sóc/kinh độ Mặt Trời/Đông chí. Quy luật lịch Việt Nam nằm trong code riêng, dựa trên mô tả Hồ Ngọc Đức (https://honguyenviet.com/amlich/calrules.html). Không sao chép code lịch hay gọi API ngoài; bảng đối chiếu HK chỉ dùng cho ngày không khác UTC+7/UTC+8. Support 1900–2099, ghi rõ giới hạn. Thư viện: https://github.com/cosinekitty/astronomy.

Settings load một lần; rules/content/source/reference load theo version; không query theo từng ngày. Không cache dữ liệu cá nhân hoặc kết quả tra cứu. Calendar pure; lịch âm có cache tối đa 64 cấu trúc năm thiên văn, không chứa ngày sinh hay phiên bản quy tắc.

Mutation/version validation/publish và audit nằm cùng transaction. Lock singleton settings để serialize publish. Published/archived snapshots bất biến. Edit draft/review tăng revision, reset validation. Public luôn chọn PUBLISHED theo purpose.
