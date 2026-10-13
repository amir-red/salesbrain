/** Tiny per-process TTL cache so a polled page never hammers the ad APIs. */
const store = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  store.set(key, { at: Date.now(), value });
  return value;
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
