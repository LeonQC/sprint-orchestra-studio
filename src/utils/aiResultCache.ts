/**
 * In-memory, per-tab cache for AI results that cost a real model call.
 *
 * Module-level, not component state, so a result survives closing the popup that produced it (and
 * the ticket modal around it) and reopening later in the same session. That's the whole point: every
 * entry here was paid for, and these modals unmount every time a ticket is closed, so component
 * state alone would silently re-bill an identical request on every reopen.
 *
 * Keyed by `feature` + `key` (usually an issue key) + a content `fingerprint`, so a cached result is
 * only reused while the input it was computed from is unchanged — an edited comment or a rewritten
 * description misses the cache instead of showing a stale answer about text that no longer exists.
 *
 * Lost on a full page reload, same as every other client-only cache in this app.
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
