import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { type Miniflare, Response as TestResponse } from 'miniflare';
import { createTestWorker } from '../scripts/test-runtime.mjs';
import { SERVER_CATALOG_KEY } from '../src/worker/storage';
import { DEFAULT_ICON_LIBRARIES, ICON_LIBRARIES_KEY } from '../src/worker/icon-libraries';
import { GITHUB_SETTINGS_KEY } from '../src/worker/github';
import { randomBytes } from 'node:crypto';

let worker: Miniflare;
const secret = randomBytes(32).toString('hex');
const origin = 'https://libra.test';
let cookie = '';
let ip = 0;
type Data = Record<string, any>;
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  options: { auth?: boolean; origin?: string; raw?: string; ip?: string } = {},
) {
  if (
    cookie &&
    options.auth !== false &&
    !options.raw &&
    method !== 'GET' &&
    body &&
    typeof body === 'object' &&
    !('catalogRevision' in body) &&
    /^\/api\/(servers|icon-libraries)(\/|$)/.test(path)
  ) {
    const dashboard = await read(await request('/api/dashboard'));
    body = {
      ...body,
      catalogRevision: dashboard.revisions[path.startsWith('/api/servers') ? 'servers' : 'iconLibraries'],
    };
  }
  const headers: Record<string, string> = { 'CF-Connecting-IP': options.ip ?? `192.0.2.${++ip}` };
  if (options.auth !== false && cookie) headers.Cookie = cookie;
  if (method !== 'GET' && method !== 'HEAD')
    Object.assign(headers, {
      'Content-Type': 'application/json',
      Origin: options.origin ?? origin,
      'X-Libra-Request': '1',
    });
  return worker.dispatchFetch(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined && !options.raw ? {} : { body: options.raw ?? JSON.stringify(body) }),
  });
}
async function read(response: Awaited<ReturnType<typeof request>>): Promise<Data> {
  return response.json() as Promise<Data>;
}
async function createServer(name = '家庭媒体库', enabled = true) {
  const response = await request('/api/servers', 'POST', {
    enabled,
    config: {
      type: 'emby',
      name,
      note: '家庭影音',
      logo: 'https://example.com/logo.png',
      primary: { url: 'https://media.example.com:8920/emby', name: '主线路' },
      credentials: { username: 'demo', password: ' 中文 &+#% ' },
      alternates: [{ url: 'http://192.168.1.10:8096', name: '局域网' }],
    },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return read(response);
}
before(async () => {
  worker = await createTestWorker({
    secret,
    outboundService: async (request) => {
      if (request.url !== 'https://api.github.com/user') throw new Error('Unexpected test outbound request');
      return TestResponse.json(
        {},
        { status: request.headers.get('Authorization') === `Bearer ghp_${'a'.repeat(36)}` ? 200 : 401 },
      );
    },
  });
});
after(async () => {
  await worker?.dispose();
});
test('unauthenticated requests cannot read or change admin data, and headers prevent caching', async () => {
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/servers', 'POST', { config: {} })).status, 401);
  const status = await request('/api/status');
  assert.deepEqual(await read(status), { initialized: false, configured: true });
  assert.match(status.headers.get('Cache-Control')!, /no-store/);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Libra/);
  assert.match(page.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
  assert.match(page.headers.get('Content-Security-Policy')!, /img-src 'self' https: data:;/);
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(page.headers.get('Access-Control-Allow-Origin'), null);
});
test('first-time setup requires deployment key, strong password and matching origin', async () => {
  assert.equal(
    (await request('/api/auth/setup', 'POST', { setupKey: 'wrong', password: 'Abcdef12!' })).status,
    403,
  );
  assert.equal(
    (await request('/api/auth/setup', 'POST', { setupKey: secret, password: 'password' })).status,
    400,
  );
  assert.equal(
    (
      await request(
        '/api/auth/setup',
        'POST',
        { setupKey: secret, password: 'Abcdef12!' },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  const response = await request('/api/auth/setup', 'POST', { setupKey: secret, password: 'Abcdef12!' });
  assert.equal(response.status, 200, await response.clone().text());
  const setCookie = response.headers.get('Set-Cookie')!;
  assert.match(setCookie, /^__Host-libra_session=/);
  assert.ok(!setCookie.includes('Domain='));
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag));
  cookie = setCookie.split(';')[0];
  assert.equal((await request('/api/me')).status, 200);
  assert.equal(
    (await request('/api/auth/setup', 'POST', { setupKey: secret, password: 'Abcdef12!' })).status,
    409,
  );
});
test('icon libraries are seeded during setup, editable, protected and deletable without reseeding', async () => {
  const kv = await worker.getKVNamespace('LIBRA_KV');
  assert.ok(await kv.get(ICON_LIBRARIES_KEY), 'setup writes the defaults before any dashboard request');
  for (const path of [
    '/api/icon-libraries',
    '/api/icon-libraries/11111111-1111-4111-8111-111111111111/icons',
  ]) {
    assert.equal((await request(path, 'GET', undefined, { auth: false })).status, 401);
  }
  let libraries = (await (await request('/api/icon-libraries')).json()) as Data[];
  assert.deepEqual(
    libraries.map(({ name, url }) => ({ name, url })),
    DEFAULT_ICON_LIBRARIES,
  );
  assert.equal(
    (await request('/api/icon-libraries', 'POST', { name: '重复', url: libraries[0].url })).status,
    409,
  );
  assert.equal(
    (await request('/api/icon-libraries', 'POST', { name: '无效', url: 'http://example.com/list.json' }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        '/api/icon-libraries',
        'POST',
        { name: '跨站', url: 'https://example.com/list.json' },
        { origin: 'https://other.example' },
      )
    ).status,
    403,
  );
  const created = await request('/api/icon-libraries', 'POST', {
    name: ' 自定义图标库 ',
    url: 'https://ICONS.example.com:443/catalog.json',
  });
  assert.equal(created.status, 201);
  const custom = await read(created);
  assert.equal(custom.name, '自定义图标库');
  assert.equal(custom.url, 'https://icons.example.com/catalog.json');
  const updated = await read(
    await request(`/api/icon-libraries/${custom.id}`, 'PUT', {
      version: custom.version,
      name: '重命名',
      url: 'https://icons.example.com/new.json',
    }),
  );
  assert.equal(updated.name, '重命名');
  assert.equal(
    (await request(`/api/icon-libraries/${custom.id}`, 'DELETE', { version: custom.version })).status,
    409,
  );
  libraries = (await read(await request('/api/dashboard'))).iconLibraries;
  for (const library of libraries)
    assert.equal(
      (await request(`/api/icon-libraries/${library.id}`, 'DELETE', { version: library.version })).status,
      200,
    );
  assert.deepEqual(await read(await request('/api/icon-libraries')), []);
  assert.deepEqual((await read(await request('/api/dashboard'))).iconLibraries, []);
  assert.equal((await request(`/api/icon-libraries/${custom.id}/icons`)).status, 404);
});
test('GitHub token settings encrypt secrets, never return them, and protect changes by version and origin', async () => {
  const token = `ghp_${'a'.repeat(36)}`;
  assert.equal((await request('/api/settings/github', 'GET', undefined, { auth: false })).status, 401);
  assert.deepEqual(await read(await request('/api/settings/github')), {
    configured: false,
    version: null,
    updatedAt: null,
  });
  assert.equal(
    (
      await request(
        '/api/settings/github',
        'PUT',
        { token, version: null },
        { origin: 'https://other.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/settings/github', 'PUT', { token: 'invalid', version: null })).status,
    400,
  );
  assert.equal(
    (await request('/api/settings/github', 'PUT', { token: `ghp_${'z'.repeat(36)}`, version: null })).status,
    422,
  );
  assert.equal((await read(await request('/api/settings/github'))).configured, false);
  const saved = await request('/api/settings/github', 'PUT', { token, version: null });
  assert.equal(saved.status, 200);
  const status = await read(saved);
  assert.deepEqual(Object.keys(status).sort(), ['configured', 'updatedAt', 'version']);
  assert.equal(status.configured, true);
  assert.deepEqual(await read(await request('/api/settings/github')), status);
  assert.equal((await (await request('/api/dashboard')).text()).includes(token), false);
  const raw = (await (await worker.getKVNamespace('LIBRA_KV')).get(GITHUB_SETTINGS_KEY, 'text'))!;
  assert.equal(raw.includes(token), false);
  assert.equal(JSON.parse(raw).v, 2);
  assert.equal((await request('/api/settings/github', 'PUT', { token, version: null })).status, 409);
  assert.equal(
    (
      await request('/api/settings/github', 'PUT', {
        token: `ghp_${'z'.repeat(36)}`,
        version: status.version,
      })
    ).status,
    422,
  );
  assert.deepEqual(
    await read(await request('/api/settings/github')),
    status,
    'invalid replacement preserves the working token',
  );
  const removed = await read(await request('/api/settings/github', 'DELETE', { version: status.version }));
  assert.equal(removed.configured, false);
  assert.notEqual(removed.version, status.version);
  assert.equal((await read(await request('/api/settings/github'))).configured, false);
});
test('credentials are encrypted in KV and raw bodies or cross-origin changes rejected', async () => {
  const server = await createServer();
  const kv = await worker.getKVNamespace('LIBRA_KV');
  const raw = (await kv.get(SERVER_CATALOG_KEY)) as string | null;
  assert.ok(raw);
  assert.equal(raw.includes('demo'), false);
  assert.equal(raw.includes('media.example'), false);
  assert.equal(
    (
      await request(
        `/api/servers/${server.id}`,
        'PUT',
        { version: server.version, enabled: false },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal((await request('/api/servers', 'POST', undefined, { raw: 'broken-json' })).status, 400);
  assert.equal(
    (await request('/api/servers', 'POST', undefined, { raw: 'x'.repeat(130 * 1024) })).status,
    413,
  );
  assert.equal(
    (await request(`/api/servers/${server.id}`, 'PUT', { version: 'stale', enabled: false })).status,
    409,
  );
});
test('public feeds return only selected enabled configurations, allow CORS, and preserve exact password', async () => {
  const selected = await createServer('Selected');
  const disabled = await createServer('Disabled', false);
  const response = await request('/api/subscriptions', 'POST', {
    name: 'My phone',
    slug: '12345678',
    allServers: false,
    serverIds: [selected.id, disabled.id],
  });
  assert.equal(response.status, 201, await response.clone().text());
  const feed = await request('/12345678', 'GET', undefined, { auth: false });
  assert.equal(feed.status, 200);
  assert.equal(feed.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(feed.headers.get('Cache-Control')!, /no-store/);
  const configs = (await feed.json()) as Data[];
  assert.deepEqual(configs, [selected.config]);
  assert.equal(configs[0].credentials.password, ' 中文 &+#% ');
  for (const key of ['id', 'enabled', 'version', 'createdAt', 'updatedAt'])
    assert.equal(Object.hasOwn(configs[0], key), false);
  assert.equal((await request('/12345678', 'HEAD')).status, 200);
  assert.equal(await (await request('/12345678', 'HEAD')).text(), '');
  assert.equal((await request('/12345678', 'OPTIONS')).status, 204);
  assert.equal((await request('/unknownX', 'GET', undefined, { auth: false })).status, 404);
  assert.equal((await request('/1234567', 'GET', undefined, { auth: false })).status, 404);
});
test('subscription disable, rotation, delete, and suffix reuse work', async () => {
  let response = await request('/api/subscriptions', 'POST', {
    name: 'All',
    slug: 'abcdefgh',
    allServers: true,
  });
  let sub = await read(response);
  assert.equal(
    (await request('/api/subscriptions', 'POST', { name: 'Collision', slug: 'abcdefgh' })).status,
    409,
  );
  assert.equal((await request('/api/subscriptions', 'POST', { name: 'Bad', slug: 'abc' })).status, 400);
  response = await request(`/api/subscriptions/${sub.id}`, 'PUT', { version: sub.version, enabled: false });
  sub = await read(response);
  assert.equal((await request('/abcdefgh', 'GET', undefined, { auth: false })).status, 404);
  response = await request(`/api/subscriptions/${sub.id}`, 'PUT', {
    version: sub.version,
    enabled: true,
    slug: 'rotatedAbc',
  });
  sub = await read(response);
  assert.equal((await request('/abcdefgh')).status, 404);
  assert.equal((await request('/rotatedAbc')).status, 200);
  assert.equal(
    (await request('/api/subscriptions', 'POST', { name: 'Reused after rotation', slug: 'abcdefgh' })).status,
    201,
  );
  assert.equal(
    (await request(`/api/subscriptions/${sub.id}`, 'DELETE', { version: sub.version })).status,
    200,
  );
  assert.equal((await request('/rotatedAbc')).status, 404);
  assert.equal(
    (await request('/api/subscriptions', 'POST', { name: 'Reused after deletion', slug: 'rotatedAbc' }))
      .status,
    201,
  );
  assert.equal((await request('/rotatedAbc')).status, 200);
});
test('all-server feeds reflect updates, disabled records and deleted servers', async () => {
  const subResponse = await request('/api/subscriptions', 'POST', { name: 'Dynamic feed' });
  const sub = await read(subResponse);
  assert.match(sub.slug, /^[a-z0-9]{32}$/);
  const created = await createServer('Dynamic');
  const before = (await (await request(`/${sub.slug}`)).json()) as Data[];
  assert.ok(before.some((item) => item.name === 'Dynamic'));
  assert.ok(!before.some((item) => item.name === 'Disabled'));
  const updated = await read(
    await request(`/api/servers/${created.id}`, 'PUT', {
      version: created.version,
      config: { ...created.config, name: 'Changed' },
    }),
  );
  const changed = (await (await request(`/${sub.slug}`)).json()) as Data[];
  assert.ok(changed.some((item) => item.name === 'Changed'));
  assert.ok(!changed.some((item) => item.name === 'Dynamic'));
  assert.equal(
    (await request(`/api/servers/${created.id}`, 'DELETE', { version: updated.version })).status,
    200,
  );
  const after = (await (await request(`/${sub.slug}`)).json()) as Data[];
  assert.ok(!after.some((item) => item.name === 'Changed'));
});
test('a selected subscription can be disabled, enabled and rotated after its last server is deleted', async () => {
  const selected = await createServer('Deleted selection');
  const created = await request('/api/subscriptions', 'POST', {
    name: 'Selected then deleted',
    slug: 'DeletedSelected123',
    allServers: false,
    serverIds: [selected.id],
  });
  assert.equal(created.status, 201);
  let sub = await read(created);
  assert.equal(
    (await request(`/api/servers/${selected.id}`, 'DELETE', { version: selected.version })).status,
    200,
  );
  assert.deepEqual(await read(await request(`/${sub.slug}`)), []);
  for (const enabled of [false, true, false]) {
    const updated = await request(`/api/subscriptions/${sub.id}`, 'PUT', { version: sub.version, enabled });
    assert.equal(updated.status, 200, await updated.clone().text());
    sub = await read(updated);
    assert.equal(
      (await request(`/${sub.slug}`, 'GET', undefined, { auth: false })).status,
      enabled ? 200 : 404,
    );
    assert.equal(
      (await read(await request('/api/dashboard'))).subscriptions.find((row: Data) => row.id === sub.id)
        .enabled,
      enabled,
    );
  }
  const rotated = await request(`/api/subscriptions/${sub.id}`, 'PUT', {
    version: sub.version,
    slug: 'DeletedRotated123',
  });
  assert.equal(rotated.status, 200);
  sub = await read(rotated);
  // New or explicitly changed selections must still reject missing IDs.
  assert.equal(
    (await request(`/api/subscriptions/${sub.id}`, 'PUT', { version: sub.version, serverIds: [selected.id] }))
      .status,
    400,
  );
  assert.equal(
    (await request(`/api/subscriptions/${sub.id}`, 'PUT', { version: sub.version, serverIds: null })).status,
    400,
  );
  assert.equal(
    (
      await request('/api/subscriptions', 'POST', {
        name: 'Invalid',
        allServers: false,
        serverIds: [selected.id],
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(`/api/subscriptions/${sub.id}`, 'DELETE', { version: sub.version })).status,
    200,
  );
  assert.equal(
    (await request('/api/subscriptions', 'POST', { name: 'Reassigned', slug: sub.slug })).status,
    201,
  );
});
test('whole catalog revisions reject stale creates, edits and deletes across different records', async () => {
  const a = await createServer('Revision A');
  const stale = (await read(await request('/api/dashboard'))).revisions.servers;
  const b = await createServer('Revision B');
  for (const [path, method, body] of [
    ['/api/servers', 'POST', { config: a.config }],
    [`/api/servers/${a.id}`, 'PUT', { version: a.version, enabled: false }],
    [`/api/servers/${a.id}`, 'DELETE', { version: a.version }],
  ] as const) {
    const response = await request(path, method, { ...body, catalogRevision: stale });
    assert.equal(response.status, 409);
    assert.match((await read(response)).error, /目录已更新/);
  }
  const unchanged = await read(await request('/api/dashboard'));
  assert.equal(unchanged.servers.find((server: Data) => server.id === a.id).enabled, true);
  assert.ok(unchanged.servers.some((server: Data) => server.id === b.id));
  assert.equal(unchanged.revisions.servers, b.catalogRevision);
  const updated = await request(`/api/servers/${a.id}`, 'PUT', {
    version: a.version,
    enabled: false,
    catalogRevision: unchanged.revisions.servers,
  });
  assert.equal(updated.status, 200);
  assert.notEqual((await read(updated)).catalogRevision, unchanged.revisions.servers);

  const library = await read(
    await request('/api/icon-libraries', 'POST', {
      name: 'Revision library',
      url: 'https://icons.example.com/revision-a.json',
    }),
  );
  const next = await read(
    await request('/api/icon-libraries', 'POST', {
      name: 'Another library',
      url: 'https://icons.example.com/revision-b.json',
    }),
  );
  for (const [path, method, body] of [
    [
      '/api/icon-libraries',
      'POST',
      { name: 'Stale create', url: 'https://icons.example.com/revision-c.json' },
    ],
    [`/api/icon-libraries/${library.id}`, 'PUT', { ...library, name: 'Stale edit' }],
    [`/api/icon-libraries/${library.id}`, 'DELETE', { version: library.version }],
  ] as const)
    assert.equal(
      (await request(path, method, { ...body, catalogRevision: library.catalogRevision })).status,
      409,
    );
  const libraries = await read(await request('/api/dashboard'));
  assert.deepEqual(
    libraries.iconLibraries.map((row: Data) => row.id),
    [library.id, next.id],
  );
  assert.equal(libraries.revisions.iconLibraries, next.catalogRevision);
});
test('login rate limiting uses IP and protects repeated guesses', async () => {
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await request('/api/auth/login', 'POST', { password: 'invalid' }, { ip: '198.51.100.99' })).status,
      401,
    );
  const blocked = await request('/api/auth/login', 'POST', { password: 'invalid' }, { ip: '198.51.100.99' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
});
test('password changes invalidate older sessions, and logout removes the active session', async () => {
  assert.equal(
    (await request('/api/auth/password', 'POST', { currentPassword: 'wrong', password: 'Newpass1!' })).status,
    403,
  );
  const changed = await request('/api/auth/password', 'POST', {
    currentPassword: 'Abcdef12!',
    password: 'Newpass1!',
  });
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/me')).status, 401);
  cookie = changed.headers.get('Set-Cookie')!.split(';')[0];
  assert.equal((await request('/api/me')).status, 200);
  assert.equal((await request('/api/auth/login', 'POST', { password: 'Abcdef12!' })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { password: 'Newpass1!' })).status, 200);
  const logout = await request('/api/auth/logout', 'POST', {});
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie')!, /Max-Age=0/);
  assert.equal((await request('/api/me')).status, 401);
});
