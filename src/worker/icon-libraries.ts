import type { IconCatalog, IconLibrary } from '../shared/types';
import { iconLibraryURL, parseIconCatalog } from '../shared/icons';
import { InputError } from '../shared/validation';
import { digest, random } from './crypto';
import {
  githubContentURL,
  githubRawURL,
  githubRequestHeaders,
  isGitHubContentAPI,
  type GitHubSettings,
} from './github';

export const ICON_LIBRARIES_KEY = 'catalog:icon-libraries:v1';
export const MAX_ICON_CATALOG_BYTES = 2 * 1024 * 1024;
export const DEFAULT_ICON_LIBRARIES = [
  {
    name: '白糖图标库 · 圆形',
    url: 'https://raw.githubusercontent.com/baiitang/Sakura/main/Fileball/Yuan/tubiao.json',
  },
  {
    name: '白糖图标库 · 方形',
    url: 'https://raw.githubusercontent.com/baiitang/Sakura/main/Fileball/Fang/tubiao.json',
  },
  {
    name: '离歌图标库',
    url: 'https://raw.githubusercontent.com/lige47/QuanX-icon-rule/refs/heads/main/lige-emby-icon.json',
  },
];

export function defaultIconLibraries(): IconLibrary[] {
  const now = new Date().toISOString();
  return DEFAULT_ICON_LIBRARIES.map((library) => ({
    ...library,
    id: crypto.randomUUID(),
    version: random(12),
    createdAt: now,
    updatedAt: now,
  }));
}

export class IconCatalogError extends Error {
  name = 'IconCatalogError';
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export async function fetchIconCatalog(source: string, token?: string): Promise<IconCatalog> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let url = iconLibraryURL(source);
    const githubURL = githubContentURL(url);
    const githubToken = githubURL ? token : undefined;
    const rawFallback = githubRawURL(url);
    let usedFallback = false;
    let fallbackError: IconCatalogError | undefined;
    if (githubURL && (token || new URL(url).hostname === 'github.com')) url = githubURL;
    for (let redirects = 0; redirects <= 3; redirects++) {
      // Construct a new request: never forward admin cookies, headers or credentials.
      const response = await fetch(url, {
        headers: githubRequestHeaders(url, usedFallback ? undefined : githubToken),
        redirect: 'manual',
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('Location');
        if (!location || redirects === 3) throw new IconCatalogError('图标库重定向过多或地址无效');
        url = iconLibraryURL(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (isGitHubContentAPI(new URL(url))) {
          if ([401, 403, 404].includes(response.status) && rawFallback && !usedFallback) {
            fallbackError = new IconCatalogError(
              response.status === 401
                ? 'GitHub Token 无效或已过期，且匿名读取图库失败，请更新 Token'
                : 'GitHub 图库无法读取，请检查文件地址和 Token 的读取权限',
            );
            url = iconLibraryURL(rawFallback);
            usedFallback = true;
            continue;
          }
          if (response.status === 401)
            throw new IconCatalogError('GitHub Token 无效或已过期，请在图标库设置中更新');
          if (response.headers.get('X-RateLimit-Remaining') === '0')
            throw new IconCatalogError('GitHub API 读取额度已用尽，请稍后重试或配置 Token');
          if ([403, 404].includes(response.status))
            throw new IconCatalogError('GitHub 图库无法读取，请检查文件地址和 Token 的读取权限');
        }
        throw fallbackError ?? new IconCatalogError(`图标库暂时无法访问（HTTP ${response.status}）`);
      }
      if (Number(response.headers.get('Content-Length')) > MAX_ICON_CATALOG_BYTES) {
        await response.body?.cancel();
        throw new IconCatalogError('图标库文件不能超过 2 MiB');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new IconCatalogError('图标库返回了空内容');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_ICON_CATALOG_BYTES) {
          await reader.cancel();
          throw new IconCatalogError('图标库文件不能超过 2 MiB');
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let data: unknown;
      try {
        data = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new IconCatalogError('图标库返回的内容不是有效 JSON');
      }
      // Some GitHub responses/intermediaries return the contents envelope even
      // with the raw media type. Decode only a recognized file response.
      if (
        isGitHubContentAPI(new URL(url)) &&
        data &&
        typeof data === 'object' &&
        !('icons' in data) &&
        'type' in data &&
        data.type === 'file' &&
        'encoding' in data &&
        data.encoding === 'base64' &&
        'content' in data &&
        typeof data.content === 'string'
      ) {
        try {
          const decoded = Uint8Array.from(atob(data.content.replace(/\s/g, '')), (character) =>
            character.charCodeAt(0),
          );
          data = JSON.parse(new TextDecoder().decode(decoded));
        } catch {
          throw new IconCatalogError('GitHub 图库文件内容无法解析');
        }
      }
      return parseIconCatalog(data);
    }
    throw new IconCatalogError('图标库地址无效');
  } catch (error) {
    if (error instanceof IconCatalogError) throw error;
    if (error instanceof InputError) throw new IconCatalogError(error.message);
    if (controller.signal.aborted) throw new IconCatalogError('图标库加载超时，请稍后重试', 504);
    throw new IconCatalogError('无法连接图标库，请检查地址后重试');
  } finally {
    clearTimeout(timeout);
  }
}

export async function cachedIconCatalog(
  source: string,
  origin: string,
  refresh = false,
  github?: GitHubSettings | null,
  onCache?: (status: 'HIT' | 'MISS') => void,
): Promise<IconCatalog> {
  const cache = await caches.open('libra-icon-catalogs-v1');
  const key = new Request(
    `${origin}/__icon_catalog_cache/${await digest(`${source}\n${github?.version ?? 'anonymous'}`)}`,
  );
  if (!refresh) {
    const cached = await cache.match(key);
    if (cached) {
      onCache?.('HIT');
      return cached.json();
    }
  }
  onCache?.('MISS');
  const catalog = await fetchIconCatalog(source, github?.token);
  // Only normalized icon metadata is cached, never admin/server data or upstream headers.
  await cache.put(
    key,
    new Response(JSON.stringify(catalog), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    }),
  );
  return catalog;
}
