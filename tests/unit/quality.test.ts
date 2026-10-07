import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, PlaneGeometry, Texture } from 'three';
import { buildingRadius, BUILDINGS_MAX_RADIUS_M } from '../../src/core/engine';
import {
  MAX_LOADED_CELLS,
  MAX_WANTED_CELLS,
  wantedCells,
} from '../../src/world/buildings/buildingService';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import {
  NEAR_DAY_BOOST,
  NEAR_NIGHT_BOOST,
  nearAmbientBoost,
} from '../../src/world/atmosphere/lighting';
import { sharpenTextures } from '../../src/world/providers/TilesProviderBase';

describe('Aufhellung in Bodennähe', () => {
  it('aus dem All keine Aufhellung: die Nachtseite bleibt dunkel', () => {
    expect(nearAmbientBoost(3_000_000, -0.5)).toBe(0);
    expect(nearAmbientBoost(200_000, -0.5)).toBe(0);
  });

  it('nah am Boden nachts stärker als tagsüber', () => {
    expect(nearAmbientBoost(2_000, -0.5)).toBeCloseTo(NEAR_NIGHT_BOOST);
    expect(nearAmbientBoost(2_000, 0.6)).toBeCloseTo(NEAR_DAY_BOOST);
    expect(NEAR_NIGHT_BOOST).toBeGreaterThan(NEAR_DAY_BOOST);
  });

  it('blendet mit der Höhe und in der Dämmerung stetig über', () => {
    let prev = Infinity;
    for (let h = 0; h <= 250_000; h += 10_000) {
      const v = nearAmbientBoost(h, -0.5);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    const dusk = nearAmbientBoost(2_000, 0.1);
    expect(dusk).toBeGreaterThan(NEAR_DAY_BOOST);
    expect(dusk).toBeLessThan(NEAR_NIGHT_BOOST);
  });
});

describe('Ladekreis der Gebäude', () => {
  it('wächst mit der Kamerahöhe und ist begrenzt', () => {
    expect(buildingRadius(600, 0)).toBe(900);
    expect(buildingRadius(600, 2_000)).toBe(3_200);
    expect(buildingRadius(600, 6_000)).toBe(BUILDINGS_MAX_RADIUS_M);
    expect(buildingRadius(300)).toBe(800);
  });
});

describe('Satellitenbild', () => {
  it('nimmt standardmäßig den Jahrgang 2025', () => {
    expect(DEFAULT_SETTINGS.imagery).toBe('eox-2025');
  });

  it('schaltet die anisotrope Filterung der Kacheltexturen ein', () => {
    const map = new Texture();
    const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial({ map }));
    const v = map.version;
    sharpenTextures(mesh, 8);
    expect(map.anisotropy).toBe(8);
    expect(map.version).toBeGreaterThan(v);
    sharpenTextures(mesh, 4);
    expect(map.anisotropy).toBe(8);
  });
});

describe('Gebäude-Ladekreis im hohen Norden', () => {
  it('kappt den Radius, damit alle Zellen in den Speicher passen', () => {
    for (const [lat, lon] of [
      [52.52, 13.4],
      [59.91, 10.75],
      [64.15, -21.94],
    ]) {
      const { cells, radiusM } = wantedCells({ lat: lat!, lon: lon!, height: 0 }, 3_500);
      expect(cells.length).toBeLessThanOrEqual(MAX_WANTED_CELLS);
      expect(MAX_WANTED_CELLS).toBeLessThan(MAX_LOADED_CELLS);
      expect(radiusM).toBeGreaterThan(2_000);
    }
  });
});
