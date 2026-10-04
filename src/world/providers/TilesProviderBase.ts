import {
  Raycaster,
  Vector3,
  type Camera,
  type Intersection,
  type Ray,
  type WebGLRenderer,
} from 'three';
import type { TilesRenderer } from '3d-tiles-renderer/three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import type { Settings } from '../../core/settings';
import type { AttributionEntry } from '../../core/types';
import {
  ProviderError,
  type ProviderContext,
  type ProviderId,
  type TileProvider,
  type WorldHit,
} from './TileProvider';

const ROOT_TIMEOUT_MS = 20_000;
/** So viele Auth-/Quota-Fehler beim Tile-Laden lösen zur Laufzeit einen Provider-Wechsel aus. */
const RUNTIME_FAILURE_THRESHOLD = 3;

/** Wiederholung fehlgeschlagener Kacheln: Startverzögerung, Obergrenze, Ruhezeit bis zum Zurücksetzen. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
const RETRY_QUIET_MS = 60_000;

const _raycaster = new Raycaster();
const _cart = { lat: 0, lon: 0, height: 0 };
const _local = new Vector3();

/** HTTP-Status aus einer 3d-tiles-renderer-Fehlermeldung lesen (z. B. "with status 403"). */
export function statusFromError(error: unknown): number | null {
  const msg = error instanceof Error ? error.message : String(error);
  const m = /(?:status|error code)\s+(\d{3})/i.exec(msg);
  return m ? Number(m[1]) : null;
}

export function reasonFromStatus(status: number | null): ProviderError['reason'] {
  if (status === 400 || status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'quota';
  if (status === null) return 'network';
  return 'other';
}

/** Lohnt sich ein erneuter Versuch? Netzfehler, 408, 429 und 5xx ja; 404 und Auth-Fehler nein. */
export function isRetryableStatus(status: number | null): boolean {
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Wartezeit vor dem n-ten erneuten Versuch (0-basiert), exponentiell bis RETRY_MAX_MS. */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
}

/**
 * Wie `TilesRenderer.resetFailedTiles()`, übersteht aber Kacheln ohne `internal` (noch nicht
 * vorverarbeitete Kinder). Das Original wirft dort in 3d-tiles-renderer 0.5.3 einen TypeError.
 */
export function resetFailedTilesSafely(tiles: TilesRenderer): void {
  const FAILED = -1;
  const UNLOADED = 0;
  const t = tiles as unknown as {
    rootLoadingState: number;
    stats: { failed: number };
    traverse(
      cb: (tile: { internal?: { loadingState: number } }) => void,
      after: null,
      ensure: boolean,
    ): void;
  };
  if (t.rootLoadingState === FAILED) t.rootLoadingState = UNLOADED;
  if (t.stats.failed === 0) return;
  t.traverse(
    (tile) => {
      if (tile.internal?.loadingState === FAILED) tile.internal.loadingState = UNLOADED;
    },
    null,
    false,
  );
  t.stats.failed = 0;
}

/**
 * Gemeinsame Logik für Provider auf Basis eines oder mehrerer {@link TilesRenderer}:
 * Einhängen, Warten auf die Wurzel, Raycast, Fehlerzählung.
 */
export abstract class TilesProviderBase implements TileProvider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;
  abstract readonly requiresKey: boolean;
  abstract readonly supportsBuildingsInMesh: boolean;

  protected tilesets: TilesRenderer[] = [];
  protected renderer: WebGLRenderer | null = null;
  protected camera: Camera | null = null;
  private failureHandlers: ((e: ProviderError) => void)[] = [];
  private runtimeFailures = 0;
  private failed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private lastRetryAt = 0;
  private errorTarget = 20;
  /**
   * Faktor auf das errorTarget des Grafik-Presets. Bild-basierte Höhenkacheln (Terrarium)
   * rechnen den Fehler pro Texel und brauchen deutlich kleinere Werte als echte 3D-Tiles.
   */
  protected errorTargetScale = 1;

  abstract isAvailable(settings: Settings): Promise<boolean>;
  abstract attributions(): AttributionEntry[];

  /** Erzeugt die TilesRenderer (mit Plugins). Der erste ist die „Haupt“-Quelle. */
  protected abstract createTilesets(settings: Settings, renderer: WebGLRenderer): TilesRenderer[];

  async attach(ctx: ProviderContext, settings: Settings): Promise<void> {
    this.renderer = ctx.renderer;
    this.camera = ctx.camera;
    this.tilesets = this.createTilesets(settings, ctx.renderer);
    for (const tiles of this.tilesets) {
      tiles.errorTarget = this.errorTarget * this.errorTargetScale;
      tiles.setCamera(ctx.camera);
      tiles.setResolutionFromRenderer(ctx.camera, ctx.renderer);
      ctx.globe.add(tiles.group);
      tiles.addEventListener('load-error', ({ error }) => this.handleLoadError(error));
    }
    const main = this.tilesets[0];
    if (!main) throw new ProviderError(this.id, 'other', 'Keine Tiles konfiguriert');
    try {
      await this.waitForRoot(main);
    } catch (err) {
      this.detach();
      throw err;
    }
  }

  private waitForRoot(tiles: TilesRenderer): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err?: ProviderError): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        tiles.removeEventListener('load-root-tileset', onRoot);
        tiles.removeEventListener('load-error', onError);
        if (err) reject(err);
        else resolve();
      };
      const onRoot = (): void => finish();
      const onError = ({ tile, error }: { tile: unknown; error: Error }): void => {
        // Nur Fehler beim Laden der Wurzel sind hier fatal.
        if (tile !== null && tile !== tiles.root) return;
        const status = statusFromError(error);
        finish(new ProviderError(this.id, reasonFromStatus(status), error.message));
      };
      const timer = setTimeout(
        () => finish(new ProviderError(this.id, 'timeout', 'Zeitüberschreitung beim Laden')),
        ROOT_TIMEOUT_MS,
      );
      tiles.addEventListener('load-root-tileset', onRoot);
      tiles.addEventListener('load-error', onError);
      // Ohne update() startet das Laden nicht.
      tiles.update();
    });
  }

  private handleLoadError(error: Error): void {
    const status = statusFromError(error);
    if (isRetryableStatus(status)) this.scheduleRetry();
    const reason = reasonFromStatus(status);
    if (reason !== 'unauthorized' && reason !== 'quota') return;
    this.runtimeFailures++;
    if (this.runtimeFailures >= RUNTIME_FAILURE_THRESHOLD && !this.failed) {
      this.failed = true;
      const providerError = new ProviderError(this.id, reason, error.message);
      for (const h of this.failureHandlers) h(providerError);
    }
  }

  /**
   * 3d-tiles-renderer lädt eine fehlgeschlagene Kachel nie neu. Ohne Wiederholung bleibt nach einem
   * kurzen Netzaussetzer z. B. das Gelände flach (Höhenkachel fehlt). Daher nach Netz-/Serverfehlern
   * mit wachsender Pause `resetFailedTiles()` aufrufen.
   */
  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.failed) return;
    const now = Date.now();
    if (now - this.lastRetryAt > RETRY_QUIET_MS) this.retryAttempt = 0;
    const delay = retryDelayMs(this.retryAttempt++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.lastRetryAt = Date.now();
      for (const tiles of this.tilesets) resetFailedTilesSafely(tiles);
    }, delay);
  }

  onFailure(handler: (error: ProviderError) => void): void {
    this.failureHandlers.push(handler);
  }

  detach(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const tiles of this.tilesets) {
      tiles.group.removeFromParent();
      tiles.dispose();
    }
    this.tilesets = [];
    this.failureHandlers = [];
  }

  update(): void {
    const { renderer, camera } = this;
    if (!renderer || !camera) return;
    for (const tiles of this.tilesets) {
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
    }
  }

  setErrorTarget(px: number): void {
    this.errorTarget = px;
    for (const tiles of this.tilesets) tiles.errorTarget = px * this.errorTargetScale;
  }

  raycast(ray: Ray): WorldHit | null {
    const main = this.tilesets[0];
    if (!main) return null;
    _raycaster.ray.copy(ray);
    // Alle Tilesets (bei Cesium: Gelände + Gebäude), nächster Treffer gewinnt.
    let hit: Intersection | undefined;
    for (const tiles of this.tilesets) {
      const h = _raycaster.intersectObject(tiles.group, true)[0];
      if (h && (!hit || h.distance < hit.distance)) hit = h;
    }
    if (!hit) return null;
    _local.copy(hit.point).applyMatrix4(main.group.matrixWorldInverse);
    WGS84_ELLIPSOID.getPositionToCartographic(_local, _cart);
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : null;
    return {
      point: hit.point.clone(),
      normal,
      distance: hit.distance,
      geo: {
        lat: (_cart.lat * 180) / Math.PI,
        lon: (_cart.lon * 180) / Math.PI,
        height: _cart.height,
      },
    };
  }

  sampleHeight(_lat: number, _lon: number): number | null {
    return null;
  }

  /** Attributionen der Plugins (Google-Copyrights, Cesium-Credits) als Text. */
  protected pluginAttributions(prefix: string): AttributionEntry[] {
    const out: AttributionEntry[] = [];
    for (const tiles of this.tilesets) {
      for (const [i, a] of tiles.getAttributions().entries()) {
        if (a.type === 'string' && typeof a.value === 'string' && a.value.trim()) {
          out.push({ id: `${prefix}-${i}`, text: a.value.trim() });
        } else if (a.type === 'image' && typeof a.value === 'string') {
          out.push({ id: `${prefix}-logo-${i}`, text: '', imageUrl: a.value });
        } else if (a.type === 'html' && typeof a.value === 'string') {
          // SIMPLIFIED: HTML-Credits (Cesium) werden als Text ohne Markup angezeigt.
          const text = a.value
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) out.push({ id: `${prefix}-${i}`, text });
        }
      }
    }
    return out;
  }
}
