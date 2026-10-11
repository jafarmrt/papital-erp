interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;
  private maxEntries: number;

  constructor(defaultTtlMs: number = 60_000, maxEntries: number = 1000) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // v10.0.x (OBS-R1-10): replacing a key never evicts another one, and the oldest key is evicted even when it is ''.
    // Deleting first moves a replaced key to the end of the insertion (FIFO) order.
    const replacing = this.cache.delete(key);
    if (!replacing && this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }

    const effectiveTtl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  async getOrSet(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    this.set(key, fresh, ttlMs);
    return fresh;
  }
}

/**
 * کش درون‌حافظه‌ای ۶۰ ثانیه‌ای برای مجوزهای نقش‌ها
 */
export const rolePermissionsCache = new MemoryCache<{ permissions: string[]; isSystem: number } | null>(60_000, 200);

export function invalidateRoleCache(roleCode?: string): void {
  if (roleCode) {
    rolePermissionsCache.delete(roleCode);
  } else {
    rolePermissionsCache.clear();
  }
}

/**
 * کش درون‌حافظه‌ای ۶۰ ثانیه‌ای برای تنظیمات عمومی سامانه
 */
export const appSettingsCache = new MemoryCache<any>(60_000, 500);

export function invalidateSettingsCache(key?: string): void {
  if (key) {
    appSettingsCache.delete(key);
  } else {
    appSettingsCache.clear();
  }
}
