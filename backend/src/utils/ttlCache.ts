type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export function createTtlCache<T>(ttlMs: number) {
  const entries = new Map<string, CacheEntry<T>>();

  function getEntry(key: string, now = Date.now()) {
    const entry = entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= now) {
      entries.delete(key);
      return null;
    }

    return entry;
  }

  return {
    clear() {
      entries.clear();
    },
    delete(key: string) {
      entries.delete(key);
    },
    getEntry,
    getValue(key: string, now = Date.now()) {
      return getEntry(key, now)?.value;
    },
    set(key: string, value: T, now = Date.now()) {
      entries.set(key, {
        expiresAt: now + ttlMs,
        value
      });
      return value;
    }
  };
}
