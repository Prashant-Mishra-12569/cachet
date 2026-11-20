/** Error with a message that is safe and friendly to show to people. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FALLBACK = "We couldn't reach Cachet. Check your internet and try again.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('network', FALLBACK, 0);
  }
  const body = (await res.json().catch(() => null)) as
    (T & { error?: undefined }) | { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const error = body && 'error' in body ? body.error : undefined;
    throw new ApiError(error?.code ?? 'unknown', error?.message ?? FALLBACK, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, headers ? { headers } : undefined),
  post: <T>(path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
};
