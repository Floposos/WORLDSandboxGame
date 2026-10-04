import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Matrix4, Mesh, BufferGeometry, Ray, Vector3 } from 'three';
import { LocalFrame } from '../../src/core/geo';
import { createBall, createBox, createNpc, createWall } from '../../src/physics/bodies';
import {
  advanceSleep,
  FREEZE_AFTER_SLEEP_S,
  outsideBubble,
  selectDespawn,
  type BudgetEntry,
} from '../../src/physics/budget';
import { loadRapier, type Rapier } from '../../src/physics/rapier';
import { buildHeightfield, sampleHeightfield } from '../../src/physics/terrain';
import { Car, steerToward, CAR } from '../../src/physics/vehicle';
import { PhysicsWorld } from '../../src/physics/world';
import type { BuildingCell } from '../../src/world/buildings/buildingService';
import { extrudeFootprints } from '../../src/world/buildings/extrude';
import {
  parseOverpass,
  type Footprint,
  type OverpassResponse,
} from '../../src/world/buildings/overpass';
import { stackOffsets } from '../../src/tools/shared';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const CENTER = { lat: 52.5163, lon: 13.3777, height: 0 };
const GROUND = 34;

function makeWorld(heightAt: (lat: number, lon: number) => number | null = () => GROUND) {
  return new PhysicsWorld(R, { globe: new Group(), heightAt, maxBodies: 1_000 });
}

function run(world: PhysicsWorld, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) world.step(1 / 60);
}

describe('Body-Budget (Spec 7.1)', () => {
  const e = (id: number, spawnedAt: number, volume: number, extra: Partial<BudgetEntry> = {}) => ({
    id,
    spawnedAt,
    volume,
    debris: false,
    pinned: false,
    ...extra,
  });

  it('entfernt zuerst Trümmer, dann die ältesten, bei Gleichstand die kleinsten', () => {
    const list = [e(1, 0, 8), e(2, 0, 1), e(3, 5, 1), e(4, 9, 1, { debris: true }), e(5, 1, 1)];
    expect(selectDespawn(list, 5)).toEqual([]);
    expect(selectDespawn(list, 3)).toEqual([4, 2]);
    expect(selectDespawn(list, 1)).toEqual([4, 2, 1, 5]);
  });

  it('angeheftete Objekte (Auto, Abrissbirne) bleiben', () => {
    expect(selectDespawn([e(1, 0, 1, { pinned: true }), e(2, 1, 1)], 0)).toEqual([2]);
  });

  it('friert genau einmal nach 10 s Schlaf ein, Aufwachen setzt zurück', () => {
    let s = { sleptS: 0, freeze: false };
    let freezes = 0;
    for (let i = 0; i < (FREEZE_AFTER_SLEEP_S + 2) * 60; i++) {
      s = advanceSleep(s.sleptS, true, 1 / 60);
      if (s.freeze) freezes++;
    }
    expect(freezes).toBe(1);
    expect(advanceSleep(5, false, 1 / 60)).toEqual({ sleptS: 0, freeze: false });
  });

  it('erkennt Körper außerhalb der Blase', () => {
    expect(outsideBubble(0, 0, 0, 300)).toBe(false);
    expect(outsideBubble(400, 0, 0, 300)).toBe(true);
    expect(outsideBubble(0, -400, 0, 300)).toBe(true);
  });
});

describe('Heightfield', () => {
  it('folgt einer schiefen Ebene und trägt die Erdkrümmung', () => {
    const frame = new LocalFrame({ ...CENTER, height: GROUND });
    // Gelände steigt nach Osten um 1 m pro 100 m Länge
    const slope = (_lat: number, lon: number) =>
      GROUND + (lon - CENTER.lon) * 111_320 * 0.61 * 0.01;
    const hf = buildHeightfield(frame, 300, slope, 32);
    expect(hf.heights.length).toBe(33 * 33);
    expect(sampleHeightfield(hf, 0, 0)).toBeCloseTo(0, 1);
    expect(sampleHeightfield(hf, 200, 0)).toBeGreaterThan(sampleHeightfield(hf, -200, 0) + 3);
    // Flach: am Rand liegt der Boden wegen der Krümmung minimal tiefer
    const flat = buildHeightfield(frame, 1_000, () => GROUND, 16);
    const edge = sampleHeightfield(flat, 1_000, 0);
    expect(edge).toBeLessThan(0);
    expect(edge).toBeGreaterThan(-0.2);
  });

  it('füllt fehlende Höhen mit dem Mittel der bekannten', () => {
    const frame = new LocalFrame({ ...CENTER, height: GROUND });
    const hf = buildHeightfield(frame, 100, (lat) => (lat > CENTER.lat ? null : GROUND), 8);
    for (const h of hf.heights) expect(Number.isFinite(h)).toBe(true);
  });
});

describe('Physikwelt in der Blase', () => {
  it('Kiste fällt auf das Gelände und kommt zur Ruhe', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    expect(world.ready).toBe(true);
    const box = createBox(world, new Vector3(0, 5, 0), 1, 'wood');
    run(world, 4);
    expect(box.pos.y).toBeCloseTo(0.5, 1);
    expect(box.rb!.isSleeping()).toBe(true);
    world.dispose();
  });

  it('Kisten frieren nach 10 s Schlaf ein und tauen bei Treffern wieder auf', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    const box = createBox(world, new Vector3(0, 0.6, 0), 1, 'concrete');
    run(world, FREEZE_AFTER_SLEEP_S + 4);
    expect(box.frozen).toBe(true);
    // In Ruhelage bleibt die Instanz statisch
    world.render(1, 1 / 60);
    expect(box.atRest).toBe(true);
    createBall(world, new Vector3(-6, 0.5, 0), 0.4, 'metal', { velocity: new Vector3(15, 0, 0) });
    run(world, 1);
    expect(box.frozen).toBe(false);
    expect(box.atRest).toBe(false);
    world.dispose();
  });

  it('Budget: über dem Limit verschwinden die ältesten Objekte', async () => {
    const world = makeWorld();
    world.maxBodies = 10;
    await world.ensureBubble(CENTER, 300);
    const first = createBox(world, new Vector3(0, 1, 0), 1, 'wood');
    for (let i = 0; i < 12; i++) createBox(world, new Vector3(i * 2, 1, 5), 1, 'wood');
    expect(world.bodyCount).toBe(10);
    expect(first.rb).toBeNull();
    world.dispose();
  });

  it('Objekte außerhalb der Blase werden entfernt, neue Blase leert die alte', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 100);
    createBall(world, new Vector3(0, 1, 0), 0.5, 'rubber', { velocity: new Vector3(200, 0, 0) });
    run(world, 1.5);
    expect(world.bodyCount).toBe(0);
    createBox(world, new Vector3(0, 1, 0), 1, 'wood');
    await world.ensureBubble({ lat: 52.53, lon: 13.4, height: 0 }, 100);
    expect(world.bodyCount).toBe(0);
    world.dispose();
  });

  it('Raycast trifft Gelände und Körper in Weltkoordinaten', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    // Welt = Blasen-Frame verschoben, damit die Umrechnung geprüft wird
    world.group.parent!.matrix.copy(new Matrix4().makeTranslation(100, 0, 0));
    world.group.parent!.matrixAutoUpdate = false;
    world.group.parent!.updateMatrixWorld(true);
    const box = createBox(world, new Vector3(0, 0.5, 0), 1, 'wood');
    world.step(1 / 60);
    const top = world.bubbleToWorld(new Vector3(0, 10, 0));
    const ray = new Ray(top, world.dirToWorld(new Vector3(0, -1, 0)));
    const hit = world.raycast(ray)!;
    expect(hit.body).toBe(box);
    expect(hit.distance).toBeCloseTo(9, 1);
    const side = new Ray(world.bubbleToWorld(new Vector3(30, 10, 0)), ray.direction);
    const ground = world.raycast(side)!;
    expect(ground.body).toBeNull();
    expect(world.worldToBubble(ground.point).y).toBeCloseTo(0, 1);
    world.dispose();
  });

  it('200 Kisten fallen auf ein Hausdach und bleiben liegen (Abnahme M3)', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    // Ein 30 × 30 m großes, 20 m hohes Gebäude um die Blasenmitte
    const d = 0.00027;
    const fp: Footprint = {
      id: 1,
      polygons: [
        {
          outer: [
            CENTER.lon - d / 0.61,
            CENTER.lat - d,
            CENTER.lon + d / 0.61,
            CENTER.lat - d,
            CENTER.lon + d / 0.61,
            CENTER.lat + d,
            CENTER.lon - d / 0.61,
            CENTER.lat + d,
          ],
          holes: [],
        },
      ],
      height: 20,
      minHeight: 0,
      wallColour: 0,
      roofColour: 0,
      part: false,
      lat: CENTER.lat,
      lon: CENTER.lon,
      areaM2: 900,
    };
    world.addCell(fakeCell([fp], () => GROUND));
    expect(world.buildingColliderCount).toBe(1);
    for (const o of stackOffsets(200, 1)) createBox(world, o.add(new Vector3(0, 23, 0)), 1, 'wood');
    run(world, 12);
    let onRoof = 0;
    let sleeping = 0;
    for (const b of world.allBodies()) {
      if (b.pos.y > 19.9) onRoof++;
      if (b.frozen || b.rb?.isSleeping()) sleeping++;
    }
    expect(world.bodyCount).toBe(200);
    expect(onRoof).toBe(200);
    expect(sleeping).toBe(200);
    world.dispose();
  });

  it('Gebäude aus echten Berliner Daten werden zu Collidern', async () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../fixtures/overpass-berlin.json', import.meta.url), 'utf8'),
    ) as OverpassResponse;
    const list = parseOverpass(fixture);
    const world = makeWorld();
    await world.ensureBubble({ lat: 52.5205, lon: 13.372, height: 0 }, 1_000);
    world.addCell(fakeCell(list, () => GROUND, { lat: 52.5205, lon: 13.372 }));
    expect(world.buildingColliderCount).toBeGreaterThan(0);
    world.removeCell(fakeCell([], () => 0, { lat: 52.5205, lon: 13.372 }));
    expect(world.buildingColliderCount).toBe(0);
    world.dispose();
  });

  it('Mauer steht, NPCs wandern und fallen bei Stößen um', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    const wall = createWall(
      world,
      new Vector3(-5, 0, 10),
      new Vector3(5, 0, 10),
      2,
      'concrete',
      () => 0,
    );
    expect(wall.length).toBeGreaterThan(30);
    const npc = createNpc(world, new Vector3(0, 0, -10), 0);
    run(world, 3);
    for (const b of wall) expect(b.pos.y).toBeLessThan(2.1);
    expect(npc.npc!.fallen).toBe(false);
    expect(npc.pos.distanceTo(new Vector3(0, 0.85, -10))).toBeGreaterThan(1);
    npc.rb!.applyImpulse({ x: 600, y: 0, z: 0 }, true);
    run(world, 0.2);
    expect(npc.npc!.fallen).toBe(true);
    world.dispose();
  });

  it('Auto fährt vorwärts (−z) und lenkt', async () => {
    const world = makeWorld();
    await world.ensureBubble(CENTER, 300);
    const car = new Car(world, new Vector3(0, 0, 0), 0, 0);
    run(world, 1.5);
    car.input = { throttle: 1, steer: 0, brake: false };
    run(world, 4);
    expect(car.body.pos.z).toBeLessThan(-10);
    expect(car.speed).toBeGreaterThan(5);
    const x0 = car.body.pos.x;
    car.input = { throttle: 1, steer: 1, brake: false };
    run(world, 2);
    expect(car.body.pos.x).toBeLessThan(x0 - 1); // links = Westen bei Fahrt nach Norden
    car.input = { throttle: 0, steer: 0, brake: true };
    run(world, 5);
    expect(Math.abs(car.speed)).toBeLessThan(0.5);
    // Entfernen: erst der Fahrzeug-Controller, danach Geometrie und Material freigeben
    const disposed: string[] = [];
    car.root.traverse((o) => {
      if (o instanceof Mesh)
        (o.geometry as BufferGeometry).addEventListener('dispose', () => disposed.push('geo'));
    });
    world.removeBody(car.body);
    expect(world.bodyCount).toBe(0);
    expect(disposed.length).toBeGreaterThanOrEqual(3);
    world.dispose();
  });
});

describe('Fahrzeug-Lenkung', () => {
  it('folgt der Eingabe mit begrenzter Rate und kleinerem Ausschlag bei Tempo', () => {
    let s = 0;
    for (let i = 0; i < 120; i++) s = steerToward(s, 1, 0, 1 / 60);
    expect(s).toBeCloseTo(CAR.maxSteer, 3);
    let fast = 0;
    for (let i = 0; i < 120; i++) fast = steerToward(fast, 1, 30, 1 / 60);
    expect(fast).toBeLessThan(s / 2);
    expect(steerToward(0, 1, 0, 1 / 60)).toBeLessThan(0.05);
  });
});

/** Zelle wie aus dem BuildingService, Frame in der Zellmitte. */
function fakeCell(
  footprints: Footprint[],
  base: () => number,
  at: { lat: number; lon: number } = CENTER,
): BuildingCell {
  const frame = new LocalFrame({ lat: at.lat, lon: at.lon, height: 0 });
  const data = extrudeFootprints(footprints, frame, base);
  return {
    hash: `test-${at.lat}`,
    frame,
    toEcef: new Matrix4().fromArray(frame.ecefToLocalMatrix()).invert(),
    mesh: new Mesh(new BufferGeometry()),
    data,
    footprints,
  };
}
