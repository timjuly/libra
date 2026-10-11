import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryInput, discoverEmbyLines, EmbyDiscoveryError } from '../src/worker/emby-lines';
import { newAlternateLines } from '../src/shared/lines';

const connection = { url: 'https://media.example.com/emby', username: 'demo', password: ' 中文 &+#% ' };
const accessToken = 'fake-emby-access-token';
const deviceId = 'test-device-id';
const sample = { ok: true, data: [{ name: '备用线路', url: 'https://backup.example.com/emby' }] };

test('discovered root addresses deduplicate across default ports and trailing slashes before reaching the client', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/AuthenticateByName')) return Response.json({ AccessToken: accessToken });
    if (path.endsWith('/Logout')) return new Response(null, { status: 204 });
    return Response.json({
      ok: true,
      data: [
        { url: 'https://www.example.com:443/', name: '优先线路' },
        { url: 'https://www.example.com', name: '重复一' },
        { url: 'https://WWW.example.com/', name: '重复二' },
        { url: 'https://wwww.example.com', name: '另一个主机' },
        { url: 'http://www.example.com:80/', name: 'HTTP 线路' },
        { url: 'http://www.example.com', name: '重复三' },
      ],
    });
  });
  assert.deepEqual(await discoverEmbyLines(connection, deviceId), {
    lines: [
      { url: 'https://www.example.com', name: '优先线路' },
      { url: 'https://wwww.example.com', name: '另一个主机' },
      { url: 'http://www.example.com', name: 'HTTP 线路' },
    ],
    skipped: 0,
  });
});

test('merging discovered lines emits canonical URLs and preserves the first name, ordering and manual drafts', () => {
  const primary = { url: 'https://primary.example.com:443/' };
  const existing = [
    { url: 'http://manual.example.com:80/', name: '我的名称' },
    { url: '', name: '未填完' },
  ];
  const discovered = [
    { url: 'https://PRIMARY.example.com', name: '主线路重复' },
    { url: 'http://manual.example.com', name: '不能覆盖手动名称' },
    { url: 'https://WWW.example.com:443/', name: '首次名称' },
    { url: 'https://www.example.com', name: '重复名称' },
    { url: 'https://www.example.com/', name: '再次重复' },
    { url: 'https://www.example.com:8443/', name: '另一个端口' },
    { url: 'https://www.example.com/emby/', name: '反代路径' },
    { url: 'https://wwww.example.com/', name: '另一个主机' },
  ];
  const originals = structuredClone({ primary, existing, discovered });
  const additional = newAlternateLines(primary, existing, discovered);
  assert.deepEqual(additional, [
    { url: 'https://www.example.com', name: '首次名称' },
    { url: 'https://www.example.com:8443', name: '另一个端口' },
    { url: 'https://www.example.com/emby', name: '反代路径' },
    { url: 'https://wwww.example.com', name: '另一个主机' },
  ]);
  assert.deepEqual({ primary, existing, discovered }, originals);
  assert.deepEqual(newAlternateLines(primary, [...existing, ...additional], discovered), []);
});

test('discovery validates primary and account without altering passwords or stored LAN support', () => {
  const input = (url: string, password: unknown = connection.password) => ({
    primary: { url },
    credentials: { username: ' demo ', password },
  });
  assert.deepEqual(discoveryInput(input('https://MEDIA.example.com:443/emby/')), connection);
  assert.equal(discoveryInput(input(connection.url, '')).password, '');
  assert.equal(
    discoveryInput({ primary: { url: connection.url }, credentials: { username: 'demo' } }).password,
    '',
  );
  for (const url of [
    'http://127.0.0.1',
    'http://0x7f000001',
    'http://169.254.169.254',
    'http://192.168.1.1',
    'http://10.2.3.4',
    'http://172.16.0.1',
    'http://100.64.0.1',
    'http://localhost',
    'https://host.local',
    'http://[::1]',
    'http://[fd00::1]',
    'http://[::ffff:7f00:1]',
    'http://[fe80::1]',
    'http://user:pass@example.com',
    'https://example.com?token=secret',
    'https://example.com#foo',
  ]) {
    assert.throws(() => discoveryInput(input(url)), url);
  }
  assert.equal(
    discoveryInput(input('http://public.example.com:8096/path')).url,
    'http://public.example.com:8096/path',
  );
  assert.equal(
    discoveryInput(input('https://[2001:db8::1]:8920/emby')).url,
    'https://[2001:db8::1]:8920/emby',
  );
  assert.throws(() => discoveryInput({ primary: { url: connection.url }, credentials: {} }), /用户名/);
  assert.throws(() => discoveryInput(input(connection.url, 123)), /密码/);
});

test('login precedes discovery, all requests use LibraManager, passwords are exact and tokens stay private', async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push(url);
    assert.equal(new URL(url).origin, 'https://media.example.com');
    assert.equal(headers.get('User-Agent'), 'LibraManager');
    assert.match(headers.get('X-Emby-Authorization')!, /Client="LibraManager"/);
    assert.match(headers.get('X-Emby-Authorization')!, /DeviceId="test-device-id"/);
    assert.equal(headers.get('Cookie'), null);
    assert.equal(init?.redirect, 'manual');
    assert.equal(new URL(url).search, '');
    if (url.endsWith('/Users/AuthenticateByName')) {
      assert.equal(requests.length, 1);
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { Username: 'demo', Pw: connection.password });
      assert.equal(headers.get('X-Emby-Token'), null);
      return Response.json({ AccessToken: accessToken, User: { private: 'do-not-export' } });
    }
    assert.equal(headers.get('X-Emby-Token'), accessToken);
    if (url.endsWith('/Sessions/Logout')) {
      assert.equal(init?.method, 'POST');
      return new Response(null, { status: 204 });
    }
    assert.equal(init?.method, 'GET');
    return Response.json({
      ...sample,
      token: accessToken,
      data: [
        { name: ' 主线路 ', url: 'https://MEDIA.example.com:443/emby/' },
        ...sample.data,
        { name: '重复地址', url: 'https://BACKUP.example.com:443/emby/' },
        { url: 'http://192.168.1.20:8096' },
        { name: ' IPv6 ', url: 'https://[2001:db8::2]:8920/reverse/proxy' },
        null,
        { url: 'javascript:alert(1)' },
        { url: 'https://u:p@example.com' },
        { url: 'https://example.com?token=secret' },
        { name: 1, url: 'https://bad.example.com' },
      ],
    });
  });
  const result = await discoverEmbyLines(connection, deviceId);
  assert.deepEqual(result, {
    lines: [
      { name: '主线路', url: connection.url },
      ...sample.data,
      { url: 'http://192.168.1.20:8096' },
      { name: 'IPv6', url: 'https://[2001:db8::2]:8920/reverse/proxy' },
    ],
    skipped: 5,
  });
  assert.equal(JSON.stringify(result).includes(accessToken), false);
  assert.deepEqual(
    requests.map((url) => new URL(url).pathname),
    ['/emby/Users/AuthenticateByName', '/emby/System/Ext/ServerDomains', '/emby/Sessions/Logout'],
  );
});

test('path fallback stays under the primary reverse-proxy path and authenticates only once successfully', async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/proxy/Users/AuthenticateByName') return Response.json({ AccessToken: accessToken });
    if (path === '/proxy/emby/System/Ext/ServerDomains') return Response.json(sample);
    if (path.endsWith('/Sessions/Logout')) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(
    await discoverEmbyLines({ ...connection, url: 'https://media.example.com/proxy' }, deviceId),
    { lines: sample.data, skipped: 0 },
  );
  assert.deepEqual(paths, [
    '/proxy/emby/Users/AuthenticateByName',
    '/proxy/Users/AuthenticateByName',
    '/proxy/System/Ext/ServerDomains',
    '/proxy/emby/System/Ext/ServerDomains',
    '/proxy/Sessions/Logout',
  ]);
});

test('bad credentials, denied UA and throttling do not retry login or expire the Libra admin session', async (t) => {
  for (const status of [401, 403, 429, 503]) {
    await t.test(String(status), async (t) => {
      const fetcher = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('upstream-password-secret', { status }),
      );
      await assert.rejects(
        discoverEmbyLines({ ...connection, url: 'https://media.example.com' }, deviceId),
        (error: unknown) => {
          assert.ok(error instanceof EmbyDiscoveryError);
          assert.notEqual(error.status, 401);
          assert.equal(error.message.includes('upstream-password-secret'), false);
          return true;
        },
      );
      assert.equal(fetcher.mock.callCount(), 1);
    });
  }
});

test('login and extension redirects never forward passwords or tokens, even to a same-origin new path', async (t) => {
  for (const phase of ['login', 'extension']) {
    for (const destination of [
      'https://evil.example.com/collect',
      'https://media.example.com/new',
      'http://media.example.com/downgrade',
    ]) {
      await t.test(`${phase} ${destination}`, async (t) => {
        const calls: string[] = [];
        t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
          const url = String(input);
          calls.push(url);
          if (phase === 'extension' && url.endsWith('/AuthenticateByName'))
            return Response.json({ AccessToken: accessToken });
          if (url.endsWith('/Sessions/Logout')) return new Response(null, { status: 204 });
          return new Response(null, { status: 307, headers: { Location: destination } });
        });
        await assert.rejects(discoverEmbyLines(connection, deviceId), /重定向/);
        assert.equal(calls.includes(destination), false);
        assert.equal(calls.length, phase === 'login' ? 1 : 3);
      });
    }
  }
});

test('unsupported, malformed, oversized and unsuccessful domain responses are isolated and sessions cleaned up', async (t) => {
  const cases: { label: string; response: () => Response; match: RegExp }[] = [
    { label: 'unsupported', response: () => new Response(null, { status: 404 }), match: /未提供备用线路/ },
    {
      label: 'denied',
      response: () => new Response(accessToken, { status: 401 }),
      match: /备用线路接口拒绝/,
    },
    {
      label: 'ok false',
      response: () => Response.json({ ok: false, data: [], error: accessToken }),
      match: /有效列表/,
    },
    { label: 'HTML', response: () => new Response('<html>upstream secret</html>'), match: /有效数据/ },
    { label: 'missing list', response: () => Response.json({ ok: true }), match: /有效列表/ },
    {
      label: 'too many',
      response: () => Response.json({ ok: true, data: Array(513).fill(sample.data[0]) }),
      match: /512/,
    },
    {
      label: 'large header',
      response: () => new Response('', { headers: { 'Content-Length': '524289' } }),
      match: /响应过大/,
    },
    {
      label: 'large stream',
      response: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(524289));
              controller.close();
            },
          }),
        ),
      match: /响应过大/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, async (t) => {
      let loggedOut = false;
      t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        if (String(input).endsWith('/AuthenticateByName')) return Response.json({ AccessToken: accessToken });
        if (String(input).endsWith('/Sessions/Logout')) {
          loggedOut = true;
          return new Response(null, { status: 204 });
        }
        return scenario.response();
      });
      await assert.rejects(discoverEmbyLines(connection, deviceId), scenario.match);
      assert.equal(loggedOut, true);
    });
  }
});

test('empty lists are valid and logout failures cannot discard a successful result', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input).endsWith('/AuthenticateByName')) return Response.json({ AccessToken: accessToken });
    if (String(input).endsWith('/Sessions/Logout')) throw new Error('network error with secret');
    return Response.json({ ok: true, data: [] });
  });
  assert.deepEqual(await discoverEmbyLines(connection, deviceId), { lines: [], skipped: 0 });
});

test('network failures and timeouts are sanitized without leaking upstream secrets', async (t) => {
  await t.test('network', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('secret-token-in-network-error');
    });
    await assert.rejects(discoverEmbyLines(connection, deviceId), /无法连接主线路/);
  });
  await t.test('timeout', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(
      globalThis,
      'fetch',
      async (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('private-token')), { once: true });
        }),
    );
    const pending = assert.rejects(discoverEmbyLines(connection, deviceId), /超时/);
    t.mock.timers.tick(15_000);
    await pending;
  });
});

test('merging retains manual names/order and unfinished rows while excluding the normalized primary and duplicates', () => {
  const primary = { url: 'https://MEDIA.example.com:443/emby/', name: '自己的主线' };
  const existing = [{ name: '自己的备用名称', url: 'https://BACKUP.example.com:443/emby/' }, { url: '' }];
  const snapshot = JSON.stringify(existing);
  assert.deepEqual(
    newAlternateLines(primary, existing, [
      { url: connection.url, name: '站点主线' },
      ...sample.data,
      { url: 'https://new.example.com', name: '新线路' },
      { url: 'https://new.example.com/', name: '重复' },
    ]),
    [{ url: 'https://new.example.com', name: '新线路' }],
  );
  assert.equal(JSON.stringify(existing), snapshot);
});
