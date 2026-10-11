import type { DiscoveredLines, Endpoint } from '../shared/types';
import { baseURL, InputError, object, text } from '../shared/validation';

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_DISCOVERED_LINES = 512;
export const EMBY_USER_AGENT = 'LibraManager';

export class EmbyDiscoveryError extends Error {
  name = 'EmbyDiscoveryError';
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export function discoveryInput(input: Record<string, unknown>) {
  const primary = object(input.primary, '主线路');
  const credentials = object(input.credentials, '账号');
  const url = baseURL(primary.url);
  const username = text(credentials.username, 'Emby 用户名', 200, true)!;
  const password = credentials.password === undefined ? '' : credentials.password;
  if (typeof password !== 'string' || password.length > 1024)
    throw new InputError('Emby 密码必须是 1024 个字符以内的字符串');
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  // Local addresses remain valid stored/player endpoints, but a public Worker
  // cannot discover through them. Never send credentials to metadata/loopback.
  const ipv4 = host.split('.').map(Number);
  const privateIPv4 =
    /^\d+\.\d+\.\d+\.\d+$/.test(host) &&
    (ipv4[0] === 0 ||
      ipv4[0] === 10 ||
      ipv4[0] === 127 ||
      ipv4[0] >= 224 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127));
  const privateIPv6 =
    host.startsWith('[') &&
    (host === '[::]' || host === '[::1]' || /^\[(?:f[cd]|fe[89ab]|ff|::ffff:)/.test(host));
  if (
    privateIPv4 ||
    privateIPv6 ||
    (!host.includes('.') && !host.startsWith('[')) ||
    /(?:^|\.)(?:localhost|local|lan|internal|home|invalid)$/.test(host)
  )
    throw new InputError('获取线路需要公网主线路，局域网地址可保留给本地播放器使用');
  return { url, username, password };
}

async function responseJSON(response: Response, label: string): Promise<Record<string, unknown>> {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new EmbyDiscoveryError(`${label}响应过大`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new EmbyDiscoveryError(`${label}返回了空内容`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new EmbyDiscoveryError(`${label}响应过大`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new EmbyDiscoveryError(`${label}未返回有效数据，请检查主线路是否为 Emby 基础地址`);
  }
}

function parseLines(data: Record<string, unknown>): DiscoveredLines {
  if (data.ok !== true || !Array.isArray(data.data))
    throw new EmbyDiscoveryError('备用线路接口未返回有效列表');
  if (data.data.length > MAX_DISCOVERED_LINES)
    throw new EmbyDiscoveryError(`备用线路接口返回超过 ${MAX_DISCOVERED_LINES} 条线路`);
  const lines: Endpoint[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of data.data) {
    try {
      const row = object(entry);
      const url = baseURL(row.url);
      const name = text(row.name, '线路名称', 100);
      if (seen.has(url)) continue;
      seen.add(url);
      lines.push({ url, ...(name ? { name } : {}) });
    } catch {
      skipped++;
    }
  }
  return { lines, skipped };
}

/** Only the configured primary receives credentials. Returned lines are data,
 * never additional login targets. Tokens are request-local and never exported. */
export async function discoverEmbyLines(
  connection: ReturnType<typeof discoveryInput>,
  deviceId: string,
): Promise<DiscoveredLines> {
  const bases = /\/emby$/i.test(connection.url)
    ? [connection.url]
    : [`${connection.url}/emby`, connection.url];
  const headers: Record<string, string> = {
    'User-Agent': EMBY_USER_AGENT,
    Accept: 'application/json',
    'X-Emby-Authorization': `Emby Client="LibraManager", Device="LibraManager", DeviceId="${deviceId}", Version="0.1.0"`,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let token = '';
  let authenticatedBase = '';
  async function request(url: string, method = 'GET', body?: string): Promise<Response> {
    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { 'X-Emby-Token': token } : {}),
      },
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new EmbyDiscoveryError('主线路发生重定向，请填写最终服务器地址后重试', 422);
    }
    return response;
  }
  try {
    for (const base of bases) {
      const response = await request(
        `${base}/Users/AuthenticateByName`,
        'POST',
        JSON.stringify({ Username: connection.username, Pw: connection.password }),
      );
      if ([404, 405].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new EmbyDiscoveryError('Emby 登录失败，请检查用户名和密码', 422);
        if (response.status === 403)
          throw new EmbyDiscoveryError(
            '主线路拒绝登录，请检查账号权限及 LibraManager 白名单；DeviceId 可在「客户端身份」中查看',
            422,
          );
        if (response.status === 429) throw new EmbyDiscoveryError('Emby 登录过于频繁，请稍后重试', 429);
        throw new EmbyDiscoveryError(`Emby 登录暂时不可用（HTTP ${response.status}）`);
      }
      const data = await responseJSON(response, 'Emby 登录接口');
      if (typeof data.AccessToken !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(data.AccessToken))
        throw new EmbyDiscoveryError('Emby 登录未返回有效 Token');
      token = data.AccessToken;
      authenticatedBase = base;
      break;
    }
    if (!token) throw new EmbyDiscoveryError('主线路未提供 Emby 登录接口，请检查基础地址', 422);
    // Some reverse proxies expose Emby login at the root but the extension at
    // /emby. Try only those two paths under the originally supplied base path.
    for (const base of [authenticatedBase, ...bases.filter((base) => base !== authenticatedBase)]) {
      const response = await request(`${base}/System/Ext/ServerDomains`);
      if ([404, 405].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status))
          throw new EmbyDiscoveryError('已登录 Emby，但备用线路接口拒绝访问，请检查服务器权限', 422);
        if (response.status === 429) throw new EmbyDiscoveryError('备用线路请求过于频繁，请稍后重试', 429);
        throw new EmbyDiscoveryError(`备用线路暂时不可用（HTTP ${response.status}）`);
      }
      return parseLines(await responseJSON(response, '备用线路接口'));
    }
    throw new EmbyDiscoveryError('这台服务器未提供备用线路接口，仍可手动添加线路', 422);
  } catch (error) {
    if (error instanceof EmbyDiscoveryError) throw error;
    if (controller.signal.aborted) throw new EmbyDiscoveryError('获取备用线路超时，请稍后重试', 504);
    throw new EmbyDiscoveryError('无法连接主线路，请检查地址和服务器访问限制');
  } finally {
    clearTimeout(timeout);
    if (token) {
      // Best-effort cleanup of this tool's session; no retry/login loop and no
      // upstream body or exception text in logs. A failed logout cannot discard
      // an otherwise valid list (some servers disable this endpoint).
      const cleanup = new AbortController();
      const cleanupTimeout = setTimeout(() => cleanup.abort(), 2_000);
      try {
        const response = await fetch(`${authenticatedBase}/Sessions/Logout`, {
          method: 'POST',
          headers: { ...headers, 'X-Emby-Token': token },
          redirect: 'manual',
          signal: cleanup.signal,
        });
        await response.body?.cancel();
      } catch {
        /* The token is never retained locally. */
      } finally {
        clearTimeout(cleanupTimeout);
      }
    }
  }
}
