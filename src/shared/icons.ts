import { InputError, object, text } from './validation';
import type { IconCatalog, LibraryIcon } from './types';

export const MAX_ICON_LIBRARIES = 30;
export const MAX_CATALOG_ICONS = 5000;

export function searchIcons<T extends LibraryIcon>(icons: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return icons;
  const words = normalized.split(/\s+/u);
  return icons
    .map((icon, index) => {
      const name = icon.name.toLocaleLowerCase();
      return {
        icon,
        index,
        matches: words.every((word) => name.includes(word)),
        rank: name === normalized ? 0 : name.startsWith(normalized) ? 1 : 2,
      };
    })
    .filter((item) => item.matches)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.icon);
}

export function iconLibraryURL(value: unknown): string {
  const raw = text(value, '图标库地址', 2048, true)!;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError('图标库地址必须是完整的 HTTPS JSON 地址');
  }
  const host = url.hostname.replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    /[\s\\]/u.test(raw) ||
    url.port ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)
  )
    throw new InputError('图标库需使用公网 HTTPS 域名，不能包含账号密码、# 或自定义端口');
  return url.href;
}

export function parseIconCatalog(value: unknown): IconCatalog {
  const input = object(value, '图标库 JSON');
  if (!Array.isArray(input.icons)) throw new InputError('图标库 JSON 需包含 icons 数组');
  if (input.icons.length > MAX_CATALOG_ICONS)
    throw new InputError(`图标库最多支持 ${MAX_CATALOG_ICONS} 个图标`);
  const icons: LibraryIcon[] = [];
  const seen = new Set<string>();
  for (const entry of input.icons) {
    try {
      const item = object(entry, '图标');
      const name = text(item.name, '图标名称', 100, true)!;
      const raw = text(item.url, '图标地址', 2048, true)!;
      const url = new URL(raw);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        /[\s\\]/u.test(raw) ||
        seen.has(url.href)
      )
        continue;
      seen.add(url.href);
      icons.push({ name, url: url.href });
    } catch {
      // Ignore malformed entries; no remote markup or extra fields reach the client.
    }
  }
  return { icons, skipped: input.icons.length - icons.length };
}
