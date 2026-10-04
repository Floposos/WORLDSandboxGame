import { beforeAll, describe, expect, it } from 'vitest';
import { BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { LocalFrame } from '../../src/core/geo';
import { createBall } from '../../src/physics/bodies';
import { Destruction, type BuildingStatus } from '../../src/physics/destruction';
import { cellsForArea, fractureFootprint, isSupported } from '../../src/physics/fracture';
import { loadRapier, type Rapier } from '../../src/physics/rapier';
import { PhysicsWorld } from '../../src/physics/world';
import type { BuildingCell } from '../../src/world/buildings/buildingService';
import { extrudeFootprints } from '../../src/world/buildings/extrude';
import type { Footprint } from '../../src/world/buildings/overpass';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const CENTER = { lat: 53.55, lon: 9.995, height: 0 };
const GROUND = 8;

function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function rect(w: number, d: number): number[] {
  return [-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2];
}

describe('Vorab-Bruch (Spec 7.2, Schritt 4)', () => {
  it('zerlegt in Stockwerke à 3,2 m und 4 bis 12 Zellen, Fläche bleibt erhalten', () => {
    const r = fractureFootprint(
      { outer: rect(20, 12), holes: [] },
      { bottom: 0, top: 16, random: rng() },
    );
    expect(r.layers).toBe(5);
    for (let layer = 0; layer < r.layers; layer++) {
      const frags = r.fragments.filter((f) => f.layer === layer);
      expect(frags.length).toBeGreaterThanOrEqual(4);
      expect(frags.length).toBeLessThanOrEqual(12);
      const area = frags.reduce((a, f) => a + f.area, 0);
      expect(area).toBeCloseTo(240, 3);
      expect(frags[0]!.yTop - frags[0]!.yBottom).toBeCloseTo(3.2, 6);
    }
    // Jedes Stück über dem Erdgeschoss liegt auf Stücken darunter
    for (const f of r.fragments) if (f.layer > 0) expect(f.supports.size).toBeGreaterThan(0);
  });

  it('Innenhof bleibt frei, hohe Häuser fassen Geschosse zusammen', () => {
    const r = fractureFootprint(
      { outer: rect(30, 30), holes: [rect(10, 10)] },
      { bottom: 0, top: 120, random: rng(3), maxLayers: 12 },
    );
    expect(r.layers).toBe(12);
    const area = r.fragments.filter((f) => f.layer === 0).reduce((a, f) => a + f.area, 0);
    expect(area).toBeCloseTo(800, 2);
  });

  it('Zellenzahl wächst mit der Fläche und ist begrenzt', () => {
    expect(cellsForArea(10)).toBe(4);
    expect(cellsForArea(400)).toBeGreaterThan(cellsForArea(200));
    expect(cellsForArea(100_000)).toBe(12);
  });

  it('Strukturtest: ohne feste Stücke darunter fällt ein Stockwerk', () => {
    const r = fractureFootprint(
      { outer: rect(10, 10), holes: [] },
      { bottom: 0, top: 6.4, random: rng(5) },
    );
    const upper = r.fragments.find((f) => f.layer === 1)!;
    expect(isSupported(upper, () => true)).toBe(true);
    expect(isSupported(upper, () => false)).toBe(false);
    expect(
      isSupported(
        r.fragments.find((f) => f.layer === 0)!,
        () => false,
      ),
    ).toBe(true);
  });
});

function footprint(
  id: number,
  eastM: number,
  northM: number,
  w: number,
  d: number,
  h: number,
): Footprint {
  const mLat = 1 / 111_320;
  const mLon = 1 / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180));
  const lat = CENTER.lat + northM * mLat;
  const lon = CENTER.lon + eastM * mLon;
  const outer: number[] = [];
  for (const [x, y] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ] as const) {
    outer.push(lon + x * mLon, lat + y * mLat);
  }
  return {
    id,
    polygons: [{ outer, holes: [] }],
    height: h,
    minHeight: 0,
    wallColour: 0xccbbaa,
    roofColour: 0x884433,
    part: false,
    lat,
    lon,
    areaM2: w * d,
  };
}

function cellOf(fps: Footprint[]): BuildingCell {
  const frame = new LocalFrame({ lat: CENTER.lat, lon: CENTER.lon, height: 0 });
  const data = extrudeFootprints(fps, frame, () => GROUND);
  return {
    hash: 'test',
    frame,
    toEcef: new Matrix4().fromArray(frame.ecefToLocalMatrix()).invert(),
    mesh: new Mesh(new BufferGeometry()),
    data,
    footprints: fps,
  };
}

async function setup(fps: Footprint[]) {
  const world = new PhysicsWorld(R, {
    globe: new Group(),
    heightAt: () => GROUND,
    maxBodies: 2_000,
  });
  world.random = rng(7);
  await world.ensureBubble(CENTER, 300);
  const cell = cellOf(fps);
  world.addCell(cell);
  const hidden: number[] = [];
  const statuses: [number, BuildingStatus][] = [];
  const d = new Destruction(world, {
    material: new MeshBasicMaterial(),
    hideInCell: (_c, range) => hidden.push(range.id),
    onStatus: (id, s) => statuses.push([id, s]),
  });
  return { world, d, cell, hidden, statuses };
}

function run(world: PhysicsWorld, d: Destruction, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) {
    world.step(1 / 60);
    d.step();
  }
}

describe('Zerstörung (Spec 7.2, Schritte 5–7)', () => {
  it('Bombe neben einem Haus: Haus bricht, Stockwerke fallen nach, Status eingestürzt', async () => {
    const { world, d, hidden, statuses } = await setup([footprint(1, 0, 0, 16, 12, 16)]);
    expect(world.buildingColliderCount).toBe(1);
    const loose = d.applyBlast(new Vector3(12, 0.5, 0), 500);
    expect(loose).toBeGreaterThan(0);
    expect(hidden).toEqual([1]);
    expect(world.buildingColliderCount).toBe(0);
    run(world, d, 6);
    expect(d.statusOf(1)).toBe('collapsed');
    expect(statuses.map((s) => s[1])).toContain('collapsed');
    // Losgebrochene Trümmer liegen unten, nichts Loses schwebt mehr in Dachhöhe
    let high = 0;
    let looseCount = 0;
    for (const b of world.allBodies()) {
      if (b.kind !== 'fragment' || b.pinned) continue;
      looseCount++;
      const v = b.rb?.linvel() ?? { x: 0, y: 0, z: 0 };
      // Weggeschleuderte Stücke fliegen noch; liegen bleiben darf oben nichts
      if (b.pos.y > 14 && Math.hypot(v.x, v.y, v.z) < 1) high++;
    }
    expect(looseCount).toBeGreaterThan(10);
    expect(high).toBe(0);
    world.dispose();
  });

  it('kleine Ladung weit weg bricht nichts', async () => {
    const { world, d, hidden } = await setup([footprint(1, 0, 0, 16, 12, 16)]);
    expect(d.applyBlast(new Vector3(40, 0.5, 0), 1)).toBe(0);
    expect(hidden).toEqual([]);
    expect(d.statusOf(1)).toBe('intact');
    world.dispose();
  });

  it('schwere Kugel reißt Stücke aus einem vorgebrochenen Haus', async () => {
    const { world, d, cell } = await setup([footprint(1, 0, 0, 10, 10, 9.6)]);
    d.fracture(cell, cell.data.buildings[0]!, cell.footprints[0]!);
    run(world, d, 0.2);
    expect(d.statusOf(1)).toBe('intact');
    createBall(world, new Vector3(-12, GROUND + 4, 0), 1, 'metal', {
      velocity: new Vector3(20, 0, 0),
    });
    run(world, d, 2);
    expect(d.statusOf(1)).not.toBe('intact');
    world.dispose();
  });
});
