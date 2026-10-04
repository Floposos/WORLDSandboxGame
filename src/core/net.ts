/** Netzwerk-Helfer: fetchJson mit Timeout/Retry sowie ein RateLimiter. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export interface FetchJsonOptions {
  /** Timeout pro Versuch in ms (Standard 10000). */
  timeoutMs?: number;
  /** Gesamtzahl Versuche (Standard 3). */
  attempts?: number;
  /** Basis-Wartezeit in ms, verdoppelt sich je Versuch (Standard 500). */
  baseDelayMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  sleep?: SleepFn;
  /** Liefert Werte in [0, 1) für den Jitter. */
  random?: () => number;
}

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After');
  if (raw === null) return undefined;
  const secs = Number(raw.trim());
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

/** GET + JSON mit Timeout, Retry (Netzfehler, 429, 5xx) und Backoff. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 500;
  const doFetch: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const ext = opts.signal;

  let lastError: Error = new NetworkError('no attempt made');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (ext?.aborted) throw abortError();
    const ctrl = new AbortController();
    const onAbort = (): void => ctrl.abort();
    ext?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);

    let waitMs = base * 2 ** (attempt - 1) + random() * base;
    try {
      const res = await doFetch(url, {
        signal: ctrl.signal,
        ...(opts.headers ? { headers: opts.headers } : {}),
      });
      if (res.ok) return (await res.json()) as T;
      lastError = new HttpError(res.status, url);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw lastError;
      if (res.status === 429) waitMs = retryAfterMs(res) ?? waitMs;
    } catch (e) {
      if (ext?.aborted) throw abortError();
      if (e instanceof HttpError) {
        if (e.status !== 429 && e.status < 500) throw e;
      } else if (timedOut) {
        lastError = new NetworkError(`timeout after ${timeoutMs} ms`, { cause: e });
      } else {
        lastError = new NetworkError(e instanceof Error ? e.message : 'network error', {
          cause: e,
        });
      }
    } finally {
      clearTimeout(timer);
      ext?.removeEventListener('abort', onAbort);
    }
    if (attempt < attempts) {
      await sleep(waitMs);
      if (ext?.aborted) throw abortError();
    }
  }
  throw lastError;
}

export interface RateLimiterOptions {
  now?: () => number;
  sleep?: SleepFn;
}

/** Serialisiert Aufrufe; zwischen zwei Starts liegen mindestens minIntervalMs. */
export class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private readonly now: () => number;
  private readonly sleep: SleepFn;

  constructor(
    private readonly minIntervalMs: number,
    opts: RateLimiterOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = this.lastStart + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return fn();
    };
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => undefined);
    return p;
  }
}
