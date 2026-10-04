/**
 * Typen für Teile von 3d-tiles-renderer 0.5.3, die im Paket (noch) keine .d.ts haben.
 * Quelle: node_modules/3d-tiles-renderer/src/three/plugins/images/terrain-rgb/*.js
 * Bei einem Versions-Update gegen den Quellcode prüfen.
 */
import type { ImageOverlay } from '3d-tiles-renderer/plugins';

declare module '3d-tiles-renderer/plugins' {
  interface TerrainRGBMeshPluginOptions {
    /** XYZ-URL-Vorlage mit {z}/{x}/{y} */
    url: string;
    tileDimension?: number;
    maxZoom?: number;
    heightScale?: number;
    overlay?: ImageOverlay | null;
    applyOverlayTexture?: boolean;
    unlit?: boolean;
    /** 'ellipsoid' oder 'source' */
    projection?: string;
    endCaps?: boolean;
    useRecommendedSettings?: boolean;
  }

  export class TerrainRGBMeshPlugin {
    constructor(options: TerrainRGBMeshPluginOptions);
    name: string;
    heightScale: number;
    overlay: ImageOverlay | null;
    applyOverlayTexture: boolean;
    /** Höhe über dem Ellipsoid in Metern aus den geladenen Kacheln (Winkel in Radiant), sonst null. */
    sampleCartographicElevation(lat: number, lon: number): number | null;
    dispose(): void;
  }

  export class TerrariumMeshPlugin extends TerrainRGBMeshPlugin {}
}

declare module '3d-tiles-renderer/three' {
  /**
   * Im JS-Build exportiert (index.three.js), fehlt aber in index.d.ts.
   * Werte aus src/three/renderer/math/Ellipsoid.js.
   */
  export const ENU_FRAME: 0;
  export const CAMERA_FRAME: 1;
  export const OBJECT_FRAME: 2;
}
