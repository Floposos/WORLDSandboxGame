import type { WebGLRenderer } from 'three';
import { TilesRenderer } from '3d-tiles-renderer/three';
import {
  CesiumIonAuthPlugin,
  CesiumIonOverlay,
  ImageOverlayPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';
import type { Settings } from '../../core/settings';
import type { AttributionEntry } from '../../core/types';
import { TilesProviderBase } from './TilesProviderBase';

/** Cesium-ion-Assets (Community-Tarif). */
export const CESIUM_ASSETS = {
  worldTerrain: '1',
  bingAerial: '2',
  osmBuildings: '96188',
} as const;

/** Cesium ion: World Terrain + Bildmaterial + OSM Buildings (nur mit eigenem Token). */
export class CesiumIonProvider extends TilesProviderBase {
  readonly id = 'cesium-ion' as const;
  readonly label = 'Cesium ion';
  readonly requiresKey = true;
  readonly supportsBuildingsInMesh = false;

  isAvailable(settings: Settings): Promise<boolean> {
    return Promise.resolve(settings.keys.cesiumIonToken.trim().length > 0);
  }

  protected createTilesets(settings: Settings, renderer: WebGLRenderer): TilesRenderer[] {
    const apiToken = settings.keys.cesiumIonToken.trim();
    const terrain = new TilesRenderer();
    terrain.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken,
        assetId: CESIUM_ASSETS.worldTerrain,
        autoRefreshToken: true,
      }),
    );
    terrain.registerPlugin(
      new ImageOverlayPlugin({
        renderer,
        overlays: [
          new CesiumIonOverlay({
            assetId: CESIUM_ASSETS.bingAerial,
            apiToken,
            autoRefreshToken: true,
          }),
        ],
      }),
    );
    terrain.registerPlugin(new TilesFadePlugin());

    const buildings = new TilesRenderer();
    buildings.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken,
        assetId: CESIUM_ASSETS.osmBuildings,
        autoRefreshToken: true,
      }),
    );
    buildings.registerPlugin(new TilesFadePlugin());
    return [terrain, buildings];
  }

  attributions(): AttributionEntry[] {
    return [
      { id: 'cesium', text: 'Cesium ion', url: 'https://cesium.com' },
      ...this.pluginAttributions('ion'),
    ];
  }
}
