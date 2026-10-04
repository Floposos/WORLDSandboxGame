import type { WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer } from '3d-tiles-renderer/three';
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  UnloadTilesPlugin,
} from '3d-tiles-renderer/plugins';
import type { Settings } from '../../core/settings';
import type { AttributionEntry } from '../../core/types';
import { TilesProviderBase } from './TilesProviderBase';

/** Draco-Decoder vom offiziellen Google-CDN (vermeidet Binärdateien im Repo). */
export const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

/**
 * Google Photorealistic 3D Tiles (Map Tiles API, nur mit eigenem Key).
 * Kein persistentes Caching: es wird nur der Speicher-LRU des TilesRenderer genutzt.
 */
export class GoogleTilesProvider extends TilesProviderBase {
  readonly id = 'google' as const;
  readonly label = 'Google Photorealistic 3D Tiles';
  readonly requiresKey = true;
  readonly supportsBuildingsInMesh = true;

  /**
   * Nur Key-Prüfung ohne Netz: Jede root.json-Anfrage startet eine abrechenbare Session.
   * Der eigentliche Test-Request ist das Laden der Wurzel in attach() (ADR-013).
   */
  isAvailable(settings: Settings): Promise<boolean> {
    return Promise.resolve(settings.keys.googleMapsKey.trim().length > 0);
  }

  protected createTilesets(settings: Settings, _renderer: WebGLRenderer): TilesRenderer[] {
    const tiles = new TilesRenderer();
    tiles.registerPlugin(
      new GoogleCloudAuthPlugin({
        apiToken: settings.keys.googleMapsKey.trim(),
        autoRefreshToken: true,
      }),
    );
    const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    return [tiles];
  }

  attributions(): AttributionEntry[] {
    const fromTiles = this.pluginAttributions('google');
    return fromTiles.length > 0 ? fromTiles : [{ id: 'google', text: 'Google' }];
  }
}
