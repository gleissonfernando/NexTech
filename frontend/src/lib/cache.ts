/**
 * Cache simples em memória com expiração
 * Reduz requisições repetidas à API
 */
import { useEffect, useState } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresIn: number;
}

class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, expiresInMs = 30000) {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      expiresIn: expiresInMs
    });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) return null;
    
    const isExpired = Date.now() - entry.timestamp > entry.expiresIn;
    
    if (isExpired) {
      this.store.delete(key);
      return null;
    }
    
    return entry.data;
  }

  clear() {
    this.store.clear();
  }

  delete(key: string) {
    this.store.delete(key);
  }
}

export const apiCache = new SimpleCache();

/**
 * Hook para usar cache com requisições
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  expiresInMs = 30000
): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(() => apiCache.get<T>(key));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const cached = apiCache.get<T>(key);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (mounted) {
          apiCache.set(key, result, expiresInMs);
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [key, expiresInMs, fetcher]);

  return { data, loading, error };
}

/**
 * Deduplica requisições simultâneas
 */
const pendingRequests = new Map<string, Promise<unknown>>();

export async function deduplicatedFetch<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fetcher().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}
