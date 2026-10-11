import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/webcrypto';
import { iconLibraryURL, parseIconCatalog, searchIcons } from '../src/shared/icons';
import {
  cachedIconCatalog,
  DEFAULT_ICON_LIBRARIES,
  fetchIconCatalog,
  ICON_LIBRARIES_KEY,
  MAX_ICON_CATALOG_BYTES,
} from '../src/worker/icon-libraries';
import {
  githubContentURL,
  githubRawURL,
  githubRequestHeaders,
  verifyGitHubToken,
} from '../src/worker/github';
import { Store } from '../src/worker/storage';
import { memoryStorage } from './helpers/storage';

const catalog = { icons: [{ name: '家庭影院', url: 'https://icons.example.com/home.png' }] };

test('explicit setup seeds libraries once, preserves edits and never restores removed defaults', async () => {
  const { env, values } = memoryStorage();
  const store = new Store(env);
  assert.deepEqual(await store.iconLibraries(), []);
  assert.equal(values.size, 0, 'reading an absent catalog cannot seed defaults');
  await store.initializeCatalogs();
  const defaults = await store.iconLibraries();
  assert.deepEqual(
    defaults.map(({ name, url }) => ({ name, url })),
    DEFAULT_ICON_LIBRARIES,
  );
  assert.equal(values.get(ICON_LIBRARIES_KEY)!.includes('raw.githubusercontent.com'), false);
  const changed = [{ ...defaults[0], name: '自己的圆形图库', url: 'https://icons.example.com/custom.json' }];
  await store.put(ICON_LIBRARIES_KEY, changed);
  assert.deepEqual(await new Store(env).iconLibraries(), changed);
  await store.put(ICON_LIBRARIES_KEY, []);
  await store.initializeCatalogs();
  assert.deepEqual(await new Store(env).iconLibraries(), []);
});

test('catalog parser isolates malformed/insecure entries and deduplicates normalized URLs', () => {
  assert.deepEqual(
    parseIconCatalog({
      icons: [
        ...catalog.icons,
        { name: 'duplicate', url: catalog.icons[0].url },
        null,
        { name: 'unsafe', url: 'http://icons.example.com/unsafe.png' },
        { name: 'script', url: 'javascript:alert(1)' },
        { name: 'credentials', url: 'https://user:pass@icons.example.com/icon.png' },
        { name: ' 图标 ', url: 'https://ICONS.example.com:443/logo.png', html: '<script>ignored</script>' },
      ],
    }),
    { icons: [...catalog.icons, { name: '图标', url: 'https://icons.example.com/logo.png' }], skipped: 5 },
  );
  assert.throws(() => parseIconCatalog({ items: [] }), /icons/);
  assert.throws(() => parseIconCatalog({ icons: Array(5001).fill(catalog.icons[0]) }), /5000/);
  assert.deepEqual(parseIconCatalog({ icons: [] }), { icons: [], skipped: 0 });
});

test('icon search supports Chinese, case folding, multiple words and exact/prefix priority', () => {
  const icons = ['My Emby', 'EMBY Pro', 'emby', '家庭影院', 'Emby 家庭', '其他'].map((name, i) => ({
    name,
    url: `https://icons.example.com/${i}.png`,
  }));
  assert.deepEqual(
    searchIcons(icons, ' eMbY ').map((icon) => icon.name),
    ['emby', 'EMBY Pro', 'Emby 家庭', 'My Emby'],
  );
  assert.deepEqual(
    searchIcons(icons, '家庭').map((icon) => icon.name),
    ['家庭影院', 'Emby 家庭'],
  );
  assert.deepEqual(
    searchIcons(icons, '家庭 EMBY').map((icon) => icon.name),
    ['Emby 家庭'],
  );
  assert.deepEqual(searchIcons(icons, 'missing'), []);
  assert.deepEqual(searchIcons(icons, ' '), icons);
});

test('library sources require public HTTPS domains, including redirect destinations', async (t) => {
  for (const url of [
    'http://example.com/a.json',
    'https://127.0.0.1/a',
    'https://0x7f000001/a',
    'https://[::1]/a',
    'https://localhost/a',
    'https://a.local/a',
    'https://a.lan/a',
    'https://u:p@example.com/a',
    'https://example.com:8080/a',
    'https://example.com/a#token',
  ])
    assert.throws(() => iconLibraryURL(url));
  assert.equal(iconLibraryURL(' https://EXAMPLE.com:443/icons.json '), 'https://example.com/icons.json');
  const fetcher = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/secret' } }),
  );
  await assert.rejects(fetchIconCatalog('https://icons.example.com/list.json'), /公网 HTTPS/);
  assert.equal(fetcher.mock.callCount(), 1);
});

test('GitHub raw, refs/heads, blob and contents URLs use the correct file API', () => {
  assert.equal(
    githubContentURL(DEFAULT_ICON_LIBRARIES[0].url),
    'https://api.github.com/repos/baiitang/Sakura/contents/Fileball/Yuan/tubiao.json?ref=main',
  );
  assert.equal(
    githubContentURL(DEFAULT_ICON_LIBRARIES[2].url),
    'https://api.github.com/repos/lige47/QuanX-icon-rule/contents/lige-emby-icon.json?ref=main',
  );
  assert.equal(
    githubContentURL('https://github.com/owner/repo/blob/main/icons/list.json'),
    'https://api.github.com/repos/owner/repo/contents/icons/list.json?ref=main',
  );
  assert.equal(
    githubContentURL('https://raw.githubusercontent.com/owner/repo/feature%2Ficons/list.json'),
    'https://api.github.com/repos/owner/repo/contents/list.json?ref=feature%2Ficons',
  );
  assert.equal(
    githubContentURL('https://api.github.com/repos/owner/repo/contents/icons.json?ref=main'),
    'https://api.github.com/repos/owner/repo/contents/icons.json?ref=main',
  );
  assert.equal(githubContentURL('https://icons.example.com/icons.json'), null);
  for (const url of [
    'https://api.github.com.evil.example/icons.json',
    'https://api.github.com/user',
    'https://raw.githubusercontent.com/owner/repo/main/a.json',
  ])
    assert.equal(githubRequestHeaders(url, 'private-token').Authorization, undefined);
});

test('GitHub token is sent only to the official file API and stripped on redirects', async (t) => {
  const seen: { url: string; headers: Headers }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    assert.equal(init?.redirect, 'manual');
    return seen.length === 1
      ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example.com/icons.json' } })
      : Response.json(catalog);
  });
  assert.deepEqual(await fetchIconCatalog(DEFAULT_ICON_LIBRARIES[0].url, 'private-token'), {
    ...catalog,
    skipped: 0,
  });
  assert.equal(seen[0].url, githubContentURL(DEFAULT_ICON_LIBRARIES[0].url));
  assert.equal(seen[0].headers.get('Authorization'), 'Bearer private-token');
  assert.equal(seen[0].headers.get('Accept'), 'application/vnd.github.raw+json');
  assert.equal(seen[1].headers.get('Authorization'), null);
  assert.equal(seen[0].headers.get('Cookie'), null);
  seen.length = 0;
  await fetchIconCatalog('https://icons.example.com/catalog.json', 'private-token');
  assert.equal(seen[0].headers.get('Authorization'), null);
});

test('GitHub repository redirects retain read-only authentication and raw content negotiation', async (t) => {
  const redirect = 'https://api.github.com/repositories/646371452/contents/lige-emby-icon.json?ref=main';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer private-token');
    assert.equal(headers.get('Accept'), 'application/vnd.github.raw+json');
    if (calls === 1) return new Response(null, { status: 301, headers: { Location: redirect } });
    assert.equal(String(input), redirect);
    return Response.json(catalog);
  });
  assert.deepEqual(await fetchIconCatalog(DEFAULT_ICON_LIBRARIES[2].url, 'private-token'), {
    ...catalog,
    skipped: 0,
  });
  assert.equal(calls, 2);
});

test('contents API raw URLs preserve slash ref segments and encode each segment once', () => {
  for (const [ref, path] of [
    ['feature/x', 'feature/x'],
    ['refs/heads/feature/x', 'refs/heads/feature/x'],
    ['发布/v1%图标', '%E5%8F%91%E5%B8%83/v1%25%E5%9B%BE%E6%A0%87'],
    ['feature/with#hash', 'feature/with%23hash'],
    ['', 'HEAD'],
  ]) {
    const source = new URL('https://api.github.com/repos/owner/repo/contents/icons/list.json');
    if (ref) source.searchParams.set('ref', ref);
    assert.equal(
      githubRawURL(source.href),
      `https://raw.githubusercontent.com/owner/repo/${path}/icons/list.json`,
    );
  }
});

test('slash refs, expired tokens and API throttling fall back to the original public raw URL without credentials', async (t) => {
  for (const [source, expectedRaw] of [
    [
      'https://raw.githubusercontent.com/owner/repo/feature/x/icons.json',
      'https://raw.githubusercontent.com/owner/repo/feature/x/icons.json',
    ],
    [
      'https://raw.githubusercontent.com/owner/repo/refs/heads/feature/x/icons.json',
      'https://raw.githubusercontent.com/owner/repo/refs/heads/feature/x/icons.json',
    ],
    [
      'https://github.com/owner/repo/blob/feature/x/icons.json',
      'https://raw.githubusercontent.com/owner/repo/feature/x/icons.json',
    ],
    [
      'https://api.github.com/repos/owner/repo/contents/icons.json?ref=feature%2Fx',
      'https://raw.githubusercontent.com/owner/repo/feature/x/icons.json',
    ],
  ])
    for (const status of [401, 403, 404]) {
      await t.test(`${status} ${source}`, async (child) => {
        let calls = 0;
        child.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
          calls++;
          const headers = new Headers(init?.headers);
          if (calls === 1) {
            assert.equal(String(input), githubContentURL(source));
            assert.equal(headers.get('Authorization'), 'Bearer secret');
            return new Response('private error details', { status });
          }
          assert.equal(String(input), expectedRaw);
          assert.equal(headers.get('Authorization'), null);
          assert.equal(headers.get('Cookie'), null);
          return Response.json(catalog);
        });
        assert.deepEqual(await fetchIconCatalog(source, 'secret'), { ...catalog, skipped: 0 });
        assert.equal(calls, 2);
      });
    }
});

test('an inaccessible private library reports the token problem after a bounded anonymous fallback', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    if (calls.length > 1) assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return new Response('do-not-expose-token-or-body', { status: calls.length === 1 ? 401 : 404 });
  });
  await assert.rejects(fetchIconCatalog(DEFAULT_ICON_LIBRARIES[0].url, 'secret'), {
    message: 'GitHub Token 无效或已过期，且匿名读取图库失败，请更新 Token',
  });
  assert.equal(calls.length, 2);
});

test('token verification stays on the official API and never follows redirects or leaks bodies', async (t) => {
  for (const status of [200, 401, 302, 403, 500]) {
    await t.test(String(status), async (child) => {
      const fetcher = child.mock.method(
        globalThis,
        'fetch',
        async (input: string | URL | Request, init?: RequestInit) => {
          assert.equal(String(input), 'https://api.github.com/user');
          assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-token');
          assert.equal(init?.redirect, 'manual');
          return new Response('private-upstream-details', {
            status,
            headers: { Location: 'https://evil.example/' },
          });
        },
      );
      if (status === 200) await verifyGitHubToken('private-token');
      else
        await assert.rejects(verifyGitHubToken('private-token'), {
          message:
            status === 401
              ? 'GitHub Token 无效或已过期'
              : 'GitHub 暂时无法验证此 Token，请检查权限或稍后重试',
        });
      assert.equal(fetcher.mock.callCount(), 1);
    });
  }
});

test('token verification is bounded by a timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(
    globalThis,
    'fetch',
    (_input: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const result = assert.rejects(verifyGitHubToken('private-token'), /无法连接 GitHub/);
  t.mock.timers.tick(8_000);
  await result;
});

test('catalog downloads bound streamed bytes and report malformed JSON without leaking response bodies', async (t) => {
  let scenario = 0;
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => {
    scenario++;
    if (scenario === 1)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_ICON_CATALOG_BYTES + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    if (scenario === 2) return new Response('<html>upstream-private-diagnostic</html>');
    if (scenario === 3) return new Response('private-invalid-token-details', { status: 401 });
    return new Response(null, { status: 403, headers: { 'X-RateLimit-Remaining': '0' } });
  });
  await assert.rejects(fetchIconCatalog('https://icons.example.com/list.json'), /2 MiB/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchIconCatalog('https://icons.example.com/list.json'), {
    message: '图标库返回的内容不是有效 JSON',
  });
  const noRawFallback = 'https://api.github.com/repositories/123/contents/icons.json';
  await assert.rejects(fetchIconCatalog(noRawFallback, 'secret'), {
    message: 'GitHub Token 无效或已过期，请在图标库设置中更新',
  });
  await assert.rejects(fetchIconCatalog(noRawFallback, 'secret'), /额度已用尽/);
});

test('a stalled catalog request is aborted and reported as a timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(
    globalThis,
    'fetch',
    (_input: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const result = assert.rejects(fetchIconCatalog('https://icons.example.com/list.json'), /加载超时/);
  t.mock.timers.tick(10_000);
  await result;
});

test('GitHub contents envelopes decode UTF-8 JSON without following arbitrary download URLs', async (t) => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(catalog)).toString('base64'),
      download_url: 'https://untrusted.example/private',
    }),
  );
  assert.deepEqual(await fetchIconCatalog(DEFAULT_ICON_LIBRARIES[0].url, 'secret'), {
    ...catalog,
    skipped: 0,
  });
  assert.equal(fetcher.mock.callCount(), 1);
  await assert.rejects(fetchIconCatalog('https://icons.example.com/list.json'), /icons 数组/);
});

test('catalog cache refreshes and is isolated by source and token version', async (t) => {
  const entries = new Map<string, Response>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return {
          async match(key: Request) {
            return entries.get(key.url)?.clone();
          },
          async put(key: Request, response: Response) {
            entries.set(key.url, response.clone());
          },
        };
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else Reflect.deleteProperty(globalThis, 'caches');
  });
  const fetcher = t.mock.method(globalThis, 'fetch', async () => Response.json(catalog));
  const source = DEFAULT_ICON_LIBRARIES[0].url;
  const origin = 'https://libra.test';
  await cachedIconCatalog(source, origin);
  await cachedIconCatalog(source, origin);
  assert.equal(fetcher.mock.callCount(), 1);
  await cachedIconCatalog(source, origin, true);
  assert.equal(fetcher.mock.callCount(), 2);
  await cachedIconCatalog(source, origin, false, { token: 'private-token', version: 'v1', updatedAt: '' });
  await cachedIconCatalog(source, origin, false, { token: 'private-token', version: 'v1', updatedAt: '' });
  assert.equal(fetcher.mock.callCount(), 3);
  await cachedIconCatalog(source, origin, false, { version: 'removed', updatedAt: '' });
  assert.equal(fetcher.mock.callCount(), 4);
  await cachedIconCatalog(DEFAULT_ICON_LIBRARIES[1].url, origin);
  assert.equal(fetcher.mock.callCount(), 5);
  assert.equal(
    [...entries.keys()].some((key) => key.includes('private-token')),
    false,
  );
});
