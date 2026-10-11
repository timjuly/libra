import { createCipheriv, createHash } from 'node:crypto';
import type { ServerRecord } from '../../src/shared/types';

export const legacyServer: ServerRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  config: {
    type: 'emby',
    name: '原有家庭媒体库',
    primary: { url: 'https://media.example.com/emby' },
    credentials: { username: 'demo', password: ' 中文 &+#% ' },
  },
  enabled: true,
  version: 'legacy-version',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

// Independent Node implementation of the already-deployed v1 envelope. These
// fixtures deliberately do not call the application's current seal() function.
export function legacySeal(secret: string, key: string, value: unknown): string {
  const material = createHash('sha256').update(`libra:encryption:v1:${secret}`).digest();
  const iv = Buffer.alloc(12, 7); // Deterministic, test fixtures only.
  const cipher = createCipheriv('aes-256-gcm', material, iv);
  cipher.setAAD(Buffer.from(key));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ v: 1, iv: iv.toString('hex'), data: data.toString('hex') });
}

export function memoryStorage(secret = 'independent-test-secret-with-at-least-32-characters') {
  const values = new Map<string, string>();
  const reads: string[][] = [];
  const lists: string[] = [];
  const kv = {
    async get(key: string | string[]) {
      reads.push(Array.isArray(key) ? key : [key]);
      if (Array.isArray(key)) {
        if (key.length > 100) throw new Error('KV bulk read exceeds 100 keys');
        return new Map(key.map((item) => [item, values.get(item) ?? null]));
      }
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
    async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
      lists.push(prefix);
      const keys = [...values.keys()].filter((key) => key.startsWith(prefix)).sort();
      // Force pagination, including at counts smaller than the production cap.
      const offset = Number(cursor ?? 0);
      const end = offset + 137;
      return {
        keys: keys.slice(offset, end).map((name) => ({ name })),
        list_complete: end >= keys.length,
        cursor: String(end),
      };
    },
  };
  const env = {
    APP_SECRET: secret,
    LIBRA_KV: kv,
    PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
    AUTH_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  return { env, values, reads, lists, kv };
}
