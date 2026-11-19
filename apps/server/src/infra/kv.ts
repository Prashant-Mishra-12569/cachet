import { createClient } from 'redis';

/**
 * Small key-value store with expiry. Redis in dev/prod; an in-memory version for tests.
 * Used for short-lived data: sign-in challenges, sessions, rate-limit counters.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomically read and delete (single-use values such as challenges). */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Set only if absent (atomic). True if this call claimed the key: use for single-use nonces. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Fire-and-forget message to subscribers (e.g. the bot, the lamp). */
  publish(channel: string, message: string): Promise<void>;
  /** Increment a counter; the TTL is set when the counter is created. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createRedisKv(url: string): Promise<KvStore> {
  const client = createClient({
    url,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 3_000) },
  });
  client.on('error', (err: unknown) => {
    console.error('[redis] connection error:', err instanceof Error ? err.message : err);
  });
  await client.connect();

  return {
    get: (key) => client.get(key),
    async set(key, value, ttlSeconds) {
      await client.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } });
    },
    take: (key) => client.getDel(key),
    async claim(key, ttlSeconds) {
      const r = await client.set(key, '1', {
        condition: 'NX',
        expiration: { type: 'EX', value: ttlSeconds },
      });
      return r === 'OK';
    },
    async publish(channel, message) {
      await client.publish(channel, message);
    },
    async del(key) {
      await client.del(key);
    },
    async incr(key, ttlSeconds) {
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    },
    async ping() {
      try {
        return (await client.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    async close() {
      await client.close();
    },
  };
}

/** In-memory store for tests. `now` lets tests move time forward. */
export function createMemoryKv(
  now: () => number = Date.now,
): KvStore & { published: { channel: string; message: string }[] } {
  const data = new Map<string, { value: string; expiresAt: number }>();
  const published: { channel: string; message: string }[] = [];

  const read = (key: string) => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      data.delete(key);
      return null;
    }
    return entry;
  };

  return {
    get: async (key) => read(key)?.value ?? null,
    async set(key, value, ttlSeconds) {
      data.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async claim(key, ttlSeconds) {
      if (read(key)) return false;
      data.set(key, { value: '1', expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    published,
    async publish(channel, message) {
      published.push({ channel, message });
    },
    async take(key) {
      const entry = read(key);
      data.delete(key);
      return entry?.value ?? null;
    },
    async del(key) {
      data.delete(key);
    },
    async incr(key, ttlSeconds) {
      const entry = read(key);
      const count = (entry ? Number(entry.value) : 0) + 1;
      data.set(key, { value: String(count), expiresAt: entry?.expiresAt ?? now() + ttlSeconds * 1000 });
      return count;
    },
    ping: async () => true,
    async close() {
      data.clear();
    },
  };
}
