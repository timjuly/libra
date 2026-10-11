import type { Endpoint, ServerConfig } from './types';

export class InputError extends Error {}
export function object(value: unknown, label = '数据'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new InputError(`请填写${label}`);
    return undefined;
  }
  if (typeof value !== 'string') throw new InputError(`${label}必须是字符串`);
  const result = value.trim();
  if (result.length > max) throw new InputError(`${label}不能超过 ${max} 个字符`);
  if (required && !result) throw new InputError(`请填写${label}`);
  return result || undefined;
}
export function baseURL(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^https?:\/\//i.test(value) ||
    /[\s\\?#]/u.test(value)
  ) {
    throw new InputError('线路必须是完整 HTTP(S) 地址，不能包含空白、查询参数或 #');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError('线路地址或端口无效');
  }
  const authority = value.replace(/^https?:\/\//i, '').split('/')[0];
  if (
    authority.includes('@') ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.port === '0' ||
    authority.endsWith(':')
  ) {
    throw new InputError('线路不能内嵌账号密码，端口必须为 1–65535');
  }
  // URL normalizes host casing, IPv6 and default ports (HTTPS 443 / HTTP 80).
  // Only remove trailing path slashes: distinct hosts, schemes, nondefault
  // ports and reverse-proxy paths must remain distinct connection endpoints.
  return url.origin + url.pathname.replace(/\/+$/, '');
}
function endpoint(value: unknown): Endpoint {
  const row = object(value, '线路');
  const name = text(row.name, '线路名称', 100);
  return { url: baseURL(row.url), ...(name ? { name } : {}) };
}
export function validateConfig(value: unknown): ServerConfig {
  const input = object(value, '服务器配置');
  if (input.type !== 'emby') throw new InputError('目前只支持 Emby 服务器');
  const config: ServerConfig = { type: 'emby', primary: endpoint(input.primary) };
  for (const [key, label, max] of [
    ['name', '服务器名称', 100],
    ['note', '备注', 500],
  ] as const) {
    const result = text(input[key], label, max);
    if (result) config[key] = result;
  }
  const logo = text(input.logo, 'Logo 地址', 2048);
  if (logo) {
    let url: URL;
    try {
      url = new URL(logo);
    } catch {
      throw new InputError('Logo 必须是 HTTPS 图片地址');
    }
    if (url.protocol !== 'https:' || url.username || url.password || /[\s\\]/u.test(logo))
      throw new InputError('Logo 必须是 HTTPS 图片地址，且不能包含账号密码或空白');
    config.logo = url.href;
  }
  if (input.credentials !== undefined) {
    const creds = object(input.credentials, '账号');
    config.credentials = {};
    const username = text(creds.username, '用户名', 200);
    if (username) config.credentials.username = username;
    if (creds.password !== undefined) {
      if (typeof creds.password !== 'string' || creds.password.length > 1024)
        throw new InputError('密码必须是 1024 个字符以内的字符串');
      config.credentials.password = creds.password; // Never trim, encode, or normalize passwords.
    }
  }
  if (input.alternates !== undefined) {
    if (!Array.isArray(input.alternates) || input.alternates.length > 32)
      throw new InputError('最多添加 32 条备用线路');
    const seen = new Set([config.primary.url]);
    config.alternates = input.alternates.map(endpoint).filter((line) => {
      if (seen.has(line.url)) return false;
      seen.add(line.url);
      return true;
    });
  }
  return config;
}
export function validatePassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 128 ||
    !/[A-Za-z]/.test(value) ||
    !/[0-9]/.test(value) ||
    !/[^\p{L}\p{N}\s]/u.test(value)
  ) {
    throw new InputError('密码需为 8–128 位，且同时包含字母、数字和符号');
  }
  return value;
}
export function validateSlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(value))
    throw new InputError('链接后缀需为 8–64 位字母或数字，支持纯字母或纯数字');
  return value;
}
