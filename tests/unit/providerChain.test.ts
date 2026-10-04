import { describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { createGameEvents } from '../../src/core/events';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';
import {
  ProviderChain,
  providerOrder,
  type ChainNotice,
} from '../../src/world/providers/providerChain';
import {
  ProviderError,
  type ProviderContext,
  type ProviderId,
  type TileProvider,
} from '../../src/world/providers/TileProvider';
import { reasonFromStatus, statusFromError } from '../../src/world/providers/TilesProviderBase';
import { pickImagery, IMAGERY_SOURCES } from '../../src/world/providers/OpenDataProvider';

class FakeProvider implements TileProvider {
  readonly supportsBuildingsInMesh = false;
  readonly label: string;
  attached = 0;
  detached = 0;
  failure: ((e: ProviderError) => void) | null = null;

  constructor(
    readonly id: ProviderId,
    readonly requiresKey: boolean,
    private readonly behaviour: 'ok' | ProviderError['reason'],
  ) {
    this.label = id;
  }

  isAvailable(settings: Settings): Promise<boolean> {
    if (this.id === 'google') return Promise.resolve(settings.keys.googleMapsKey !== '');
    if (this.id === 'cesium-ion') return Promise.resolve(settings.keys.cesiumIonToken !== '');
    return Promise.resolve(true);
  }

  attach(): Promise<void> {
    this.attached++;
    if (this.behaviour !== 'ok') {
      return Promise.reject(new ProviderError(this.id, this.behaviour, 'kaputt'));
    }
    return Promise.resolve();
  }

  detach(): void {
    this.detached++;
  }
  update(): void {}
  raycast(): null {
    return null;
  }
  sampleHeight(): null {
    return null;
  }
  attributions(): [] {
    return [];
  }
  onFailure(h: (e: ProviderError) => void): void {
    this.failure = h;
  }
  setErrorTarget(): void {}
}

const ctx: ProviderContext = {
  renderer: {} as WebGLRenderer,
  scene: new Scene(),
  camera: new PerspectiveCamera(),
  globe: new Group(),
};

function settingsWith(
  keys: Partial<Settings['keys']>,
  provider: Settings['provider'] = 'auto',
): Settings {
  return { ...DEFAULT_SETTINGS, provider, keys: { ...DEFAULT_SETTINGS.keys, ...keys } };
}

function setup(google: FakeProvider['behaviour'] = 'ok', cesium: FakeProvider['behaviour'] = 'ok') {
  const providers = {
    google: new FakeProvider('google', true, google),
    cesium: new FakeProvider('cesium-ion', true, cesium),
    open: new FakeProvider('open-data', false, 'ok'),
  };
  const events = createGameEvents();
  const changed = vi.fn();
  events.on('providerChanged', changed);
  const notices: ChainNotice[] = [];
  const chain = new ProviderChain({
    providers: [providers.google, providers.cesium, providers.open],
    events,
    onFallback: (n) => notices.push(n),
  });
  return { providers, chain, changed, notices };
}

describe('providerOrder', () => {
  it('auto = Google → Cesium → Open Data', () => {
    expect(providerOrder('auto')).toEqual(['google', 'cesium-ion', 'open-data']);
  });
  it('manuelle Wahl kommt zuerst', () => {
    expect(providerOrder('open-data')).toEqual(['open-data', 'google', 'cesium-ion']);
  });
});

describe('ProviderChain', () => {
  it('ohne Keys: Open Data ohne Hinweis', async () => {
    const { chain, providers, notices, changed } = setup();
    const p = await chain.start(ctx, settingsWith({}));
    expect(p.id).toBe('open-data');
    expect(providers.google.attached).toBe(0);
    expect(notices).toEqual([]);
    expect(changed).toHaveBeenCalledWith({ providerId: 'open-data', reason: 'start' });
  });

  it('gültiger Google-Key: Google', async () => {
    const { chain } = setup();
    const p = await chain.start(ctx, settingsWith({ googleMapsKey: 'abc' }));
    expect(p.id).toBe('google');
  });

  it('ungültiger Google-Key: Fallback auf Open Data mit Hinweis', async () => {
    const { chain, notices } = setup('unauthorized');
    const p = await chain.start(ctx, settingsWith({ googleMapsKey: 'falsch' }));
    expect(p.id).toBe('open-data');
    expect(notices).toEqual([
      { failedId: 'google', providerId: 'open-data', reason: 'unauthorized' },
    ]);
  });

  it('ungültiger Google-Key, ungültiges Cesium-Token: beide genannt, Open Data aktiv', async () => {
    const { chain, notices } = setup('unauthorized', 'unauthorized');
    const p = await chain.start(ctx, settingsWith({ googleMapsKey: 'g', cesiumIonToken: 'c' }));
    expect(p.id).toBe('open-data');
    expect(notices).toEqual([
      { failedId: 'google', providerId: 'open-data', reason: 'unauthorized' },
      { failedId: 'cesium-ion', providerId: 'open-data', reason: 'unauthorized' },
    ]);
  });

  it('Google-Quota erschöpft, Cesium-Token gültig: Cesium', async () => {
    const { chain, notices } = setup('quota', 'ok');
    const p = await chain.start(ctx, settingsWith({ googleMapsKey: 'k', cesiumIonToken: 't' }));
    expect(p.id).toBe('cesium-ion');
    expect(notices[0]?.reason).toBe('quota');
  });

  it('Laufzeitfehler wechselt auf den nächsten verfügbaren Provider', async () => {
    const { chain, providers, changed, notices } = setup();
    await chain.start(ctx, settingsWith({ googleMapsKey: 'k' }));
    providers.google.failure?.(new ProviderError('google', 'quota', '429'));
    await vi.waitFor(() => expect(chain.active?.id).toBe('open-data'));
    expect(providers.google.detached).toBe(1);
    expect(changed).toHaveBeenLastCalledWith({
      providerId: 'open-data',
      reason: 'runtime-failure',
    });
    // Ohne Cesium-Token nennt der Hinweis Open Data, nicht Cesium.
    expect(notices).toEqual([{ failedId: 'google', providerId: 'open-data', reason: 'quota' }]);
  });

  it('Neustart hängt den alten Provider ab', async () => {
    const { chain, providers } = setup();
    await chain.start(ctx, settingsWith({ googleMapsKey: 'k' }));
    await chain.start(ctx, settingsWith({}));
    expect(providers.google.detached).toBe(1);
    expect(chain.active?.id).toBe('open-data');
  });
});

describe('Fehlerklassifikation', () => {
  it('liest den HTTP-Status aus Fehlermeldungen', () => {
    expect(
      statusFromError(new Error('Failed to load tileset "x" with status 403 : Forbidden')),
    ).toBe(403);
    expect(statusFromError(new Error('Failed to load model with error code 429'))).toBe(429);
    expect(statusFromError(new Error('NetworkError'))).toBeNull();
  });
  it('400/401/403 = ungültiger Key, 429 = Quota', () => {
    expect(reasonFromStatus(400)).toBe('unauthorized');
    expect(reasonFromStatus(403)).toBe('unauthorized');
    expect(reasonFromStatus(429)).toBe('quota');
    expect(reasonFromStatus(null)).toBe('network');
  });
});

describe('pickImagery', () => {
  it('nimmt EOX, wenn erreichbar', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    expect((await pickImagery(f)).id).toBe('eox-s2cloudless-2016');
  });
  it('fällt auf NASA GIBS zurück, wenn EOX ausfällt', async () => {
    const f = vi.fn((url: string | URL | Request) =>
      (url instanceof Request ? url.url : url.toString()).includes('eox')
        ? Promise.reject(new TypeError('offline'))
        : Promise.resolve(new Response('', { status: 200 })),
    );
    expect((await pickImagery(f as typeof fetch)).id).toBe('gibs-blue-marble');
  });
  it('liefert die letzte Quelle, wenn nichts antwortet', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    expect((await pickImagery(f)).id).toBe(IMAGERY_SOURCES.at(-1)?.id);
  });
});
