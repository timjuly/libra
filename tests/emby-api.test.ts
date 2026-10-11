import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Response as TestResponse } from 'miniflare';
import { createTestWorker } from '../scripts/test-runtime.mjs';
import { EMBY_DEVICE_KEY } from '../src/worker/storage';

test('discovery API enforces admin/CSRF, sends a persistent device ID, and never saves upstream tokens or draft servers', async (t) => {
  const calls: { path: string; headers: Headers; body: string }[] = [];
  const primary = 'https://discovery.example.test/reverse/emby';
  const token = 'private-test-emby-token';
  let badPassword = false;
  let unsupported = false;
  const worker = await createTestWorker({
    secret: 'fake-emby-api-deployment-secret-never-real',
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://discovery.example.test');
      const headers = new Headers([...request.headers]);
      const body = await request.text();
      calls.push({ path: url.pathname, headers, body });
      assert.equal(headers.get('User-Agent'), 'LibraManager');
      assert.equal(headers.get('Cookie'), null);
      assert.equal(url.search, '');
      if (url.pathname.endsWith('/Users/AuthenticateByName')) {
        assert.deepEqual(JSON.parse(body), { Username: 'demo', Pw: ' 中文 &+#% ' });
        if (badPassword) return new TestResponse('private upstream message', { status: 401 });
        return TestResponse.json({ AccessToken: token, ServerId: 'private-server-id' });
      }
      assert.equal(headers.get('X-Emby-Token'), token);
      if (url.pathname.endsWith('/Sessions/Logout')) return new TestResponse(null, { status: 204 });
      assert.equal(url.pathname, '/reverse/emby/System/Ext/ServerDomains');
      if (unsupported) return new TestResponse(null, { status: 404 });
      return TestResponse.json({
        ok: true,
        data: [{ name: ' 备用 ', url: 'https://backup.example.test/emby/' }],
      });
    },
  });
  t.after(() => worker.dispose());
  let cookie = '';
  const origin = 'https://libra.test';
  const input = { primary: { url: primary }, credentials: { username: 'demo', password: ' 中文 &+#% ' } };
  async function request(path: string, body?: unknown, method = 'POST', source = origin) {
    return worker.dispatchFetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: source,
        'X-Libra-Request': '1',
        'Content-Type': 'application/json',
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  }
  assert.equal((await request('/api/servers/discover-lines', input)).status, 401);
  assert.equal((await request('/api/settings/emby', undefined, 'GET')).status, 401);
  assert.equal(calls.length, 0);
  const setup = await request('/api/auth/setup', {
    setupKey: 'fake-emby-api-deployment-secret-never-real',
    password: 'Example123!',
  });
  assert.equal(setup.status, 200);
  cookie = setup.headers.get('Set-Cookie')!.split(';')[0];
  const kv = await worker.getKVNamespace('LIBRA_KV');
  const encryptedDevice = await kv.get(EMBY_DEVICE_KEY);
  assert.ok(encryptedDevice, 'seed the device at setup');
  const settings = await request('/api/settings/emby', undefined, 'GET');
  const { deviceId } = (await settings.json()) as { deviceId: string };
  assert.match(deviceId, /^[a-f0-9-]{36}$/);
  assert.equal((await request('/api/settings/emby', { deviceId: 'replacement' })).status, 405);
  assert.equal((await request('/api/servers/discover-lines', input, 'GET')).status, 405);
  assert.equal(
    (await request('/api/servers/discover-lines', input, 'POST', 'https://evil.test')).status,
    403,
  );
  assert.equal(
    (await request('/api/servers/discover-lines', { ...input, primary: { url: 'http://127.0.0.1' } })).status,
    400,
  );
  assert.equal(calls.length, 0);
  const keysBefore = (await kv.list()).keys.map(({ name }) => name);
  for (let i = 0; i < 2; i++) {
    const response = await request('/api/servers/discover-lines', input);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('Cache-Control')!, /no-store/);
    assert.deepEqual(await response.json(), {
      lines: [{ name: '备用', url: 'https://backup.example.test/emby' }],
      skipped: 0,
    });
  }
  assert.equal(calls.length, 6);
  for (const call of calls)
    assert.ok(call.headers.get('X-Emby-Authorization')!.includes(`DeviceId="${deviceId}"`));
  assert.equal(await kv.get(EMBY_DEVICE_KEY), encryptedDevice);
  assert.deepEqual(
    (await kv.list()).keys.map(({ name }) => name),
    keysBefore,
  );
  for (const key of keysBefore) assert.equal((await kv.get(key, 'text'))!.includes(token), false);
  assert.deepEqual(
    ((await (await request('/api/dashboard', undefined, 'GET')).json()) as { servers: unknown[] }).servers,
    [],
  );
  badPassword = true;
  const rejected = await request('/api/servers/discover-lines', input);
  assert.equal(rejected.status, 422);
  assert.match(await rejected.text(), /用户名和密码/);
  assert.equal(
    (await request('/api/me', undefined, 'GET')).status,
    200,
    'upstream 401 cannot log out the admin',
  );
  badPassword = false;
  unsupported = true;
  const missing = await request('/api/servers/discover-lines', input);
  assert.equal(missing.status, 422);
  assert.match(await missing.text(), /未提供备用线路/);
});
