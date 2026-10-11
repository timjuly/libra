export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(method !== 'GET'
        ? {
            headers: { 'Content-Type': 'application/json', 'X-Libra-Request': '1' },
            body: JSON.stringify(body ?? {}),
          }
        : {}),
    });
  } catch {
    throw new ApiError('无法连接到服务，请检查网络后重试', 0);
  }
  if (response.status === 401 && !path.startsWith('/api/auth/'))
    window.dispatchEvent(new Event('libra:expired'));
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('服务返回了无效响应，请稍后重试', response.status);
  }
  if (!response.ok) {
    if (
      !retried &&
      response.status === 429 &&
      data &&
      typeof data === 'object' &&
      'code' in data &&
      data.code === 'KV_WRITE_RATE_LIMIT'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      // Retry once with the original record/catalog revisions. Never fetch a
      // fresh revision to force a stale edit past conflict checks.
      return api<T>(path, method, body, true);
    }
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '请求失败，请稍后重试';
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试';
