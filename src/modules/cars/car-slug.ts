// Single-segment Web routes that must never be assigned to a vehicle.
const reservedRoutes = new Set([
  'api', 'account', 'assets', 'images', 'upload', 'thumbs', 'san-pham', 'ban-xe', 'len-doi',
  'bai-viet', 'tin-tuc', 'khuyen-mai', 'dich-vu', 'phu-kien-o-to', 'tien-ich', 'tim-kiem',
  'gioi-thieu', 've-chung-toi', 'lien-he', 'cam-ket', 'cam-nhan', 'tuyen-dung',
  'he-thong-oto-toan-trung-tuyen-dung', 'cau-hoi', 'cau-hoi-thuong-gap',
  'kinh-nghiem-su-dung-xe', 'xem-ngay-mua-xe',
  'chinh-sach-quyen-rieng-tu', 'dieu-khoan-su-dung', 'dieu-khoan-dieu-kien-niem-yet',
  'dich-vu-khac', 'dich-vu-van-chuyen', 'hoi-nghi-khach-hang-cong-ty-honda-viet-nam',
]);

export const isReservedCarSlug = (slug: string) => reservedRoutes.has(slug);

export function carSlugCandidate(base: string, suffix = 1): string {
  const ending = suffix === 1 ? '' : `-${suffix}`;
  return base.slice(0, 240 - ending.length).replace(/-+$/, '') + ending;
}
