import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/client/api';
import {
  cachedIcons,
  clearIconCatalogCache,
  invalidateIconCatalog,
  loadIcons,
} from '../src/client/icon-cache';
import type { IconLibrary } from '../src/shared/types';

test('a KV write limit is retried once after one second with the exact original revision and body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bodies: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    return bodies.length === 1
      ? Response.json({ code: 'KV_WRITE_RATE_LIMIT', error: '保存过于频繁' }, { status: 429 })
      : Response.json({ error: '服务器目录已更新，请刷新后重试' }, { status: 409 });
  });
  const body = { version: 'record-original', catalogRevision: 'directory-original', enabled: false };
  const result = assert.rejects(api('/api/servers/id', 'PUT', body), {
    status: 409,
    message: '服务器目录已更新，请刷新后重试',
  });
  await new Promise(setImmediate);
  t.mock.timers.tick(1000);
  assert.equal(bodies.length, 1);
  t.mock.timers.tick(100);
  await result;
  assert.deepEqual(bodies, [JSON.stringify(body), JSON.stringify(body)]);
});

test('a persistent KV write limit stops after one retry; other rate limits are never retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let code: string | undefined = 'KV_WRITE_RATE_LIMIT';
  const fetcher = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ code, error: '稍后重试' }, { status: 429 }),
  );
  const result = assert.rejects(api('/api/servers/id', 'PUT', { catalogRevision: 'unchanged' }), {
    status: 429,
  });
  await new Promise(setImmediate);
  t.mock.timers.tick(1100);
  await result;
  assert.equal(fetcher.mock.callCount(), 2);
  code = undefined;
  await assert.rejects(api('/api/auth/login', 'POST', {}), { status: 429 });
  assert.equal(fetcher.mock.callCount(), 3);
});

const library: IconLibrary = {
  id: 'id',
  name: 'Library',
  url: 'https://icons.example/list.json',
  version: 'v1',
  createdAt: '',
  updatedAt: '',
};
const catalog = { icons: [{ name: 'Icon', url: 'https://icons.example/a.png' }], skipped: 0 };

test('icon catalogs outlive the picker, deduplicate downloads, expire, refresh and invalidate on source/version changes', async (t) => {
  clearIconCatalogCache();
  t.after(clearIconCatalogCache);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const fetcher = t.mock.method(globalThis, 'fetch', async () => Response.json(catalog));
  await Promise.all([loadIcons(library), loadIcons(library)]);
  assert.equal(fetcher.mock.callCount(), 1);
  assert.deepEqual(cachedIcons(library), catalog);
  await loadIcons(library);
  assert.equal(fetcher.mock.callCount(), 1);
  now += 600_001;
  assert.equal(cachedIcons(library), undefined);
  await loadIcons(library);
  assert.equal(fetcher.mock.callCount(), 2);
  invalidateIconCatalog(library);
  await loadIcons(library, true);
  assert.match(String(fetcher.mock.calls[2].arguments[0]), /\?refresh=1$/);
  await loadIcons({ ...library, version: 'v2' });
  await loadIcons({ ...library, url: 'https://icons.example/other.json' });
  assert.equal(fetcher.mock.callCount(), 5);
});

test('failed catalogs are not cached and old requests cannot repopulate cache after token changes or logout', async (t) => {
  clearIconCatalogCache();
  t.after(clearIconCatalogCache);
  let finish: (value: Response) => void = () => {};
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const old = loadIcons(library);
  clearIconCatalogCache();
  finish(Response.json(catalog));
  await old;
  assert.equal(cachedIcons(library), undefined);
  const failed = assert.rejects(loadIcons(library), { status: 502 });
  finish(Response.json({ error: '读取失败' }, { status: 502 }));
  await failed;
  assert.equal(cachedIcons(library), undefined);
  const retry = loadIcons(library);
  finish(Response.json(catalog));
  assert.deepEqual(await retry, catalog);
});
