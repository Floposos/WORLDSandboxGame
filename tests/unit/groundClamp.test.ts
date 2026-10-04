import { describe, expect, it } from 'vitest';
import { COARSE_MESH_TOLERANCE_M, pickGroundDistance } from '../../src/camera/globeCamera';
import { isRetryableStatus, retryDelayMs } from '../../src/world/providers/TilesProviderBase';

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
