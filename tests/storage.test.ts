import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/webcrypto';
import { digest, seal, unseal } from '../src/worker/crypto';
import { Store, StorageBusyError, SERVER_CATALOG_KEY, EMBY_DEVICE_KEY } from '../src/worker/storage';
import { ICON_LIBRARIES_KEY } from '../src/worker/icon-libraries';
import app from '../src/worker/index';
import { legacySeal, legacyServer, memoryStorage } from './helpers/storage';

test('one random Emby device ID is encrypted and survives new Store instances and configuration changes', async () => {
  const { env, values } = memoryStorage();
  const first = await new Store(env).embyDeviceId();
  assert.match(first, /^[a-f0-9-]{36}$/);
  const ciphertext = values.get(EMBY_DEVICE_KEY)!;
  assert.equal(ciphertext.includes(first), false);
  await new Store(env).saveServers([legacyServer]);
  assert.equal(await new Store(env).embyDeviceId(), first);
  assert.equal(values.get(EMBY_DEVICE_KEY), ciphertext, 'reads must never regenerate or rewrite the ID');
  assert.notEqual(await new Store(memoryStorage().env).embyDeviceId(), first);
  await new Store(env).put(EMBY_DEVICE_KEY, { deviceId: 'damaged' });
  await assert.rejects(new Store(env).embyDeviceId(), /Invalid stored/);
});

test('v1 data migrates without changing credentials; deleting all servers never restores legacy records', async () => {
  const { env, values, reads, lists } = memoryStorage();
  const key = `server:${legacyServer.id}`;
  const legacy = legacySeal(env.APP_SECRET, key, legacyServer);
  values.set(key, legacy);
  assert.deepEqual(await unseal(env.APP_SECRET, key, legacy), legacyServer);
  const store = new Store(env);
  assert.deepEqual(await store.servers(), [legacyServer]);
  assert.equal(values.has(SERVER_CATALOG_KEY), false, 'public reads cannot migrate');
  await store.saveServers(await store.servers());
  assert.equal(JSON.parse(values.get(SERVER_CATALOG_KEY)!).v, 2);
  assert.equal(values.get(key), legacy, 'preserve the encrypted upgrade backup');
  reads.length = 0;
  lists.length = 0;
  assert.deepEqual(await store.servers(), [legacyServer]);
  assert.deepEqual(reads, [[SERVER_CATALOG_KEY]]);
  assert.deepEqual(lists, []);
  await store.saveServers([]);
  assert.deepEqual(await store.servers(), []);
});

test('catalog reads never migrate or seed, even when KV returns a cached missing value', async (t) => {
  const { env, kv, values } = memoryStorage();
  const store = new Store(env);
  await store.initializeCatalogs();
  await store.saveServers([legacyServer]);
  const original = new Map(values);
  const get = kv.get.bind(kv);
  t.mock.method(kv, 'get', async (key: string | string[]) =>
    key === SERVER_CATALOG_KEY || key === ICON_LIBRARIES_KEY ? null : get(key),
  );
  const writes = t.mock.method(kv, 'put');
  assert.deepEqual(await store.servers(), []);
  assert.deepEqual(await store.iconLibraries(), []);
  assert.equal(writes.mock.callCount(), 0);
  assert.deepEqual(values, original);
});

test('old array catalogs have stable revisions until an explicit write; HTTP logos are removed on all reads', async () => {
  const { env, values } = memoryStorage();
  const store = new Store(env);
  const old = { ...legacyServer, config: { ...legacyServer.config, logo: 'http://old.example/logo.png' } };
  await store.put(SERVER_CATALOG_KEY, [old]);
  const encrypted = values.get(SERVER_CATALOG_KEY);
  const before = await store.serverCatalog();
  assert.deepEqual(before.items, [legacyServer]);
  assert.equal((await new Store(env).serverCatalog()).revision, before.revision);
  assert.equal(values.get(SERVER_CATALOG_KEY), encrypted, 'GET does not write a snapshot back to KV');
  const revision = await store.saveServers(before.items);
  assert.notEqual(revision, before.revision);
  assert.equal((await store.serverCatalog()).revision, revision);
  // Public feed uses the same sanitization, even before a write/upgrade.
  await store.put(SERVER_CATALOG_KEY, [old]);
  const slug = 'LegacyLogoTest1234';
  await store.put(`route:${await digest(slug)}`, { id: 'logo-sub' });
  await store.put('sub:logo-sub', { id: 'logo-sub', slug, enabled: true, allServers: true });
  const feed = await app.fetch(new Request(`https://libra.test/${slug}`), env);
  assert.deepEqual(await feed.json(), [legacyServer.config]);
});

test('a fresh client revision is rejected when the Worker sees an older KV catalog', async (t) => {
  const { env, kv, values } = memoryStorage();
  const store = new Store(env);
  await store.put('admin', { version: 'admin-v1' });
  const token = 'a'.repeat(64);
  await store.put(`session:${await digest(token)}`, {
    adminVersion: 'admin-v1',
    expires: Date.now() + 60_000,
  });
  await store.saveServers([legacyServer]);
  const staleValue = values.get(SERVER_CATALOG_KEY)!;
  const freshRevision = await store.saveServers([legacyServer, { ...legacyServer, id: 'second' }]);
  const latestValue = values.get(SERVER_CATALOG_KEY);
  const get = kv.get.bind(kv);
  t.mock.method(kv, 'get', async (key: string | string[]) =>
    key === SERVER_CATALOG_KEY ? staleValue : get(key),
  );
  const response = await app.fetch(
    new Request('https://libra.test/api/servers', {
      method: 'POST',
      headers: {
        Origin: 'https://libra.test',
        'Content-Type': 'application/json',
        'X-Libra-Request': '1',
        Cookie: `__Host-libra_session=${token}`,
      },
      body: JSON.stringify({ catalogRevision: freshRevision, config: legacyServer.config }),
    }),
    env,
  );
  assert.equal(response.status, 409);
  assert.equal(
    values.get(SERVER_CATALOG_KEY),
    latestValue,
    'the stale read must not overwrite the live catalog',
  );
});

test('counts never fetch/decrypt values, and list uses batches of at most 100 with pagination', async () => {
  const { env, values, reads, lists } = memoryStorage();
  const store = new Store(env);
  for (let index = 0; index < 205; index++) values.set(`sub:${index}`, 'deliberately not ciphertext');
  assert.equal(await store.count('sub:'), 205);
  assert.equal(reads.length, 0);
  assert.equal(lists.length, 2);
  for (const key of values.keys()) values.set(key, await seal(env.APP_SECRET, key, { key }));
  const rows = await store.list<{ key: string }>('sub:');
  assert.equal(rows.length, 205);
  assert.deepEqual(
    reads.map((batch) => batch.length),
    [100, 100, 5],
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, 205);
});

test('public feeds use exactly three KV reads for 200 servers and retain selected-server order', async () => {
  const { env, values, reads, lists } = memoryStorage();
  const store = new Store(env);
  const servers = Array.from({ length: 200 }, (_, i) => ({
    ...legacyServer,
    id: `server-${i}`,
    enabled: i !== 0,
    config: { ...legacyServer.config, name: `Server ${i}` },
  }));
  await store.saveServers(servers);
  const slug = 'ReadQuotaTest1234';
  const sub = { id: 'subscription', slug, enabled: true, allServers: true, serverIds: [] as string[] };
  await store.put(`route:${await digest(slug)}`, { id: sub.id });
  await store.put(`sub:${sub.id}`, sub);
  // A hidden legacy row must never leak into the authoritative catalog.
  values.set('server:legacy', legacySeal(env.APP_SECRET, 'server:legacy', legacyServer));
  const response = await app.fetch(new Request(`https://libra.test/${slug}`), env);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as unknown[]).length, 199);
  assert.equal(reads.flat().length, 3);
  assert.equal(lists.length, 0);
  await store.put(`sub:${sub.id}`, {
    ...sub,
    allServers: false,
    serverIds: ['server-199', 'deleted', 'server-1', 'server-0'],
  });
  reads.length = 0;
  const selected = await app.fetch(new Request(`https://libra.test/${slug}`), env);
  assert.deepEqual(
    ((await selected.json()) as { name: string }[]).map((row) => row.name),
    ['Server 199', 'Server 1'],
  );
  assert.equal(reads.flat().length, 3);
});

test('HKDF keys are reused within an isolate, but different secrets derive different keys', async (t) => {
  const derive = t.mock.method(crypto.subtle, 'deriveKey');
  const secret = `cache-test-${crypto.randomUUID()}`;
  const encrypted = await seal(secret, 'key', { value: 1 });
  await seal(secret, 'another-key', { value: 2 });
  await unseal(secret, 'key', encrypted);
  assert.equal(derive.mock.callCount(), 1);
  await seal(`${secret}-other`, 'key', { value: 1 });
  assert.equal(derive.mock.callCount(), 2);
});

test('a changed deployment secret produces actionable status errors and sanitized logs', async (t) => {
  const { env, values } = memoryStorage();
  const encrypted = await seal('original-deployment-secret-do-not-log', 'admin', {
    password: 'private-credential',
  });
  values.set('admin', encrypted);
  const logs = t.mock.method(console, 'error', () => {});
  const response = await app.fetch(new Request('https://libra.test/api/status?secret=do-not-log'), env);
  assert.equal(response.status, 503);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  const result = (await response.json()) as { code: string; error: string };
  assert.equal(result.code, 'DEPLOYMENT_KEY_MISMATCH');
  assert.match(result.error, /部署密钥与已有数据不匹配/);
  assert.match(result.error, /APP_SECRET/);
  assert.deepEqual(JSON.parse(logs.mock.calls[0].arguments[0]), {
    event: 'request_failed',
    status: 503,
    name: 'StorageDecryptionError',
    route: 'status',
  });
  assert.equal(values.get('admin'), encrypted);
  // Public-route diagnostics cannot include the bearer suffix, even on 500s.
  const slug = 'privateBearerSuffix123';
  values.set(`route:${await digest(slug)}`, 'broken-json-with-a-password');
  const failed = await app.fetch(new Request(`https://libra.test/${slug}`), env);
  assert.equal(failed.status, 500);
  assert.deepEqual(JSON.parse(logs.mock.calls[1].arguments[0]), {
    event: 'request_failed',
    status: 500,
    name: 'StorageFormatError',
    route: 'public_feed',
  });
});

test('KV write throttling has a short, recoverable retry message', async (t) => {
  const { env, kv } = memoryStorage();
  t.mock.method(kv, 'put', async () => {
    throw new Error('KV PUT failed: 429 Too Many Requests');
  });
  const response = await app.fetch(
    new Request('https://libra.test/api/auth/setup', {
      method: 'POST',
      headers: { Origin: 'https://libra.test', 'Content-Type': 'application/json', 'X-Libra-Request': '1' },
      body: JSON.stringify({ setupKey: env.APP_SECRET, password: 'StrongPass123!' }),
    }),
    env,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '1');
  assert.match(((await response.json()) as { error: string }).error, /保存过于频繁/);
});

test('KV throttling uses structured status and nested cause even when runtime wording changes', async (t) => {
  for (const error of [
    { status: 429, message: 'new wording' },
    { statusCode: '429' },
    { code: 429 },
    new Error('wrapper', { cause: { status: 429 } }),
  ]) {
    const { env, kv } = memoryStorage();
    t.mock.method(kv, 'put', async () => {
      throw error;
    });
    await assert.rejects(new Store(env).put('key', {}), StorageBusyError);
  }
  const { env, kv } = memoryStorage();
  const failure = new Error('another storage failure');
  t.mock.method(kv, 'put', async () => {
    throw failure;
  });
  await assert.rejects(new Store(env).put('key', {}), (error) => error === failure);
});
