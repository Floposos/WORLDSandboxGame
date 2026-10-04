import { describe, expect, it, vi } from 'vitest';
import {
  Geocoder,
  reversePhoton,
  SEARCH_DEBOUNCE_MS,
  searchNominatim,
  searchPhoton,
} from '../../src/world/geocoder';
import { RateLimiter } from '../../src/core/net';
import type { FetchLike } from '../../src/core/net';
import photonFixture from '../fixtures/photon-zugspitze.json';
import nominatimFixture from '../fixtures/nominatim-zugspitze.json';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const noSleep = (): Promise<void> => Promise.resolve();
const limiter = (): RateLimiter => new RateLimiter(0, { now: () => 0, sleep: noSleep });

function routed(photon: () => Response, nominatim: () => Response) {
  return vi.fn<FetchLike>((url) =>
    Promise.resolve(url.startsWith('https://photon.komoot.io') ? photon() : nominatim()),
  );
}

const base = (f: FetchLike) => ({ fetchImpl: f, sleep: noSleep, limiter: limiter() });

describe('searchPhoton', () => {
  it('builds the URL and parses features', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(photonFixture));
    const r = await searchPhoton('Zugspitze Bayern', { fetchImpl: f });
    expect(f.mock.calls[0]?.[0]).toBe('https://photon.komoot.io/api/?q=Zugspitze%20Bayern&limit=5');
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({
      name: 'Zugspitze',
      label: 'Zugspitze, Garmisch-Partenkirchen, Bayern, Deutschland',
      lat: 47.4211,
      lon: 10.9853,
      kind: 'peak',
      extent: [10.9753, 47.4111, 10.9953, 47.4311],
    });
  });

  it('builds a label from street and housenumber and skips duplicates', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(photonFixture));
    const r = await searchPhoton('x', { fetchImpl: f });
    expect(r[1]?.name).toBe('Zugspitzstraße 5');
    expect(r[1]?.label).toBe('Zugspitzstraße 5, Garmisch-Partenkirchen, Bayern, Deutschland');
    expect(r[1]?.extent).toBeUndefined();
    expect(r[2]?.label).toBe('Bayern, Deutschland');
  });

  it('adds lang only for de/en', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json(photonFixture)));
    await searchPhoton('a', { fetchImpl: f, lang: 'de' });
    await searchPhoton('a', { fetchImpl: f, lang: 'en' });
    await searchPhoton('a', { fetchImpl: f, lang: 'es' });
    expect(f.mock.calls[0]?.[0]).toMatch(/&lang=de$/);
    expect(f.mock.calls[1]?.[0]).toMatch(/&lang=en$/);
    expect(f.mock.calls[2]?.[0]).not.toContain('lang=');
  });

  it('returns [] for malformed payloads and skips bad features', async () => {
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json({ nope: 1 }))
      .mockResolvedValueOnce(
        json({ features: [{ geometry: { coordinates: ['a', 'b'] }, properties: {} }] }),
      );
    expect(await searchPhoton('x', { fetchImpl: f })).toEqual([]);
    expect(await searchPhoton('x', { fetchImpl: f })).toEqual([]);
  });
});

describe('searchNominatim', () => {
  it('parses strings and normalises the bounding box', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(nominatimFixture));
    const r = await searchNominatim('Zugspitze', { fetchImpl: f, lang: 'de', limiter: limiter() });
    expect(f.mock.calls[0]?.[0]).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=Zugspitze&accept-language=de',
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: 'Zugspitze',
      lat: 47.421,
      lon: 10.9852,
      kind: 'peak',
      extent: [10.9752, 47.411, 10.9952, 47.431],
    });
    expect(r[0]?.label).toContain('Deutschland');
  });

  it('goes through the rate limiter', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json([])));
    let t = 0;
    const sleep = vi.fn((ms: number) => {
      t += ms;
      return Promise.resolve();
    });
    const rl = new RateLimiter(1100, { now: () => t, sleep });
    await Promise.all([
      searchNominatim('aa', { fetchImpl: f, limiter: rl }),
      searchNominatim('bb', { fetchImpl: f, limiter: rl }),
    ]);
    expect(sleep).toHaveBeenCalledWith(1100);
  });
});

describe('reversePhoton', () => {
  it('returns the first result', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(photonFixture));
    const r = await reversePhoton(47.42, 10.98, { fetchImpl: f });
    expect(f.mock.calls[0]?.[0]).toBe('https://photon.komoot.io/reverse?lat=47.42&lon=10.98');
    expect(r?.name).toBe('Zugspitze');
  });

  it('returns null without features', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json({ features: [] }));
    expect(await reversePhoton(0, 0, { fetchImpl: f })).toBeNull();
  });
});

describe('Geocoder', () => {
  it('exports the debounce constant', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(400);
  });

  it('returns [] for short queries without fetching', async () => {
    const f = vi.fn<FetchLike>();
    const g = new Geocoder(base(f));
    expect(await g.search('')).toEqual([]);
    expect(await g.search(' a ')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('uses Photon first and does not call Nominatim', async () => {
    const f = routed(
      () => json(photonFixture),
      () => json(nominatimFixture),
    );
    const r = await new Geocoder(base(f)).search('  Zugspitze ');
    expect(r[0]?.name).toBe('Zugspitze');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toContain('q=Zugspitze&');
  });

  it('falls back to Nominatim when Photon fails', async () => {
    const f = routed(
      () => json({}, 400),
      () => json(nominatimFixture),
    );
    const r = await new Geocoder(base(f)).search('Zugspitze');
    expect(r).toHaveLength(1);
    expect(r[0]?.kind).toBe('peak');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back to Nominatim on network errors from Photon', async () => {
    const f = vi.fn<FetchLike>((url) =>
      url.startsWith('https://photon.komoot.io')
        ? Promise.reject(new TypeError('offline'))
        : Promise.resolve(json(nominatimFixture)),
    );
    const r = await new Geocoder(base(f)).search('Zugspitze');
    expect(r).toHaveLength(1);
  });

  it('falls back to Nominatim on empty Photon result', async () => {
    const f = routed(
      () => json({ type: 'FeatureCollection', features: [] }),
      () => json(nominatimFixture),
    );
    const r = await new Geocoder(base(f)).search('Zugspitze');
    expect(r).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('propagates errors when both providers fail', async () => {
    const f = routed(
      () => json({}, 400),
      () => json({}, 400),
    );
    await expect(new Geocoder(base(f)).search('Zugspitze')).rejects.toThrow();
  });

  it('does not fall back when aborted', async () => {
    const f = vi.fn<FetchLike>().mockResolvedValue(json(photonFixture));
    const err = await new Geocoder(base(f))
      .search('Zugspitze', AbortSignal.abort())
      .catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(f).not.toHaveBeenCalled();
  });

  it('caches by lower-cased trimmed query', async () => {
    const f = routed(
      () => json(photonFixture),
      () => json([]),
    );
    const g = new Geocoder(base(f));
    const a = await g.search('Zugspitze');
    const b = await g.search('  zugSPITZE ');
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used entry beyond 50', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json(photonFixture)));
    const g = new Geocoder(base(f));
    for (let i = 0; i < 51; i++) await g.search(`query ${i}`);
    expect(f).toHaveBeenCalledTimes(51);
    await g.search('query 50');
    expect(f).toHaveBeenCalledTimes(51);
    await g.search('query 0');
    expect(f).toHaveBeenCalledTimes(52);
  });

  it('caches reverse lookups by coordinates rounded to 3 decimals', async () => {
    const f = vi.fn<FetchLike>().mockImplementation(() => Promise.resolve(json(photonFixture)));
    const g = new Geocoder(base(f));
    const a = await g.reverse(47.42101, 10.98501);
    const b = await g.reverse(47.42104, 10.98496);
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    await g.reverse(47.43, 10.98);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
