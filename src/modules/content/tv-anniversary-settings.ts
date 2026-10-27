// TV Display JSON contract: keep in sync in Web, Admin and API.
export type TVAnniversarySlideConfig = {
  id: string; enabled: boolean; imageUrl: string; title: string; highlight: string; body: string;
};
export type TVAnniversarySettings = {
  slideEnabled: boolean; slides: TVAnniversarySlideConfig[];
  slideSeconds: number; pagesBetweenSlides: number;
  gratitude: boolean; messages: string[]; messageSeconds: number;
  confetti: boolean; silk: boolean; sparkles: boolean;
};
export const defaultTVAnniversary: TVAnniversarySettings = {
  slideEnabled: true, slideSeconds: 12, pagesBetweenSlides: 6,
  slides: [{ id: 'anniversary-4-default', enabled: true, imageUrl: '/upload/photo/img8444-2-7758.jpg',
    title: '4 năm đồng hành', highlight: 'Vạn lời tri ân',
    body: 'Cảm ơn quý khách hàng đã tin tưởng và đồng hành cùng Auto Toàn Trung suốt 4 năm.' }],
  gratitude: true, messageSeconds: 9,
  messages: ['Chúc mừng kỷ niệm 4 năm thành lập Auto Toàn Trung', 'Tri ân khách hàng đồng hành cùng Toàn Trung suốt 4 năm'],
  confetti: true, silk: true, sparkles: true,
};

export function parseTVAnniversary(value: unknown): TVAnniversarySettings {
  if (value === undefined) return structuredClone(defaultTVAnniversary);
  const fail = (): never => { throw new Error('Cấu hình kỷ niệm 4 năm không hợp lệ.'); };
  const record = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, max: number, empty = false): string => {
    if (typeof item !== 'string' || (!empty && !item.trim()) || item.length > max || /[\u0000-\u001f\u007f]/.test(item)) return fail();
    return item.trim();
  };
  const data = record(value);
  if (Object.keys(data).some(key => !Object.hasOwn(defaultTVAnniversary, key))) fail();
  for (const key of ['slideEnabled', 'gratitude', 'confetti', 'silk', 'sparkles']) if (typeof data[key] !== 'boolean') fail();
  const integer = (key: string, min: number, max: number) => {
    const number = data[key];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) return fail();
    return number;
  };
  if (!Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 5 || !Array.isArray(data.slides) || data.slides.length > 6) fail();
  const messages = (data.messages as unknown[]).map(item => text(item, 100));
  const ids = new Set<string>();
  const slides = (data.slides as unknown[]).map(item => {
    const slide = record(item);
    if (Object.keys(slide).some(key => !['id','enabled','imageUrl','title','highlight','body'].includes(key))) fail();
    const id = text(slide.id, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || typeof slide.enabled !== 'boolean') fail();
    ids.add(id);
    const imageUrl = text(slide.imageUrl, 2000, true);
    if (imageUrl) {
      if (/[\\\s]/.test(imageUrl) || !/^(https:\/\/|\/(?!\/))/.test(imageUrl)) fail();
      const url = new URL(imageUrl, 'https://tv.invalid');
      if (url.username || url.password || url.hash) fail();
    }
    return { id, enabled: slide.enabled as boolean, imageUrl, title: text(slide.title, 60),
      highlight: text(slide.highlight, 60), body: text(slide.body, 240) };
  });
  return { slideEnabled: data.slideEnabled as boolean, slides,
    slideSeconds: integer('slideSeconds', 5, 60), pagesBetweenSlides: integer('pagesBetweenSlides', 1, 30),
    gratitude: data.gratitude as boolean, messages, messageSeconds: integer('messageSeconds', 5, 60),
    confetti: data.confetti as boolean, silk: data.silk as boolean, sparkles: data.sparkles as boolean };
}
