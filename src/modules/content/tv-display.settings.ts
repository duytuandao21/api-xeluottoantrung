import { BadRequestException } from '@nestjs/common';
import { parseTVAnniversary } from './tv-anniversary-settings.js';

/** One atomic JSON setting in the existing site_settings table. */
export function validateTVDisplaySetting(key: string, value: string, valueType: string): string {
  const fail = (message: string): never => { throw new BadRequestException(message); };
  if (key !== 'config' || valueType !== 'json') fail('TV Display phải lưu cấu hình JSON tại khóa config.');
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { fail('Cấu hình TV Display không hợp lệ.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Cấu hình TV Display không hợp lệ.');
  const data = raw as Record<string, unknown>;
  const fields = ['logoUrl', 'title', 'hotlineTitle', 'carIntervalSeconds', 'hotlineIntervalSeconds', 'syncSalesContacts', 'hotlines', 'theme', 'anniversary'];
  if (Object.keys(data).some(field => !fields.includes(field))) fail('Cấu hình TV Display có trường không được hỗ trợ.');
  const theme = data.theme === undefined ? 'standard' : data.theme;
  if (theme !== 'standard' && theme !== 'anniversary-4') fail('Giao diện TV Display không hợp lệ.');
  let anniversary;
  try { anniversary = parseTVAnniversary(data.anniversary); }
  catch { fail('Cấu hình kỷ niệm 4 năm không hợp lệ.'); }
  const text = (field: string, max: number, empty = false): string => {
    const item = data[field];
    if (typeof item !== 'string' || (!empty && !item.trim()) || item.trim().length > max || /[\r\n\u0000-\u001f]/.test(item))
      fail(`${field} không hợp lệ.`);
    return (item as string).trim();
  };
  const logoUrl = text('logoUrl', 2000, true);
  if (logoUrl && !/^(https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i.test(logoUrl)) fail('Logo phải là URL HTTPS hoặc đường dẫn nội bộ.');
  const seconds = (field: string, min: number, max: number): number => {
    const number = data[field];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max)
      fail(`${field} phải là số nguyên từ ${min} đến ${max} giây.`);
    return number as number;
  };
  if (typeof data.syncSalesContacts !== 'boolean') fail('syncSalesContacts phải là boolean.');
  if (!Array.isArray(data.hotlines) || data.hotlines.length > 30) fail('Danh sách hotline tối đa 30 số.');
  const seen = new Set<string>();
  const hotlines = (data.hotlines as unknown[]).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Hotline không hợp lệ.');
    const contact = item as Record<string, unknown>;
    if (Object.keys(contact).some(field => !['name', 'phone'].includes(field)) || typeof contact.name !== 'string' ||
      contact.name.trim().length > 80 || /[\r\n\u0000-\u001f]/.test(contact.name) || typeof contact.phone !== 'string' ||
      !/^\+?[\d\s().-]{9,30}$/.test(contact.phone)) fail('Tên hoặc số hotline không hợp lệ.');
    const phone = (contact.phone as string).replace(/[\s().-]/g, '');
    if (!/^\+?\d{9,12}$/.test(phone)) fail('Hotline phải có 9–12 chữ số.');
    const identity = phone.replace(/^\+?84(?=\d{9}$)/, '0');
    if (seen.has(identity)) fail('Danh sách hotline bị trùng số.');
    seen.add(identity);
    return { name: (contact.name as string).trim(), phone };
  });
  if (!data.syncSalesContacts && !hotlines.length) fail('Cần ít nhất một hotline khi dùng danh sách riêng.');
  return JSON.stringify({ theme, anniversary, logoUrl, title: text('title', 60), hotlineTitle: text('hotlineTitle', 24),
    carIntervalSeconds: seconds('carIntervalSeconds', 5, 300), hotlineIntervalSeconds: seconds('hotlineIntervalSeconds', 2, 120),
    syncSalesContacts: data.syncSalesContacts, hotlines });
}
