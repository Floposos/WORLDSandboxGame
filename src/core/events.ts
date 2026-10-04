import type { GeoPoint, Vec3, WeatherState } from './types';

/** Alle Spielereignisse mit ihren Payloads. */
export type GameEvents = {
  /**
   * Der lokale Ursprung wurde verschoben. `matrix` (4×4, spaltenweise) bildet alte lokale
   * Koordinaten auf neue ab; `deltaLocal` ist die Verschiebung eines Punkts am alten Ursprung.
   */
  originShifted: { origin: GeoPoint; newOriginEcef: Vec3; deltaLocal: Vec3; matrix: number[] };
  toolSelected: { toolId: string };
  impact: { posLocal: Vec3; energyJ: number; source: string };
  explosion: { posLocal: Vec3; tntEquivalentKg: number; airburstHeightM: number };
  buildingDestroyed: { osmId: number; fraction: number };
  craterCreated: { center: GeoPoint; radiusM: number; depthM: number };
  providerChanged: { providerId: string; reason: string };
  weatherChanged: { state: WeatherState };
  statsUpdated: { bodies: number; particles: number; destroyedBuildings: number };
};

type Handler<T> = (payload: T) => void;

/**
 * Typisierter, synchroner EventBus. Ein Fehler in einem Listener wird geloggt
 * und bricht die Zustellung an die übrigen Listener nicht ab.
 */
export class EventBus<E extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    // Kopie, damit on/off während der Zustellung sicher ist.
    for (const handler of [...set]) {
      try {
        (handler as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[events] Listener für "${String(type)}" ist fehlgeschlagen`, err);
      }
    }
  }

  listenerCount<K extends keyof E>(type: K): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const createGameEvents = (): EventBus<GameEvents> => new EventBus<GameEvents>();
