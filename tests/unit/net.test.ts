import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, HttpError, NetworkError, RateLimiter } from '../../src/core/net';
import type { FetchLike } from '../../src/core/net';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });

const noSleep = (): Promise<void> => Promise.resolve();

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json({ a: 1 }));
    await expect(fetchJson<{ a: number }>('u', { fetchImpl: f })).resolves.toEqual({ a: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and 500, then succeeds, with exponential backoff and jitter', async () => {
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ ok: true }));
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const res = await fetchJson('u', { fetchImpl: f, sleep, random: () => 0.5 });
    expect(res).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([750, 1250]);
  });

  it('does not retry on 404', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json({}, 404));
    const err = await fetchJson('u', { fetchImpl: f, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('throws HttpError after exhausting attempts on 503', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json({}, 503)));
    const err = await fetchJson('u', { fetchImpl: f, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('honours Retry-After (seconds) on 429', async () => {
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    await fetchJson('u', { fetchImpl: f, sleep, random: () => 0 });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('retries network errors and finally throws NetworkError', async () => {
    const f = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await fetchJson('u', { fetchImpl: f, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('respects a custom attempts count', async () => {
    const f = vi.fn<FetchLike>().mockRejectedValue(new TypeError('x'));
    await fetchJson('u', { fetchImpl: f, sleep: noSleep, attempts: 1 }).catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('times out an attempt and retries', async () => {
    vi.useFakeTimers();
    let n = 0;
    const f: FetchLike = (_u, init) => {
      n++;
      if (n > 1) return Promise.resolve(json({ ok: true }));
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
      });
    };
    const p = fetchJson('u', { fetchImpl: f, sleep: noSleep, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it('reports a timeout as NetworkError when all attempts hang', async () => {
    vi.useFakeTimers();
    const f: FetchLike = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
      });
    const p = fetchJson('u', { fetchImpl: f, sleep: noSleep, timeoutMs: 100, attempts: 2 }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(300);
    const err = await p;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain('timeout');
  });

  it('stops immediately when the external signal aborts, without retry', async () => {
    const ctrl = new AbortController();
    const f: FetchLike = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
      });
    const spy = vi.fn(f);
    const p = fetchJson('u', { fetchImpl: spy, sleep: noSleep, signal: ctrl.signal }).catch(
      (e: unknown) => e,
    );
    ctrl.abort();
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws AbortError without fetching if the signal is already aborted', async () => {
    const f = vi.fn<FetchLike>();
    const err = await fetchJson('u', { fetchImpl: f, signal: AbortSignal.abort() }).catch(
      (e: unknown) => e,
    );
    expect((err as Error).name).toBe('AbortError');
    expect(f).not.toHaveBeenCalled();
  });

  it('does not retry if aborted while backing off', async () => {
    const ctrl = new AbortController();
    const f = vi.fn<FetchLike>().mockResolvedValue(json({}, 500));
    const sleep = (): Promise<void> => {
      ctrl.abort();
      return Promise.resolve();
    };
    const err = await fetchJson('u', { fetchImpl: f, sleep, signal: ctrl.signal }).catch(
      (e: unknown) => e,
    );
    expect((err as Error).name).toBe('AbortError');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('RateLimiter', () => {
  it('spaces starts by at least minIntervalMs and serialises', async () => {
    let t = 0;
    const sleep = vi.fn((ms: number) => {
      t += ms;
      return Promise.resolve();
    });
    const rl = new RateLimiter(1000, { now: () => t, sleep });
    const starts: number[] = [];
    const task = (): Promise<number> => {
      starts.push(t);
      return Promise.resolve(starts.length);
    };
    const results = await Promise.all([rl.schedule(task), rl.schedule(task), rl.schedule(task)]);
    expect(results).toEqual([1, 2, 3]);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('does not wait when enough time has passed', async () => {
    let t = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const rl = new RateLimiter(500, { now: () => t, sleep });
    await rl.schedule(() => Promise.resolve(1));
    t = 600;
    await rl.schedule(() => Promise.resolve(2));
    expect(sleep).not.toHaveBeenCalled();
  });

  it('continues after a failing task', async () => {
    const rl = new RateLimiter(0, { now: () => 0, sleep: noSleep });
    await expect(rl.schedule(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(rl.schedule(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
