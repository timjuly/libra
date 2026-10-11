import { digest, random, seal, unseal } from './crypto';
import type { IconLibrary, ServerRecord } from '../shared/types';
import { InputError } from '../shared/validation';
import { defaultIconLibraries, ICON_LIBRARIES_KEY } from './icon-libraries';

export const SERVER_CATALOG_KEY = 'catalog:servers:v1';
export const EMBY_DEVICE_KEY = 'settings:emby-device:v1';
export class StorageBusyError extends Error {
  name = 'StorageBusyError';
}
export interface Catalog<T> {
  revision: string;
  items: T[];
}
function writeThrottled(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 2) return false;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    cause?: unknown;
    message?: unknown;
  };
  return (
    [value.status, value.statusCode, value.code].some((code) => code === 429 || code === '429') ||
    writeThrottled(value.cause, depth + 1) ||
    (typeof value.message === 'string' && /KV PUT failed: 429\b/.test(value.message))
  );
}

export class Store {
  constructor(private env: Env) {}
  async embyDeviceId(): Promise<string> {
    const saved = await this.get<{ deviceId: string }>(EMBY_DEVICE_KEY);
    if (saved !== null) {
      if (
        typeof saved.deviceId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved.deviceId)
      )
        throw new Error('Invalid stored Emby device identifier');
      return saved.deviceId;
    }
    const deviceId = crypto.randomUUID();
    await this.put(EMBY_DEVICE_KEY, { deviceId });
    return deviceId;
  }
  async initializeCatalogs(): Promise<void> {
    // Only first-time setup calls this, never a dashboard/catalog read.
    if ((await this.get(ICON_LIBRARIES_KEY)) === null) await this.saveIconLibraries(defaultIconLibraries());
    if ((await this.get(SERVER_CATALOG_KEY)) === null)
      await this.saveServers(await this.list<ServerRecord>('server:'));
  }
  private async catalog<T>(key: string, fallback: () => Promise<T[]>): Promise<Catalog<T>> {
    const value = await this.get<Catalog<T> | T[]>(key);
    if (value !== null && !Array.isArray(value)) {
      if (typeof value.revision !== 'string' || !Array.isArray(value.items))
        throw new Error('Invalid catalog');
      return value;
    }
    const items = value ?? (await fallback());
    // Deterministic revision for pre-envelope data; GET never migrates or seeds.
    return { revision: await digest(JSON.stringify(items)), items };
  }
  async iconLibraryCatalog(): Promise<Catalog<IconLibrary>> {
    return this.catalog(ICON_LIBRARIES_KEY, async () => []);
  }
  async iconLibraries(): Promise<IconLibrary[]> {
    return (await this.iconLibraryCatalog()).items;
  }
  async saveIconLibraries(items: IconLibrary[]): Promise<string> {
    const revision = random(16);
    await this.put(ICON_LIBRARIES_KEY, { revision, items });
    return revision;
  }
  async get<T>(key: string): Promise<T | null> {
    const value = await this.env.LIBRA_KV.get(key);
    return value === null ? null : unseal<T>(this.env.APP_SECRET, key, value);
  }
  async put(key: string, value: unknown, ttl?: number): Promise<void> {
    const encrypted = await seal(this.env.APP_SECRET, key, value);
    try {
      await this.env.LIBRA_KV.put(key, encrypted, ttl ? { expirationTtl: ttl } : undefined);
    } catch (error) {
      // KV allows only one write per key per second. Do not retry a stale snapshot.
      if (writeThrottled(error)) throw new StorageBusyError();
      throw error;
    }
  }
  async delete(key: string): Promise<void> {
    await this.env.LIBRA_KV.delete(key);
  }
  async keys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.env.LIBRA_KV.list({ prefix, cursor, limit: 1000 });
      keys.push(...page.keys.map((key) => key.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return keys;
  }
  async count(prefix: string): Promise<number> {
    return (await this.keys(prefix)).length;
  }
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    const rows: (T | null)[] = [];
    // Bulk reads reduce round trips; Cloudflare still bills one read per key.
    for (let offset = 0; offset < keys.length; offset += 100) {
      const batch = keys.slice(offset, offset + 100);
      const values = await this.env.LIBRA_KV.get(batch);
      rows.push(
        ...(await Promise.all(
          batch.map((key) => {
            const value = values.get(key);
            return value == null ? null : unseal<T>(this.env.APP_SECRET, key, value);
          }),
        )),
      );
    }
    return rows;
  }
  async list<T>(prefix: string): Promise<T[]> {
    return (await this.getMany<T>(await this.keys(prefix))).filter((row): row is T => row !== null);
  }
  async serverCatalog(): Promise<Catalog<ServerRecord>> {
    const catalog = await this.catalog(SERVER_CATALOG_KEY, () => this.list<ServerRecord>('server:'));
    return {
      ...catalog,
      items: catalog.items.map((server) => {
        if (!server.config.logo || !/^http:\/\//i.test(server.config.logo)) return server;
        const { logo: _legacyLogo, ...config } = server.config;
        return { ...server, config };
      }),
    };
  }
  async servers(): Promise<ServerRecord[]> {
    return (await this.serverCatalog()).items;
  }
  async saveServers(servers: ServerRecord[]): Promise<string> {
    // Leave ample headroom under KV's 25 MiB value and Workers' memory limits,
    // including Base64 encryption overhead and temporary serialization buffers.
    if (new TextEncoder().encode(JSON.stringify(servers)).byteLength > 8 * 1024 * 1024)
      throw new InputError('服务器配置总大小不能超过 8 MiB，请缩短过长的备注或线路地址');
    const revision = random(16);
    await this.put(SERVER_CATALOG_KEY, { revision, items: servers });
    return revision;
  }
}
