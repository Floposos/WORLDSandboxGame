import { Raycaster, Vector3, type Ray, type WebGLRenderer, type Camera } from 'three';
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
    const reason = reasonFromStatus(statusFromError(error));
    if (reason !== 'unauthorized' && reason !== 'quota') return;
    this.runtimeFailures++;
    if (this.runtimeFailures >= RUNTIME_FAILURE_THRESHOLD && !this.failed) {
      this.failed = true;
      const providerError = new ProviderError(this.id, reason, error.message);
      for (const h of this.failureHandlers) h(providerError);
    }
  }

  onFailure(handler: (error: ProviderError) => void): void {
    this.failureHandlers.push(handler);
  }

  detach(): void {
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
    const hits = _raycaster.intersectObject(main.group, true);
    const hit = hits[0];
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
