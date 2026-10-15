import { Buffer } from 'node:buffer';

export type CacheOptions = {
  enabled: boolean;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  maxPending?: number;
  now?: () => number;
  random?: () => number;
};
export type CacheLoad = { value: unknown; shareable: boolean };
type Entry = { json: string; expiresAt: number; bytes: number };

// One process only. No stale-while-revalidate or stale-if-error responses.
export class PublicResponseCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<CacheLoad>>();
  private bytes = 0;
  private epoch = 0;
  private mutations = 0;
  private readonly counters = { hit: 0, miss: 0, coalesced: 0, bypass: 0, invalidation: 0 };
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxEntryBytes: number;
  private readonly maxPending: number;

  constructor(private readonly options: CacheOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maxEntries = options.maxEntries ?? 256;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.maxEntryBytes = options.maxEntryBytes ?? 512 * 1024;
    this.maxPending = options.maxPending ?? 32;
  }

  get enabled() { return this.options.enabled; }
  hasFresh(key: string): boolean {
    return this.enabled && this.mutations === 0 && (this.entries.get(key)?.expiresAt ?? 0) > this.now();
  }
  snapshot() {
    return { ...this.counters, enabled: this.enabled, entries: this.entries.size, bytes: this.bytes, pending: this.pending.size };
  }

  invalidate() {
    this.epoch++;
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
    this.counters.invalidation++;
  }

  beginMutation() { this.mutations++; this.invalidate(); }
  endMutation() { this.invalidate(); this.mutations--; }

  async read(key: string, ttlMs: number, load: () => Promise<CacheLoad>): Promise<unknown> {
    if (!this.enabled || this.mutations || key.length > 4096) {
      this.counters.bypass++;
      return (await load()).value;
    }
    const old = this.entries.get(key);
    if (old) {
      this.remove(key);
      if (old.expiresAt > this.now()) {
        this.entries.set(key, old);
        this.bytes += old.bytes;
        this.counters.hit++;
        return JSON.parse(old.json) as unknown;
      }
    }
    const current = this.pending.get(key);
    if (current) {
      this.counters.coalesced++;
      const result = await current;
      // Responses with cookies/non-200 status must execute their own handler.
      return result.shareable ? result.value : (await load()).value;
    }
    if (this.pending.size >= this.maxPending) {
      this.counters.bypass++;
      return (await load()).value;
    }
    this.counters.miss++;
    const epoch = this.epoch;
    const request = Promise.resolve().then(load).then(result => {
      if (result.shareable && epoch === this.epoch && !this.mutations) this.store(key, result.value, ttlMs);
      return result;
    });
    this.pending.set(key, request);
    try { return (await request).value; }
    finally { if (this.pending.get(key) === request) this.pending.delete(key); }
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }

  private store(key: string, value: unknown, ttlMs: number) {
    // Serialization/cache failures must not change a successful API response.
    let json: string | undefined;
    try { json = JSON.stringify(value); } catch { return; }
    if (json === undefined) return;
    const bytes = Math.max(Buffer.byteLength(json), json.length * 2) + key.length * 2;
    if (bytes > this.maxEntryBytes || bytes > this.maxBytes) return;
    for (const [name, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(name);
    this.remove(key);
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes))
      this.remove(this.entries.keys().next().value!);
    if (this.maxEntries < 1) return;
    // Jitter only shortens TTL, so it cannot extend the declared freshness bound.
    this.entries.set(key, { json, bytes, expiresAt: this.now() + ttlMs * (0.9 + this.random() * 0.1) });
    this.bytes += bytes;
  }
}
