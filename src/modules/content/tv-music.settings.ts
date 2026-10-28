// TV music JSON contract: keep in sync in API, Admin and Web.
export const TV_MUSIC_MAX_TRACKS = 10;
export const TV_MUSIC_MAX_BYTES = 1_000_000_000; // 1 GB, decimal; includes pending uploads on the API.
export type TVMusicTrack = { id: string; name: string; url: string; sizeBytes: number };
export type TVMusicSettings = { enabled: boolean; volume: number; revision: number; tracks: TVMusicTrack[] };
export const defaultTVMusic: TVMusicSettings = { enabled: false, volume: 30, revision: 0, tracks: [] };
export function parseTVMusic(value: unknown): TVMusicSettings {
  if (value === undefined) return structuredClone(defaultTVMusic);
  const fail = (): never => { throw new Error('Nhạc TV không hợp lệ: tối đa 10 bài và tổng dung lượng 1 GB.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['enabled', 'volume', 'revision', 'tracks'].includes(key)) ||
    typeof data.enabled !== 'boolean' || !Number.isInteger(data.volume) || Number(data.volume) < 0 || Number(data.volume) > 100 ||
    !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 ||
    !Array.isArray(data.tracks) || data.tracks.length > TV_MUSIC_MAX_TRACKS) return fail();
  const ids = new Set<string>();
  let total = 0;
  const tracks = data.tracks.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !['id', 'name', 'url', 'sizeBytes'].includes(key)) ||
      typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) || ids.has(row.id) ||
      typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 120 || /[\u0000-\u001f]/.test(row.name) ||
      typeof row.url !== 'string' || row.url.length > 1000 ||
      !Number.isSafeInteger(row.sizeBytes) || Number(row.sizeBytes) < 3 || Number(row.sizeBytes) > TV_MUSIC_MAX_BYTES) return fail();
    let url: URL;
    try { url = new URL(row.url); } catch { return fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith('/tv/music/' + row.id + '.mp3')) return fail();
    ids.add(row.id);
    total += Number(row.sizeBytes);
    if (total > TV_MUSIC_MAX_BYTES) return fail();
    return { id: row.id, name: row.name.trim(), url: url.href, sizeBytes: Number(row.sizeBytes) };
  });
  return { enabled: data.enabled, volume: Number(data.volume), revision: Number(data.revision), tracks };
}
