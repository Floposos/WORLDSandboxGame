import type { EventBus, GameEvents } from '../../core/events';
import type { Settings } from '../../core/settings';
import {
  ProviderError,
  type ProviderContext,
  type ProviderId,
  type TileProvider,
} from './TileProvider';

export const DEFAULT_ORDER: readonly ProviderId[] = ['google', 'cesium-ion', 'open-data'];

/** Reihenfolge der Kette: manuell gewählter Provider zuerst, danach die Standardreihenfolge. */
export function providerOrder(choice: Settings['provider']): ProviderId[] {
  if (choice === 'auto') return [...DEFAULT_ORDER];
  return [choice, ...DEFAULT_ORDER.filter((id) => id !== choice)];
}

export interface ChainNotice {
  providerId: ProviderId;
  /** Provider, der übersprungen wurde oder ausgefallen ist. */
  failedId: ProviderId;
  reason: ProviderError['reason'];
}

export interface ProviderChainOptions {
  providers: readonly TileProvider[];
  events: EventBus<GameEvents>;
  /** Wird aufgerufen, wenn ein Provider mit Key ausfällt (für den Toast). */
  onFallback?: (notice: ChainNotice) => void;
}

/**
 * Fallback-Kette Google → Cesium ion → Open Data (Spezifikation 5.2).
 * Provider ohne Key werden still übersprungen; ein fehlschlagender Provider mit Key
 * löst einen Wechsel samt `providerChanged`-Event und Hinweis aus.
 */
export class ProviderChain {
  private current: TileProvider | null = null;
  private ctx: ProviderContext | null = null;
  private settings: Settings | null = null;
  private generation = 0;

  constructor(private readonly opts: ProviderChainOptions) {}

  get active(): TileProvider | null {
    return this.current;
  }

  private byId(id: ProviderId): TileProvider | undefined {
    return this.opts.providers.find((p) => p.id === id);
  }

  /** Startet bzw. startet die Kette neu (z. B. nach Key-Änderung). */
  async start(ctx: ProviderContext, settings: Settings): Promise<TileProvider> {
    this.ctx = ctx;
    this.settings = settings;
    return this.activateFrom(providerOrder(settings.provider), 'start');
  }

  private async activateFrom(order: ProviderId[], cause: string): Promise<TileProvider> {
    const generation = ++this.generation;
    const { ctx, settings } = this;
    if (!ctx || !settings) throw new Error('ProviderChain nicht gestartet');
    this.current?.detach();
    this.current = null;

    for (const [index, id] of order.entries()) {
      const provider = this.byId(id);
      if (!provider) continue;
      let available: boolean;
      try {
        available = await provider.isAvailable(settings);
      } catch {
        available = false;
      }
      if (!available) {
        // Ohne Key ist das Überspringen erwartet und kein Hinweis wert.
        if (provider.requiresKey && this.hasKey(provider.id, settings)) {
          this.notify(order, index, provider.id, 'unauthorized');
        }
        continue;
      }
      try {
        await provider.attach(ctx, settings);
      } catch (err) {
        const reason = err instanceof ProviderError ? err.reason : 'other';
        if (generation !== this.generation) throw err;
        this.notify(order, index, provider.id, reason);
        continue;
      }
      if (generation !== this.generation) {
        // Inzwischen wurde neu gestartet: dieses Ergebnis verwerfen.
        provider.detach();
        throw new Error('ProviderChain: überholt');
      }
      this.current = provider;
      provider.onFailure((e) => {
        if (this.current !== provider) return;
        const rest = order.slice(index + 1);
        this.notifyRuntime(provider.id, rest[0] ?? 'open-data', e.reason);
        void this.activateFrom(rest, 'runtime-failure').catch(() => undefined);
      });
      this.opts.events.emit('providerChanged', { providerId: provider.id, reason: cause });
      return provider;
    }
    throw new Error('Kein Provider verfügbar');
  }

  private hasKey(id: ProviderId, settings: Settings): boolean {
    if (id === 'google') return settings.keys.googleMapsKey.trim() !== '';
    if (id === 'cesium-ion') return settings.keys.cesiumIonToken.trim() !== '';
    return false;
  }

  private notify(
    order: ProviderId[],
    index: number,
    failedId: ProviderId,
    reason: ChainNotice['reason'],
  ): void {
    const next = order.slice(index + 1).find((id) => this.byId(id)) ?? 'open-data';
    this.opts.onFallback?.({ providerId: next, failedId, reason });
  }

  private notifyRuntime(
    failedId: ProviderId,
    next: ProviderId,
    reason: ChainNotice['reason'],
  ): void {
    this.opts.onFallback?.({ providerId: next, failedId, reason });
  }

  dispose(): void {
    this.generation++;
    this.current?.detach();
    this.current = null;
  }
}
