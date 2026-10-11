import { ASSETS, HTML } from '../../.generated/assets';
import type { IconLibrary, ServerRecord, Subscription } from '../shared/types';
import { iconLibraryURL, MAX_ICON_LIBRARIES } from '../shared/icons';
import { cachedIconCatalog, IconCatalogError } from './icon-libraries';
import {
  GITHUB_SETTINGS_KEY,
  validateGitHubToken,
  verifyGitHubToken,
  GitHubTokenError,
  type GitHubSettings,
} from './github';
import {
  InputError,
  object,
  text,
  validateConfig,
  validatePassword,
  validateSlug,
} from '../shared/validation';
import {
  checkPassword,
  digest,
  equal,
  hashPassword,
  random,
  StorageDecryptionError,
  type PasswordHash,
} from './crypto';
import { Store, StorageBusyError } from './storage';
import { discoveryInput, discoverEmbyLines, EmbyDiscoveryError } from './emby-lines';

interface Admin {
  password: PasswordHash;
  version: string;
}
interface Session {
  adminVersion: string;
  expires: number;
}
const SESSION_SECONDS = 12 * 60 * 60;
const cookieName = (request: Request) =>
  new URL(request.url).protocol === 'https:' ? '__Host-libra_session' : 'libra_session';
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
const cookie = (request: Request, value: string, age = SESSION_SECONDS) =>
  `${cookieName(request)}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const sessionToken = (request: Request) =>
  request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName(request)}=`))
    ?.slice(cookieName(request).length + 1) ?? '';
const configured = (env: Env) => typeof env.APP_SECRET === 'string' && env.APP_SECRET.length >= 32;
const routeKey = async (slug: string) => `route:${await digest(slug)}`;
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('X-Libra-Request') !== '1'
  )
    throw new HttpError(403, '请求来源无效，请刷新页面重试');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new HttpError(415, '请使用 JSON 请求');
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('请求内容为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) {
      await reader.cancel();
      throw new HttpError(413, '请求内容超过 128 KB');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(data)));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('JSON 格式无效');
  }
}
async function limited(request: Request, binding: RateLimit, prefix: string): Promise<void> {
  const address = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await binding.limit({ key: `${prefix}:${address}` })).success)
    throw new HttpError(429, '操作过于频繁，请稍后再试');
}
async function requireAdmin(request: Request, store: Store): Promise<Admin> {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '请先登录');
  const [session, admin] = await Promise.all([
    store.get<Session>(`session:${await digest(token)}`),
    store.get<Admin>('admin'),
  ]);
  if (!session || !admin || session.expires < Date.now() || session.adminVersion !== admin.version)
    throw new HttpError(401, '登录已过期，请重新登录');
  return admin;
}
async function createSession(request: Request, store: Store, admin: Admin): Promise<Response> {
  const token = random(32);
  await store.put(
    `session:${await digest(token)}`,
    { adminVersion: admin.version, expires: Date.now() + SESSION_SECONDS * 1000 },
    SESSION_SECONDS,
  );
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token) });
}
function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new InputError('开关状态无效');
  return value;
}
function version(input: unknown, current: string) {
  if (input !== current) throw new HttpError(409, '这条记录已经更新，请刷新后重试');
}
async function publicFeed(request: Request, env: Env, store: Store, slug: string) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(slug)) throw new HttpError(404, '订阅不存在或已停用');
  await limited(request, env.PUBLIC_LIMITER, 'feed');
  const route = await store.get<{ id: string }>(await routeKey(slug));
  const sub = route ? await store.get<Subscription>(`sub:${route.id}`) : null;
  if (!sub || sub.slug !== slug || !sub.enabled) throw new HttpError(404, '订阅不存在或已停用');
  const catalog = await store.servers();
  const byId = new Map(catalog.map((server) => [server.id, server]));
  const servers = sub.allServers
    ? catalog
    : sub.serverIds.map((id) => byId.get(id)).filter((item): item is ServerRecord => item !== undefined);
  if (sub.allServers) servers.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(servers.filter((server) => server.enabled).map((server) => server.config));
}
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const asset = ASSETS[path];
  if (asset && (method === 'GET' || method === 'HEAD'))
    return new Response(asset.body, {
      headers: { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  if ((path === '/' || path === '/admin') && (method === 'GET' || method === 'HEAD'))
    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (path === '/favicon.svg')
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="14" fill="#7962e8"/><path d="M15 13v22h20v-7H23V13z" fill="white"/><circle cx="32" cy="17" r="5" fill="#c7bcff"/></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } },
    );
  if (path === '/robots.txt')
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  if (path === '/api/status' && method === 'GET')
    return json({
      configured: configured(env),
      initialized: configured(env) ? !!(await new Store(env).get('admin')) : false,
    });
  if (!configured(env)) throw new HttpError(503, '请先在 Cloudflare 中设置至少 32 位的 APP_SECRET 部署密钥');
  const store = new Store(env);
  if (!path.startsWith('/api/')) {
    if (method === 'OPTIONS' && /^\/[A-Za-z0-9]{8,64}$/.test(path))
      return new Response(null, { status: 204 });
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '不支持此请求方法');
    return publicFeed(request, env, store, path.slice(1));
  }
  if (['/api/auth/setup', '/api/auth/login'].includes(path) && method === 'POST') {
    await limited(request, env.AUTH_LIMITER, 'auth');
    const input = await readBody(request);
    const admin = await store.get<Admin>('admin');
    if (path.endsWith('/setup')) {
      if (admin) throw new HttpError(409, '后台已初始化，请直接登录');
      if (typeof input.setupKey !== 'string' || !(await equal(input.setupKey, env.APP_SECRET)))
        throw new HttpError(403, '部署密钥不正确');
      const password = validatePassword(input.password);
      const created: Admin = { password: await hashPassword(password, env.APP_SECRET), version: random() };
      await store.initializeCatalogs();
      await store.embyDeviceId();
      await store.put('admin', created);
      return createSession(request, store, created);
    }
    if (
      typeof input.password !== 'string' ||
      input.password.length > 128 ||
      !admin ||
      !(await checkPassword(input.password, env.APP_SECRET, admin.password))
    )
      throw new HttpError(401, '密码不正确');
    return createSession(request, store, admin);
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await readBody(request);
    const token = sessionToken(request);
    if (token) await store.delete(`session:${await digest(token)}`);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  const admin = await requireAdmin(request, store);
  if (path === '/api/settings/emby') {
    if (method !== 'GET') throw new HttpError(405, '不支持此请求方法');
    return json({ deviceId: await store.embyDeviceId() });
  }
  if (path === '/api/settings/github') {
    let settings = await store.get<GitHubSettings>(GITHUB_SETTINGS_KEY);
    if (method !== 'GET') {
      if (!['PUT', 'DELETE'].includes(method)) throw new HttpError(405, '不支持此请求方法');
      const input = await readBody(request);
      if (input.version !== (settings?.version ?? null))
        throw new HttpError(409, 'GitHub 设置已更新，请重新打开后重试');
      const token = method === 'PUT' ? validateGitHubToken(input.token) : undefined;
      if (token) {
        await limited(request, env.AUTH_LIMITER, 'github_verify');
        await verifyGitHubToken(token);
      }
      settings = {
        ...(token ? { token } : {}),
        version: random(12),
        updatedAt: new Date().toISOString(),
      };
      await store.put(GITHUB_SETTINGS_KEY, settings);
    }
    return json({
      configured: !!settings?.token,
      version: settings?.version ?? null,
      updatedAt: settings?.updatedAt ?? null,
    });
  }
  if (path === '/api/me' && method === 'GET') return json({ authenticated: true });
  if (path === '/api/dashboard' && method === 'GET') {
    const [servers, subscriptions, iconLibraries] = await Promise.all([
      store.serverCatalog(),
      store.list<Subscription>('sub:'),
      store.iconLibraryCatalog(),
    ]);
    return json({
      servers: servers.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      subscriptions: subscriptions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      iconLibraries: iconLibraries.items,
      revisions: { servers: servers.revision, iconLibraries: iconLibraries.revision },
    });
  }
  const libraryMatch = path.match(/^\/api\/icon-libraries(?:\/([a-f0-9-]{36})(\/icons)?)?$/);
  if (libraryMatch) {
    const [, id, icons] = libraryMatch;
    const catalog = await store.iconLibraryCatalog();
    const libraries = catalog.items;
    const existing = id ? libraries.find((library) => library.id === id) : undefined;
    if (id && !existing) throw new HttpError(404, '图标库不存在，请刷新后重试');
    if (method === 'GET') {
      if (existing && icons) {
        await limited(request, env.PUBLIC_LIMITER, 'icon_catalog');
        let cacheStatus = 'MISS';
        const catalog = await cachedIconCatalog(
          existing.url,
          url.origin,
          url.searchParams.get('refresh') === '1',
          await store.get<GitHubSettings>(GITHUB_SETTINGS_KEY),
          (status) => {
            cacheStatus = status;
          },
        );
        return json(catalog, 200, { 'X-Libra-Icon-Cache': cacheStatus });
      }
      return json(existing ?? libraries, 200, { 'X-Libra-Catalog-Revision': catalog.revision });
    }
    if (icons || !['POST', 'PUT', 'DELETE'].includes(method) || (id ? method === 'POST' : method !== 'POST'))
      throw new HttpError(405, '不支持此请求方法');
    const input = await readBody(request);
    if (input.catalogRevision !== catalog.revision)
      throw new HttpError(409, '图标库目录已更新，请刷新后重试');
    if (existing) version(input.version, existing.version);
    if (existing && method === 'DELETE') {
      const catalogRevision = await store.saveIconLibraries(libraries.filter((library) => library.id !== id));
      return json({ ok: true, catalogRevision });
    }
    if (!existing && libraries.length >= MAX_ICON_LIBRARIES)
      throw new InputError(`最多维护 ${MAX_ICON_LIBRARIES} 个图标库`);
    const name = text(input.name, '图标库名称', 100, true)!;
    const source = iconLibraryURL(input.url);
    if (libraries.some((library) => library.id !== id && library.url === source))
      throw new HttpError(409, '这个图标库地址已经添加');
    const now = new Date().toISOString();
    const record: IconLibrary = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      url: source,
      version: random(12),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const catalogRevision = await store.saveIconLibraries(
      existing ? libraries.map((library) => (library.id === id ? record : library)) : [...libraries, record],
    );
    return json({ ...record, catalogRevision }, existing ? 200 : 201);
  }
  if (path === '/api/auth/password' && method === 'POST') {
    await limited(request, env.AUTH_LIMITER, 'password');
    const input = await readBody(request);
    if (
      typeof input.currentPassword !== 'string' ||
      input.currentPassword.length > 128 ||
      !(await checkPassword(input.currentPassword, env.APP_SECRET, admin.password))
    )
      throw new HttpError(403, '当前密码不正确');
    const password = validatePassword(input.password);
    const updated: Admin = { password: await hashPassword(password, env.APP_SECRET), version: random() };
    await store.put('admin', updated);
    return createSession(request, store, updated);
  }
  if (path === '/api/servers/discover-lines') {
    if (method !== 'POST') throw new HttpError(405, '不支持此请求方法');
    const input = discoveryInput(await readBody(request));
    await limited(request, env.AUTH_LIMITER, 'emby_lines');
    const deviceId = await store.embyDeviceId();
    return json(await discoverEmbyLines(input, deviceId));
  }
  const serverMatch = path.match(/^\/api\/servers(?:\/([a-f0-9-]{36}))?$/);
  if (serverMatch) {
    if (!['POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, '不支持此请求方法');
    const input = await readBody(request);
    const id = serverMatch[1];
    const catalog = await store.serverCatalog();
    const servers = catalog.items;
    if (input.catalogRevision !== catalog.revision)
      throw new HttpError(409, '服务器目录已更新，请刷新后重试');
    const existing = id ? servers.find((server) => server.id === id) : undefined;
    if (id && !existing) throw new HttpError(404, '服务器不存在');
    if (method === 'POST' && !id) {
      if (servers.length >= 200) throw new HttpError(400, '最多维护 200 台服务器');
      const now = new Date().toISOString();
      const record: ServerRecord = {
        id: crypto.randomUUID(),
        config: validateConfig(input.config),
        enabled: flag(input.enabled, true),
        version: random(12),
        createdAt: now,
        updatedAt: now,
      };
      const catalogRevision = await store.saveServers([...servers, record]);
      return json({ ...record, catalogRevision }, 201);
    }
    if (existing && (method === 'PUT' || method === 'DELETE')) {
      version(input.version, existing.version);
      if (method === 'DELETE') {
        const catalogRevision = await store.saveServers(servers.filter((server) => server.id !== id));
        return json({ ok: true, catalogRevision });
      }
      const record: ServerRecord = {
        ...existing,
        config: input.config === undefined ? existing.config : validateConfig(input.config),
        enabled: flag(input.enabled, existing.enabled),
        version: random(12),
        updatedAt: new Date().toISOString(),
      };
      const catalogRevision = await store.saveServers(
        servers.map((server) => (server.id === id ? record : server)),
      );
      return json({ ...record, catalogRevision });
    }
    throw new HttpError(405, '不支持此请求方法');
  }
  const subMatch = path.match(/^\/api\/subscriptions(?:\/([a-f0-9-]{36}))?$/);
  if (subMatch) {
    if (!['POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, '不支持此请求方法');
    const input = await readBody(request);
    const id = subMatch[1];
    const existing = id ? await store.get<Subscription>(`sub:${id}`) : null;
    if (id && !existing) throw new HttpError(404, '订阅不存在');
    if (existing) version(input.version, existing.version);
    if (existing && method === 'DELETE') {
      await store.delete(`sub:${id}`);
      await store.delete(await routeKey(existing.slug));
      return json({ ok: true });
    }
    if ((id && method !== 'PUT') || (!id && method !== 'POST')) throw new HttpError(405, '不支持此请求方法');
    if (!existing && (await store.count('sub:')) >= 50) throw new InputError('最多创建 50 条订阅链接');
    const slug = input.slug === undefined ? (existing?.slug ?? random(16)) : validateSlug(input.slug);
    const name = text(input.name ?? existing?.name, '订阅名称', 100, true)!;
    const allServers = flag(input.allServers, existing?.allServers ?? true);
    const rawIds = input.serverIds === undefined ? (existing?.serverIds ?? []) : input.serverIds;
    if (
      !Array.isArray(rawIds) ||
      rawIds.length > 200 ||
      rawIds.some((item) => typeof item !== 'string' || !/^[a-f0-9-]{36}$/.test(item))
    )
      throw new InputError('服务器选择无效');
    const serverIds = allServers ? [] : [...new Set(rawIds as string[])];
    // Partial updates, especially emergency disable/rotation, must still work
    // when an existing selection contains servers deleted since creation.
    const selectionChanged = !existing || input.serverIds !== undefined || allServers !== existing.allServers;
    if (selectionChanged && !allServers) {
      if (!serverIds.length) throw new InputError('请至少选择一台服务器');
      const available = new Set((await store.servers()).map((server) => server.id));
      if (!serverIds.every((id) => available.has(id)))
        throw new InputError('选择的服务器已被删除，请刷新后重试');
    }
    const route = await routeKey(slug);
    if (slug !== existing?.slug) {
      const occupied = await store.get<{ id: string }>(route);
      const owner = occupied ? await store.get<Subscription>(`sub:${occupied.id}`) : null;
      if (owner?.slug === slug) throw new HttpError(409, '这个后缀正在使用中，请换一个');
    }
    const now = new Date().toISOString();
    const record: Subscription = {
      id: existing?.id ?? crypto.randomUUID(),
      slug,
      name,
      allServers,
      serverIds,
      enabled: flag(input.enabled, existing?.enabled ?? true),
      version: random(12),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (slug !== existing?.slug) await store.put(route, { id: record.id });
    await store.put(`sub:${record.id}`, record);
    if (existing && slug !== existing.slug) await store.delete(await routeKey(existing.slug));
    return json(record, existing ? 200 : 201);
  }
  throw new HttpError(404, '接口不存在');
}
function routeCategory(path: string): string {
  for (const category of ['auth', 'servers', 'subscriptions', 'icon-libraries', 'settings'])
    if (path === `/api/${category}` || path.startsWith(`/api/${category}/`)) return category;
  if (path === '/api/status') return 'status';
  if (path === '/api/dashboard') return 'dashboard';
  if (path.startsWith('/api/')) return 'other_api';
  if (path.startsWith('/assets/')) return 'asset';
  return /^\/[A-Za-z0-9]{8,64}$/.test(path) ? 'public_feed' : 'page';
}
function safeErrorName(error: unknown): string {
  const names = [
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'OperationError',
    'StorageFormatError',
    'StorageDecryptionError',
    'IconCatalogError',
    'EmbyDiscoveryError',
    'GitHubTokenError',
  ];
  return error instanceof Error && names.includes(error.name) ? error.name : 'UnknownError';
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await handle(request, env);
    } catch (error) {
      const mismatch = error instanceof StorageDecryptionError;
      const busy = error instanceof StorageBusyError;
      const status =
        error instanceof HttpError ||
        error instanceof IconCatalogError ||
        error instanceof EmbyDiscoveryError ||
        error instanceof GitHubTokenError
          ? error.status
          : error instanceof InputError
            ? 400
            : mismatch
              ? 503
              : busy
                ? 429
                : 500;
      // Only fixed categories: URLs/slugs, bodies and exception messages may
      // contain credentials and must never be attached here.
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: 'request_failed',
            status,
            name: safeErrorName(error),
            route: routeCategory(new URL(request.url).pathname),
          }),
        );
      response = json(
        mismatch
          ? {
              code: 'DEPLOYMENT_KEY_MISMATCH',
              error: '部署密钥与已有数据不匹配，或数据已损坏。请恢复原来的 APP_SECRET 后重新部署。',
            }
          : {
              ...(busy ? { code: 'KV_WRITE_RATE_LIMIT' } : {}),
              error: busy
                ? '保存过于频繁，请稍等一秒后重试'
                : status === 500
                  ? '服务暂时不可用，请稍后重试或检查部署配置'
                  : (error as Error).message,
            },
        status,
      );
      if (status === 429) response.headers.set('Retry-After', busy ? '1' : '60');
    }
    const headers = new Headers(response.headers);
    const path = new URL(request.url).pathname;
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store, max-age=0');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    if (new URL(request.url).protocol === 'https:')
      headers.set('Strict-Transport-Security', 'max-age=31536000');
    if (/^\/[A-Za-z0-9]{8,64}$/.test(path)) {
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
