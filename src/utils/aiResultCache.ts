/**
 * Per-tab in-memory cache for AI results that cost a model call. Module-level so a result survives
 * closing and reopening the ticket modal (component state would pay for the same call again). Keyed by
 * feature + key + a content fingerprint, so edited input misses the cache. Lost on page reload.
 */
interface CacheEntry<T> {
  fingerprint: string;
  result: T;
  generatedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Content fingerprint for a set of strings — not a hash, just a delimiter-joined key. Cheap, and
 *  collisions would need genuinely identical content, which is exactly when reuse is correct. */
export function aiFingerprint(parts: string[]): string {
  return parts.join('␟');
}

export function getCachedAiResult<T>(feature: string, key: string, fingerprint: string): CacheEntry<T> | null {
  const entry = cache.get(`${feature}:${key}`);
  if (!entry || entry.fingerprint !== fingerprint) return null;
  return entry as CacheEntry<T>;
}

export function setCachedAiResult<T>(feature: string, key: string, fingerprint: string, result: T): void {
  cache.set(`${feature}:${key}`, { fingerprint, result, generatedAt: Date.now() });
}

/** Drops a cached entry — used after the underlying content is changed by acting on the result
 *  itself (e.g. applying an AI description edit), where the cached review is about text that no
 *  longer exists and re-showing it would be misleading. */
export function invalidateAiResult(feature: string, key: string): void {
  cache.delete(`${feature}:${key}`);
}
