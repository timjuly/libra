import { InputError } from '../shared/validation';

export const GITHUB_SETTINGS_KEY = 'settings:github:v1';
export class GitHubTokenError extends Error {
  name = 'GitHubTokenError';
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export async function verifyGitHubToken(token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Libra-Icon-Libraries',
        'X-GitHub-Api-Version': '2026-03-10',
        Authorization: `Bearer ${token}`,
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.status === 401) throw new GitHubTokenError('GitHub Token 无效或已过期');
    if (response.status !== 200)
      throw new GitHubTokenError('GitHub 暂时无法验证此 Token，请检查权限或稍后重试');
  } catch (error) {
    if (error instanceof GitHubTokenError) throw error;
    throw new GitHubTokenError('无法连接 GitHub 验证 Token，请稍后重试', 502);
  } finally {
    clearTimeout(timeout);
  }
}
export interface GitHubSettings {
  token?: string;
  version: string;
  updatedAt: string;
}

export function validateGitHubToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(value.trim()))
    throw new InputError('请填写有效的 GitHub Token，不能包含空白或换行');
  return value.trim();
}

export function isGitHubContentAPI(url: URL): boolean {
  return (
    url.origin === 'https://api.github.com' &&
    !url.username &&
    !url.password &&
    /^\/(?:repos\/[^/]+\/[^/]+|repositories\/[1-9]\d*)\/contents\/.+/.test(url.pathname)
  );
}

/** Map public raw/blob URLs to the read-only GitHub contents API. */
export function githubContentURL(source: string): string | null {
  const url = new URL(source);
  if (isGitHubContentAPI(url)) return url.href;
  if (!['raw.githubusercontent.com', 'github.com'].includes(url.hostname)) return null;
  const parts = url.pathname.slice(1).split('/');
  const [owner, repo] = parts;
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner + repo)) return null;
  let rest = parts.slice(2);
  if (url.hostname === 'github.com') {
    if (!['blob', 'raw'].includes(rest[0])) return null;
    rest = rest.slice(1);
  }
  if (rest[0] === 'refs' && ['heads', 'tags'].includes(rest[1])) rest = rest.slice(2);
  const [ref, ...path] = rest;
  if (!ref || !path.length || path.some((part) => !part)) return null;
  try {
    const target = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path.join('/')}`);
    target.searchParams.set('ref', decodeURIComponent(ref));
    return isGitHubContentAPI(target) ? target.href : null;
  } catch {
    return null;
  }
}

/** Preserve the original ref/path boundary, which is ambiguous for slash refs. */
export function githubRawURL(source: string): string | null {
  const url = new URL(source);
  if (url.hostname === 'raw.githubusercontent.com') return url.href;
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/(blob|raw)\/.+/.test(url.pathname)) {
    url.hostname = 'raw.githubusercontent.com';
    url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/(?:blob|raw)\//, '$1/');
    return url.href;
  }
  const match = isGitHubContentAPI(url) && url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
  if (match) {
    // Raw URLs keep slash refs as path segments, just like GitHub's download_url.
    const ref = (url.searchParams.get('ref') || 'HEAD').split('/').map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${ref}/${match[3]}`;
  }
  return null;
}

export function githubRequestHeaders(url: string, token?: string): Record<string, string> {
  if (!isGitHubContentAPI(new URL(url))) return { Accept: 'application/json' };
  return {
    Accept: 'application/vnd.github.raw+json',
    'User-Agent': 'Libra-Icon-Libraries',
    'X-GitHub-Api-Version': '2026-03-10',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
