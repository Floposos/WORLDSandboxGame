import { describe, expect, it } from 'vitest';
import { pickGroundDistance } from '../../src/camera/globeCamera';
import { chooseGroundHeight, COARSE_MESH_TOLERANCE_M } from '../../src/world/ground';
import {
  isRetryableStatus,
  resetFailedTilesSafely,
  retryDelayMs,
} from '../../src/world/providers/TilesProviderBase';
import type { TilesRenderer } from '3d-tiles-renderer/three';

describe('pickGroundDistance', () => {
  it('nimmt den Mesh-Treffer, wenn keine gemessene Höhe vorliegt', () => {
    expect(pickGroundDistance(120, 5000, null)).toBe(120);
    expect(pickGroundDistance(null, 5000, null)).toBeNull();
  });

  it('nimmt die gemessene Höhe ohne Mesh-Treffer', () => {
    expect(pickGroundDistance(null, 5000, 2950)).toBe(2050);
  });

  it('bleibt beim Mesh, solange die Abweichung im Geoid-Bereich liegt', () => {
    // Mesh 60 m unter der gemessenen Höhe (Geoid-Versatz) und 80 m darüber
    expect(pickGroundDistance(2110, 5000, 2950)).toBe(2110);
    expect(pickGroundDistance(1970, 5000, 2950)).toBe(1970);
    expect(pickGroundDistance(2050 + COARSE_MESH_TOLERANCE_M, 5000, 2950)).toBe(
      2050 + COARSE_MESH_TOLERANCE_M,
    );
  });

  it('nimmt die gemessene Höhe, wenn das Mesh grob und viel zu tief ist', () => {
    // Zugspitze mit nur der Wurzelkachel: Mesh bei −3640 m, echtes Gelände bei 2952 m
    expect(pickGroundDistance(5600 + 3640, 5600, 2952)).toBe(5600 - 2952);
  });

  it('meldet negative Abstände, wenn die Kamera unter dem echten Gelände steckt', () => {
    expect(pickGroundDistance(2000, 1500, 2952)).toBe(1500 - 2952);
  });
});

describe('chooseGroundHeight', () => {
  it('Open Data (ohne Gebäude): gemessene Höhe gewinnt, auch wenn das grobe Mesh darüber liegt', () => {
    // Tokio nach dem Flug: grobe Kachel 10 km über dem echten Boden
    expect(chooseGroundHeight(10_000, 36, false)).toEqual({ height: 36, fromMesh: false });
    expect(pickGroundDistance(-10_100, 900, 36, false)).toBe(864);
  });

  it('mit Gebäuden: Dach gilt, Unsinn über 1 km nicht', () => {
    expect(chooseGroundHeight(36 + 300, 36, true)).toEqual({ height: 336, fromMesh: true });
    expect(chooseGroundHeight(36 + 5_000, 36, true)).toEqual({ height: 36, fromMesh: false });
  });

  it('ohne gemessene Höhe gilt das Mesh, ohne beides nichts', () => {
    expect(chooseGroundHeight(12, null, false)).toEqual({ height: 12, fromMesh: true });
    expect(chooseGroundHeight(null, null)).toBeNull();
  });
});

describe('Wiederholung fehlgeschlagener Kacheln', () => {
  it('wiederholt nur Netz- und Serverfehler', () => {
    expect(isRetryableStatus(null)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
  });

  it('wartet exponentiell länger, höchstens 30 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe('resetFailedTilesSafely', () => {
  it('setzt fehlgeschlagene Kacheln zurück und übersteht Kacheln ohne internal', () => {
    const tiles = [{ internal: { loadingState: -1 } }, {}, { internal: { loadingState: 3 } }] as {
      internal?: { loadingState: number };
    }[];
    const fake = {
      rootLoadingState: -1,
      stats: { failed: 1 },
      traverse(cb: (t: { internal?: { loadingState: number } }) => void) {
        tiles.forEach(cb);
      },
    };
    resetFailedTilesSafely(fake as unknown as TilesRenderer);
    expect(fake.rootLoadingState).toBe(0);
    expect(fake.stats.failed).toBe(0);
    expect(tiles.map((t) => t.internal?.loadingState)).toEqual([0, undefined, 3]);
  });
});
