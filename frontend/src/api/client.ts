/**
 * The single HTTP client for the web app. It speaks the same REST API the
 * mobile app uses: Bearer access token in memory, refresh token in an
 * httpOnly cookie (web). Expired access tokens are refreshed once, silently.
 *
 * Every response has the envelope { success, data, message, meta? } or
 * { success: false, message, error, details? }.
 */

import type { SessionUser } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
  meta?: PageMeta;
}

export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field → message map for form validation errors. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    // Some errors carry a details object (e.g. who holds a device), not field errors.
    for (const d of Array.isArray(this.details) ? this.details : []) if (d.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }
}

let accessToken: string | null = null;
let onSessionEnded: (() => void) | null = null;
export interface SessionPayload {
  accessToken: string;
  user: SessionUser;
}
let refreshing: Promise<SessionPayload | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function onSessionExpired(fn: () => void) {
  onSessionEnded = fn;
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(params?: Params) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'All') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function parse(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, message: text.slice(0, 200), error: 'INVALID_RESPONSE' };
  }
}

/** Obtains a new access token from the refresh cookie. Concurrent callers share one request. */
export async function refreshAccessToken(): Promise<SessionPayload | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'web' },
          body: '{}',
        });
        const body = await parse(res);
        if (!res.ok || !body?.success) return null;
        accessToken = body.data.accessToken;
        return body.data as SessionPayload;
      } catch {
        return null;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions {
  params?: Params;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  raw?: boolean; // return the Response (downloads)
  /** Overrides the default timeout (30 s; 120 s for uploads), e.g. for AI calls that take minutes. */
  timeoutMs?: number;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<Envelope<T>> {
  const headers: Record<string, string> = { 'X-Client-Type': 'web' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? (opts.form ? 120_000 : 30_000));
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    res = await fetch(`${API_BASE}${path}${buildQuery(opts.params)}`, { method, headers, body, credentials: 'include', signal });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(method, path, opts, true);
    accessToken = null;
    onSessionEnded?.();
  }

  if (opts.raw && res.ok) return { success: true, data: res as unknown as T, message: 'OK' };

  const json = await parse(res);
  if (!res.ok || !json?.success) {
    throw new ApiError(res.status, json?.error ?? 'HTTP_' + res.status, json?.message ?? `Request failed (${res.status})`, json?.details);
  }
  return json as Envelope<T>;
}

export const api = {
  get: async <T>(path: string, params?: Params, signal?: AbortSignal) => (await request<T>('GET', path, { params, signal })).data,
  getPaged: async <T>(path: string, params?: Params, signal?: AbortSignal): Promise<Paged<T>> => {
    const r = await request<T[]>('GET', path, { params, signal });
    return { rows: r.data, meta: r.meta ?? { page: 1, pageSize: r.data.length, total: r.data.length, totalPages: 1 } };
  },
  post: async <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: async <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: async <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: async <T>(path: string) => request<T>('DELETE', path),
  upload: async <T>(path: string, form: FormData, timeoutMs?: number) => request<T>('POST', path, { form, timeoutMs }),
  /** POST that may run for minutes (AI drafting/testing); default 10 minutes. */
  postLong: async <T>(path: string, body?: unknown, timeoutMs = 600_000) => request<T>('POST', path, { body: body ?? {}, timeoutMs }),
  /** A protected binary (e.g. an image) as a Blob, for object URLs. */
  blob: async (path: string, signal?: AbortSignal) => (await (await request<Response>('GET', path, { raw: true, signal })).data.blob()),
  /** Downloads a protected file and saves it with the server-provided name. */
  download: async (path: string, fallbackName = 'download') => {
    const r = await request<Response>('GET', path, { raw: true });
    const res = r.data;
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
