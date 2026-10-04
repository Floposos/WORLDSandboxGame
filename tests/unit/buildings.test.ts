import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LocalFrame } from '../../src/core/geo';
import { BuildingCache } from '../../src/world/buildings/cache';
import { extrudeFootprints, WALL_SINK_M } from '../../src/world/buildings/extrude';
import {
  cellsCovering,
  geohashBounds,
  geohashEncode,
  unionBounds,
} from '../../src/world/buildings/geohash';
import {
  buildingColours,
  buildingHeights,
  defaultHeight,
  LEVEL_HEIGHT_M,
  parseColour,
  parseLength,
  parseLevels,
} from '../../src/world/buildings/heights';
import {
  assembleRings,
  buildQuery,
  OverpassClient,
  parseOverpass,
  pointInRing,
  ringArea,
  type Footprint,
  type OverpassResponse,
} from '../../src/world/buildings/overpass';

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/overpass-berlin.json', import.meta.url), 'utf8'),
) as OverpassResponse;

describe('Geohash', () => {
  it('kodiert bekannte Werte und dekodiert die Zelle um den Punkt', () => {
    // Referenz: Wikipedia-Beispiel 57.64911, 10.40744 → u4pruydqqvj
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    const b = geohashBounds(geohashEncode(52.5163, 13.3777, 6));
    expect(b.south).toBeLessThanOrEqual(52.5163);
    expect(b.north).toBeGreaterThanOrEqual(52.5163);
    expect(b.west).toBeLessThanOrEqual(13.3777);
    expect(b.east).toBeGreaterThanOrEqual(13.3777);
  });

  it('cellsCovering deckt den Kreis ab, nächste Zelle zuerst', () => {
    const lat = 52.5163;
    const lon = 13.3777;
    const cells = cellsCovering(lat, lon, 600);
    expect(cells[0]).toBe(geohashEncode(lat, lon, 6));
    // Punkte auf dem Kreisrand liegen in einer der Zellen
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180;
      const pLat = lat + (Math.cos(r) * 599) / 111_320;
      const pLon = lon + (Math.sin(r) * 599) / (111_320 * Math.cos((lat * Math.PI) / 180));
      expect(cells).toContain(geohashEncode(pLat, pLon, 6));
    }
    expect(cells.length).toBeLessThan(16);
  });

  it('unionBounds umschließt alle Zellen', () => {
    const cells = cellsCovering(35.6595, 139.7005, 400);
    const u = unionBounds(cells);
    for (const c of cells) {
      const b = geohashBounds(c);
      expect(b.south).toBeGreaterThanOrEqual(u.south);
      expect(b.east).toBeLessThanOrEqual(u.east);
    }
  });
});

describe('Höhenregeln (Spec 5.4)', () => {
  it('parseLength versteht Meter, Komma, Fuß und verwirft Unsinn', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12 m')).toBe(12);
    expect(parseLength('12,5')).toBe(12.5);
    expect(parseLength("40'")).toBeCloseTo(12.192, 3);
    expect(parseLength('10 ft')).toBeCloseTo(3.048, 3);
    expect(parseLength('12\'6"')).toBeCloseTo(3.81, 2);
    expect(parseLength('-3')).toBeNull();
    expect(parseLength('0')).toBeNull();
    expect(parseLength('hoch')).toBeNull();
    expect(parseLength('5000')).toBeNull();
    expect(parseLength(undefined)).toBeNull();
  });

  it('parseLevels nimmt bei Listen den größten Wert', () => {
    expect(parseLevels('5')).toBe(5);
    expect(parseLevels('3;4')).toBe(4);
    expect(parseLevels('x')).toBeNull();
  });

  it('height vor building:levels × 3,2 m vor Standard nach Typ', () => {
    expect(buildingHeights({ building: 'yes', height: '27', 'building:levels': '3' }).height).toBe(
      27,
    );
    expect(buildingHeights({ building: 'yes', 'building:levels': '5' }).height).toBeCloseTo(
      5 * LEVEL_HEIGHT_M,
    );
    expect(buildingHeights({ building: 'house' }).height).toBe(9);
    expect(buildingHeights({ building: 'industrial' }).height).toBe(8);
    expect(buildingHeights({ building: 'church' }).height).toBe(20);
    expect(defaultHeight({ building: 'skyscraper' })).toBeGreaterThan(50);
  });

  it('min_height und building:min_level heben die Unterkante, Vordächer schweben', () => {
    expect(buildingHeights({ building: 'yes', height: '46', min_height: '32' })).toEqual({
      height: 46,
      minHeight: 32,
    });
    expect(
      buildingHeights({ 'building:part': 'yes', 'building:min_level': '2', height: '20' }),
    ).toEqual({ height: 20, minHeight: 2 * LEVEL_HEIGHT_M });
    expect(buildingHeights({ building: 'roof', height: '5' })).toEqual({ height: 5, minHeight: 4 });
    // Widersprüchliche Angaben: Oberkante über Unterkante
    const h = buildingHeights({ building: 'yes', height: '5', min_height: '8' });
    expect(h.height).toBeGreaterThan(h.minHeight);
  });

  it('Farben aus Tags, Material oder stabiler Palette', () => {
    expect(parseColour('#fff')).toBe(0xffffff);
    expect(parseColour('#94c9c1')).toBe(0x94c9c1);
    expect(parseColour('Light Grey')).toBe(parseColour('lightgrey'));
    expect(parseColour('banane')).toBeNull();
    expect(buildingColours({ 'building:colour': 'red', 'roof:colour': '#000000' }, 1)).toEqual({
      wall: parseColour('red'),
      roof: 0,
    });
    const a = buildingColours({ building: 'yes' }, 42);
    expect(buildingColours({ building: 'yes' }, 42)).toEqual(a);
    expect(buildingColours({ 'building:material': 'brick' }, 1).wall).toBe(0xa45d45);
  });
});

describe('Overpass-Parser', () => {
  it('Abfrage nutzt das Rechteck und out geom', () => {
    const q = buildQuery({ south: 52.5, west: 13.3, north: 52.6, east: 13.4 });
    expect(q).toContain('way["building"](52.500000,13.300000,52.600000,13.400000)');
    expect(q).toContain('relation["building"]');
    expect(q).toContain('way["building:part"]');
    expect(q.endsWith('out geom;')).toBe(true);
  });

  it('liest Ways und Multipolygone mit Löchern aus echten Berliner Daten', () => {
    const list = parseOverpass(fixture);
    expect(list.length).toBeGreaterThan(5);
    const gov = list.find((f) => f.id === 11351098)!;
    expect(gov.height).toBe(18);
    const rel = list.find((f) => f.id === -3221)!;
    expect(rel).toBeDefined();
    expect(rel.polygons[0]!.holes.length).toBeGreaterThan(0);
    expect(rel.minHeight).toBe(39);
    for (const f of list) {
      for (const p of f.polygons) {
        expect(ringArea(p.outer, f.lat)).toBeGreaterThan(0); // CCW
        for (const h of p.holes) expect(ringArea(h, f.lat)).toBeLessThan(0); // CW
      }
      expect(f.areaM2).toBeGreaterThan(2);
    }
  });

  it('überspringt Türen und Innenraum-Teile', () => {
    const ids = parseOverpass(fixture).map((f) => f.id);
    for (const el of fixture.elements) {
      if (el.tags?.indoor || el.tags?.['building:part'] === 'door') {
        expect(ids).not.toContain(el.id);
      }
    }
  });

  it('Umriss entfällt, wenn Teile ihn überwiegend abdecken', () => {
    const square = (lon: number, lat: number, d: number) => [
      { lat, lon },
      { lat, lon: lon + d },
      { lat: lat + d, lon: lon + d },
      { lat: lat + d, lon },
      { lat, lon },
    ];
    const json: OverpassResponse = {
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes' }, geometry: square(13, 52, 0.001) },
        {
          type: 'way',
          id: 2,
          tags: { 'building:part': 'yes', height: '30' },
          geometry: square(13, 52, 0.001),
        },
        { type: 'way', id: 3, tags: { building: 'yes' }, geometry: square(13.01, 52, 0.001) },
        {
          type: 'way',
          id: 4,
          tags: { 'building:part': 'yes' },
          geometry: square(13.01, 52, 0.0002),
        },
      ],
    };
    const ids = parseOverpass(json).map((f) => f.id);
    expect(ids).toEqual([2, 3, 4]); // 1 vollständig von Teil 2 bedeckt, 3 nur zu 4 %
  });

  it('setzt geteilte Außenringe zusammen und verwirft offene', () => {
    const a = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
    ];
    const b = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 1, lon: 1 },
    ];
    const rings = assembleRings([a, b]);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.length).toBe(8);
    expect(assembleRings([a])).toHaveLength(0);
    expect(pointInRing(0.5, 0.5, rings[0]!)).toBe(true);
    expect(pointInRing(1.5, 0.5, rings[0]!)).toBe(false);
  });

  it('Client fällt auf den Mirror zurück und parst die Antwort', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      urls.push(url);
      if (url.startsWith('https://a.test'))
        return Promise.resolve(new Response('', { status: 400 }));
      return Promise.resolve(new Response(JSON.stringify(fixture), { status: 200 }));
    });
    const client = new OverpassClient({
      endpoints: ['https://a.test/api/interpreter', 'https://b.test/api/interpreter'],
      fetchImpl,
    });
    const list = await client.fetchBuildings({ south: 52.5, west: 13.3, north: 52.6, east: 13.4 });
    expect(list.length).toBeGreaterThan(0);
    expect(urls[0]).toContain('https://a.test');
    expect(urls[1]).toContain('https://b.test');
    expect(decodeURIComponent(urls[1]!)).toContain('out geom;');
  });
});

function box(
  id: number,
  lon: number,
  lat: number,
  d: number,
  height: number,
  minHeight = 0,
): Footprint {
  return {
    id,
    polygons: [{ outer: [lon, lat, lon + d, lat, lon + d, lat + d, lon, lat + d], holes: [] }],
    height,
    minHeight,
    wallColour: 0xcccccc,
    roofColour: 0x888888,
    part: false,
    lat: lat + d / 2,
    lon: lon + d / 2,
    areaM2: 100,
  };
}

describe('Extrusion', () => {
  const frame = new LocalFrame({ lat: 52.5, lon: 13.4, height: 0 });

  it('Dach liegt auf Fußpunkt + Höhe, Wände reichen unter den Boden, Normalen zeigen nach außen', () => {
    const d = extrudeFootprints([box(7, 13.4, 52.5, 0.0003, 20)], frame, () => 34);
    expect(d.buildings).toHaveLength(1);
    const ys: number[] = [];
    for (let i = 1; i < d.positions.length; i += 3) ys.push(d.positions[i]!);
    expect(Math.max(...ys)).toBeCloseTo(54, 1);
    expect(Math.min(...ys)).toBeCloseTo(34 - WALL_SINK_M, 1);
    // 4 Wände × 2 + Dach 2 Dreiecke
    expect(d.indices.length / 3).toBe(10);

    // Jede Wand-Normale zeigt vom Gebäudemittelpunkt weg, jedes Dreieck ist passend gewickelt
    let cx = 0;
    let cz = 0;
    const n = d.positions.length / 3;
    for (let i = 0; i < n; i++) {
      cx += d.positions[i * 3]!;
      cz += d.positions[i * 3 + 2]!;
    }
    cx /= n;
    cz /= n;
    for (let t = 0; t < d.indices.length; t += 3) {
      const [a, b, c] = [d.indices[t]!, d.indices[t + 1]!, d.indices[t + 2]!];
      const p = (k: number) => [
        d.positions[k * 3]!,
        d.positions[k * 3 + 1]!,
        d.positions[k * 3 + 2]!,
      ];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = pb.map((v, i) => v - pa[i]!);
      const v = pc.map((w, i) => w - pa[i]!);
      const fn = [
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ];
      const vn = [d.normals[a * 3]!, d.normals[a * 3 + 1]!, d.normals[a * 3 + 2]!];
      expect(fn[0]! * vn[0]! + fn[1]! * vn[1]! + fn[2]! * vn[2]!).toBeGreaterThan(0);
      if (vn[1] === 0) {
        expect((pa[0]! - cx) * vn[0]! + (pa[2]! - cz) * vn[2]!).toBeGreaterThan(0);
      }
    }
  });

  it('schwebende Teile bekommen eine Unterseite auf min_height', () => {
    const d = extrudeFootprints([box(8, 13.4, 52.5, 0.0003, 46, 32)], frame, () => 30);
    const ys: number[] = [];
    for (let i = 1; i < d.positions.length; i += 3) ys.push(d.positions[i]!);
    expect(Math.min(...ys)).toBeCloseTo(62, 1);
    expect(d.indices.length / 3).toBe(12);
  });

  it('Mehrere Gebäude teilen sich die Puffer, Bereiche sind lückenlos', () => {
    const d = extrudeFootprints(
      [box(1, 13.4, 52.5, 0.0002, 10), box(2, 13.401, 52.5, 0.0002, 30)],
      frame,
      () => 0,
    );
    expect(d.buildings.map((b) => b.id)).toEqual([1, 2]);
    expect(d.buildings[1]!.indexStart).toBe(d.buildings[0]!.indexCount);
    expect(d.buildings[1]!.vertexStart).toBe(d.buildings[0]!.vertexCount);
    expect(d.colors.length).toBe(d.positions.length);
    expect(d.uvs.length / 2).toBe(d.positions.length / 3);
  });

  it('echte Berliner Gebäude ergeben gültige Geometrie', () => {
    const list = parseOverpass(fixture);
    const d = extrudeFootprints(
      list,
      new LocalFrame({ lat: 52.52, lon: 13.37, height: 0 }),
      () => 35,
    );
    expect(d.buildings.length).toBe(list.length);
    for (const v of d.positions) expect(Number.isFinite(v)).toBe(true);
    for (const i of d.indices) expect(i).toBeLessThan(d.positions.length / 3);
  });
});

describe('Gebäude-Cache', () => {
  it('ohne IndexedDB: Speicher-LRU mit Grenze', async () => {
    const cache = new BuildingCache(2, () => 0, undefined);
    await cache.set('a', []);
    await cache.set('b', [box(1, 0, 0, 0.001, 9)]);
    await cache.set('c', []);
    expect(await cache.get('a')).toBeUndefined();
    expect((await cache.get('b'))!.length).toBe(1);
    expect(await cache.get('c')).toEqual([]);
  });
});
