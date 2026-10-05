import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { STANDARD_GRAVITY } from '../../src/core/constants';
import { createBox } from '../../src/physics/bodies';
import {
  impactCrater,
  meteorEnergyJ,
  meteorMass,
  radiusForOverpressure,
  tntKgFromJoule,
  transientCraterM,
  vaporizeRadius,
} from '../../src/physics/impact';
import { loadRapier, type Rapier } from '../../src/physics/rapier';
import {
  breakSpeed,
  EF_SPEEDS,
  rankineSpeed,
  vortexWind,
  VORTEX_MAX_ACCEL,
  windAccel,
} from '../../src/physics/vortex';
import { PhysicsWorld } from '../../src/physics/world';
import { createDefaultRegistry } from '../../src/tools/index';
import { formatEnergy, formatTnt } from '../../src/tools/explosions';
import {
  buildingCapacityG,
  peakGroundAccelG,
  quakeEnvelope,
} from '../../src/tools/tier4/earthquake';
import { entryDirection } from '../../src/tools/tier4/meteor';
import { coneSize, growth } from '../../src/tools/tier4/volcano';
import { backLength, lowestEdge, waveHeightAt, waveSpeed } from '../../src/tools/tier4/tsunami';
import { coneOffset, HeightPatches } from '../../src/world/heightPatches';
import {
  applyWater,
  FLOOD_MAX_M,
  halfHeight,
  lowestGround,
  submergedFraction,
} from '../../src/world/water/water';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const CENTER = { lat: 53.55, lon: 9.995, height: 0 };

describe('Werkzeuge Stufe 1 und 4 (Spec 8)', () => {
  const registry = createDefaultRegistry();

  it('sind vollständig registriert, mit den Grenzen aus der Spezifikation', () => {
    expect(registry.byTier(1).map((t) => t.id)).toEqual([
      'time-of-day',
      'weather',
      'flood',
      'gravity',
    ]);
    expect(registry.byTier(4).map((t) => t.id)).toEqual([
      'meteor',
      'tornado',
      'earthquake',
      'volcano',
      'tsunami',
    ]);
    const param = (id: string, key: string) => registry.get(id)!.params.find((p) => p.key === key)!;
    expect([param('flood', 'level').min, param('flood', 'level').max]).toEqual([0, FLOOD_MAX_M]);
    expect([param('gravity', 'g').min, param('gravity', 'g').max]).toEqual([0, 3]);
    expect([param('meteor', 'diameter').min, param('meteor', 'diameter').max]).toEqual([1, 100]);
    expect([param('meteor', 'speed').min, param('meteor', 'speed').max]).toEqual([11, 72]);
    expect([param('earthquake', 'magnitude').min, param('earthquake', 'magnitude').max]).toEqual([
      1, 10,
    ]);
  });
});

describe('Meteor (Spec 8)', () => {
  it('E = ½·m·v², in TNT umgerechnet', () => {
    // 50 m Steinmeteor (3 000 kg/m³) ≈ 1,96·10⁸ kg, bei 20 km/s ≈ 3,9·10¹⁶ J ≈ 9,4 Mt TNT
    const m = meteorMass(50);
    expect(m).toBeCloseTo(3_000 * (4 / 3) * Math.PI * 25 ** 3, 0);
    const e = meteorEnergyJ(50, 20);
    expect(e).toBeCloseTo(0.5 * m * 20_000 ** 2, 0);
    // 9,4 Mt TNT (1 Mt = 10⁹ kg TNT)
    const mt = tntKgFromJoule(e) / 1e9;
    expect(mt).toBeGreaterThan(9);
    expect(mt).toBeLessThan(10);
    // Doppelte Geschwindigkeit = vierfache Energie
    expect(meteorEnergyJ(50, 40) / e).toBeCloseTo(4, 6);
  });

  it('Kratergröße nach Collins et al.: 50 m ergibt gut 1 km, Barringer-Größenordnung', () => {
    const c = impactCrater(50, 20, 45);
    expect(c.radiusM * 2).toBeGreaterThan(1_000);
    expect(c.radiusM * 2).toBeLessThan(1_800);
    expect(c.depthM / (c.radiusM * 2)).toBeCloseTo(0.2, 2);
    // Flacher Einschlag gräbt weniger, größerer Körper mehr
    expect(impactCrater(50, 20, 15).radiusM).toBeLessThan(c.radiusM);
    expect(impactCrater(100, 20, 45).radiusM).toBeGreaterThan(c.radiusM);
    expect(transientCraterM(50, 20, 90)).toBeGreaterThan(transientCraterM(50, 20, 30));
    // 1-m-Stein: kleiner Krater (SIMPLIFIED: real zerplatzt er in der Luft)
    expect(impactCrater(1, 15, 45).radiusM).toBeLessThan(40);
  });

  it('Verdampfungsradius umfasst Schüssel und den Bereich über 1 MPa', () => {
    const c = impactCrater(50, 20, 45);
    const tnt = tntKgFromJoule(meteorEnergyJ(50, 20));
    expect(vaporizeRadius(c, tnt)).toBeGreaterThanOrEqual(1.3 * c.radiusM);
    // Höherer Überdruck wird nur näher am Zentrum erreicht
    expect(radiusForOverpressure(tnt, 1e6)).toBeLessThan(radiusForOverpressure(tnt, 1e5));
  });

  it('Eintrittsrichtung zeigt nach unten und folgt dem Azimut (ENU)', () => {
    const d = entryDirection(0, 45); // aus Norden
    expect(d.y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(d.z).toBeLessThan(0); // nach Süden ist +z, Flug nach Norden ist −z
    expect(entryDirection(Math.PI / 2, 30).x).toBeGreaterThan(0); // nach Osten
    expect(entryDirection(0, 90).y).toBeCloseTo(-1, 6);
  });

  it('Energie und Ladung lesbar formatiert', () => {
    expect(formatTnt(500)).toContain('kg');
    expect(formatTnt(5e4)).toContain(' t');
    expect(formatTnt(5e6)).toContain('kt');
    expect(formatTnt(9.4e9)).toContain('Mt');
    expect(formatEnergy(2.09e9)).toContain('MJ');
    expect(formatEnergy(3.9e16)).toContain('PJ');
  });
});

describe('Tornado (Spec 8)', () => {
  it('Rankine-Wirbel: innen linear, außen 1/r', () => {
    expect(rankineSpeed(25, 50, 80)).toBeCloseTo(40, 6);
    expect(rankineSpeed(50, 50, 80)).toBeCloseTo(80, 6);
    expect(rankineSpeed(100, 50, 80)).toBeCloseTo(40, 6);
    expect(rankineSpeed(0, 50, 80)).toBe(0);
  });

  it('Wind dreht gegen den Uhrzeigersinn, zieht nach innen und hebt im Kern', () => {
    const out = new Vector3();
    // Punkt östlich der Achse: tangential nach Norden (−z)
    vortexWind(60, 2, 0, 50, 80, out);
    expect(out.z).toBeLessThan(0);
    expect(out.x).toBeLessThan(0); // radial einwärts
    vortexWind(5, 2, 0, 50, 80, out);
    expect(out.y).toBeGreaterThan(10); // Aufwind im Kern
    // Weit oben trägt der Wirbel nicht mehr nach oben
    vortexWind(60, 400, 0, 50, 80, out);
    expect(out.y).toBeLessThan(0);
  });

  it('Luftwiderstand beschleunigt leichte Körper stärker, begrenzt auf das Maximum', () => {
    const air = new Vector3(80, 10, 0);
    const out = new Vector3();
    const light = windAccel(air, { x: 0, y: 0, z: 0 }, 1, 20, out).length();
    const heavy = windAccel(air, { x: 0, y: 0, z: 0 }, 1, 2_000, out).length();
    expect(light).toBeGreaterThan(heavy);
    expect(light).toBeLessThanOrEqual(VORTEX_MAX_ACCEL + 1e-6);
    // Körper, der mit dem Wind fliegt, bekommt nichts mehr
    expect(windAccel(air, { x: 80, y: 10, z: 0 }, 1, 20, out).length()).toBeCloseTo(0, 6);
  });

  it('Dächer reißen zuerst: EF1 deckt ab, erst EF5 trägt das Erdgeschoss ab', () => {
    expect(breakSpeed(1)).toBeLessThan(breakSpeed(0));
    expect(EF_SPEEDS[1]).toBeGreaterThan(breakSpeed(1));
    expect(EF_SPEEDS[3]).toBeLessThan(breakSpeed(0));
    expect(EF_SPEEDS[5]).toBeGreaterThan(breakSpeed(0));
  });
});

describe('Erdbeben (Spec 8)', () => {
  it('Bodenbeschleunigung steigt mit der Stärke und fällt mit der Entfernung', () => {
    expect(peakGroundAccelG(1)).toBeCloseTo(0.002, 4);
    expect(peakGroundAccelG(5)).toBeGreaterThan(0.1);
    expect(peakGroundAccelG(7)).toBeGreaterThan(peakGroundAccelG(5));
    expect(peakGroundAccelG(10)).toBeLessThanOrEqual(3);
    expect(peakGroundAccelG(7, 6_000)).toBeLessThan(peakGroundAccelG(7));
  });

  it('hohe Gebäude halten weniger aus, die Qualität streut je Gebäude', () => {
    expect(buildingCapacityG(1, 100)).toBeLessThan(buildingCapacityG(1, 10));
    const values = [1, 2, 3, 4, 5].map((id) => buildingCapacityG(id, 20));
    expect(new Set(values).size).toBe(5);
    expect(buildingCapacityG(7, 20)).toBe(buildingCapacityG(7, 20));
    for (const v of values) expect(v).toBeGreaterThan(0.1);
  });

  it('Verlauf: Anstieg, Plateau, Abklingen', () => {
    expect(quakeEnvelope(0, 20)).toBe(0);
    expect(quakeEnvelope(2, 20)).toBe(1);
    expect(quakeEnvelope(10, 20)).toBe(1);
    expect(quakeEnvelope(19, 20)).toBeLessThan(1);
    expect(quakeEnvelope(21, 20)).toBe(0);
  });
});

describe('Vulkan (Spec 8)', () => {
  it('Kegel: Flanken fallen nach außen ab, Gipfelkrater liegt tiefer als der Rand', () => {
    const c = coneSize(100);
    expect(c.radiusM).toBeCloseTo(240, 6);
    expect(coneOffset(0, c)).toBeLessThan(coneOffset(c.craterM, c));
    expect(coneOffset(c.craterM, c)).toBeGreaterThan(coneOffset(c.radiusM * 0.5, c));
    expect(coneOffset(c.radiusM, c)).toBe(0);
    expect(coneOffset(c.radiusM * 2, c)).toBe(0);
    expect(coneOffset(c.radiusM * 0.5, c)).toBeGreaterThan(0);
  });

  it('wächst schnell und läuft sanft aus', () => {
    expect(growth(0)).toBe(0);
    expect(growth(10)).toBeGreaterThan(0.5);
    expect(growth(100)).toBe(1);
  });

  it('Höhen-Patch erhebt das Gelände am Kegel', () => {
    const p = new HeightPatches();
    p.addCone(CENTER.lat, CENTER.lon, coneSize(80));
    expect(p.offsetAt(CENTER.lat, CENTER.lon)).toBeGreaterThan(50);
    expect(p.offsetAt(CENTER.lat + 0.01, CENTER.lon)).toBe(0);
  });
});

describe('Tsunami (Spec 8)', () => {
  it('Wellenprofil: steile Front, langer Rücken', () => {
    const h = 12;
    expect(waveHeightAt(0, h)).toBeCloseTo(h, 6);
    expect(waveHeightAt(0.5 * h, h)).toBe(0);
    expect(waveHeightAt(-backLength(h) - 1, h)).toBe(0);
    expect(waveHeightAt(-20, h)).toBeGreaterThan(0);
    expect(waveSpeed(12)).toBeGreaterThan(waveSpeed(3));
  });

  it('kommt vom tiefsten Rand der Blase', () => {
    // Gelände fällt nach Osten ab
    const a = lowestEdge((x) => -x, 500);
    expect(Math.cos(a)).toBeCloseTo(1, 1);
  });
});

describe('Wasser und Flut (Spec 6.3)', () => {
  it('eingetauchter Anteil zwischen 0 und 1', () => {
    expect(submergedFraction(0, 0.5, -1)).toBe(0);
    expect(submergedFraction(0, 0.5, 0)).toBeCloseTo(0.5, 6);
    expect(submergedFraction(0, 0.5, 5)).toBe(1);
    expect(halfHeight({ pool: null, scale: new Vector3(1, 1, 1), volume: 8 })).toBeCloseTo(1, 6);
  });

  it('Holz schwimmt auf, Beton sinkt', async () => {
    const world = new PhysicsWorld(R, { globe: new Group(), heightAt: () => 0, maxBodies: 50 });
    await world.ensureBubble(CENTER, 200);
    expect(lowestGround(world)).toBeCloseTo(0, 1);
    const wood = createBox(world, new Vector3(0, 1, 0), 1, 'wood');
    const concrete = createBox(world, new Vector3(5, 1, 0), 1, 'concrete');
    for (let i = 0; i < 300; i++) {
      applyWater(world, 6, 1 / 60);
      world.step(1 / 60);
    }
    expect(wood.pos.y).toBeGreaterThan(4);
    expect(wood.pos.y).toBeLessThan(7);
    expect(concrete.pos.y).toBeLessThan(2);
    world.dispose();
  });

  it('Strömung zieht treibende Körper mit', async () => {
    const world = new PhysicsWorld(R, { globe: new Group(), heightAt: () => 0, maxBodies: 50 });
    await world.ensureBubble(CENTER, 200);
    const box = createBox(world, new Vector3(0, 1, 0), 1, 'wood');
    for (let i = 0; i < 180; i++) {
      applyWater(world, 6, 1 / 60, 8, 0);
      world.step(1 / 60);
    }
    expect(box.pos.x).toBeGreaterThan(5);
    world.dispose();
  });
});

describe('Schwerkraft (Spec 8)', () => {
  it('0 g lässt Körper schweben, 3 g lässt sie schneller fallen', async () => {
    const world = new PhysicsWorld(R, { globe: new Group(), heightAt: () => 0, maxBodies: 50 });
    await world.ensureBubble(CENTER, 200);
    const box = createBox(world, new Vector3(0, 30, 0), 1, 'wood');
    world.setGravityScale(0);
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    expect(box.pos.y).toBeCloseTo(30, 1);
    world.setGravityScale(3);
    for (let i = 0; i < 60; i++) world.step(1 / 60);
    // Nach 1 s mit 3 g: etwa ½·3·9,81 ≈ 14,7 m gefallen
    expect(30 - box.pos.y).toBeGreaterThan(10);
    expect(30 - box.pos.y).toBeLessThan(3 * STANDARD_GRAVITY);
    world.dispose();
  });
});
