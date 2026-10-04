import { beforeAll, describe, expect, it } from 'vitest';
import { AdditiveBlending, Group, MeshBasicMaterial, Vector3 } from 'three';
import { explosionMix } from '../../src/audio/audio';
import { SPEED_OF_SOUND } from '../../src/core/constants';
import { createGameEvents } from '../../src/core/events';
import { createBox } from '../../src/physics/bodies';
import { craterSize, type CraterSize } from '../../src/physics/blast';
import { Destruction } from '../../src/physics/destruction';
import { loadRapier, type Rapier } from '../../src/physics/rapier';
import { PhysicsWorld } from '../../src/physics/world';
import { createDefaultRegistry } from '../../src/tools/index';
import {
  ExplosionService,
  explosionSummary,
  MIN_CRATER_TNT_KG,
  sumResults,
} from '../../src/tools/explosions';
import { bombScale, fallTime } from '../../src/tools/tier3/projectiles';
import { ParticleSystem } from '../../src/vfx/particles';
import type { CraterService } from '../../src/world/craters';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const CENTER = { lat: 53.55, lon: 9.995, height: 0 };

describe('Explosions-Ton (Spec 7.6)', () => {
  it('leiser, dumpfer und später mit der Entfernung', () => {
    const near = explosionMix(10, 100);
    const far = explosionMix(1_000, 100);
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.cutoffHz).toBeLessThan(near.cutoffHz);
    expect(far.delayS).toBeCloseTo(1_000 / SPEED_OF_SOUND, 6);
    expect(near.gain).toBeLessThanOrEqual(1);
  });

  it('größere Ladung klingt länger und lauter', () => {
    const small = explosionMix(100, 1);
    const big = explosionMix(100, 1_000);
    expect(big.durationS).toBeGreaterThan(small.durationS);
    expect(big.gain).toBeGreaterThan(small.gain);
  });
});

describe('Bilanz nach dem Einschlag', () => {
  it('nennt Energie, Krater und beschädigte Gebäude, keine Opferzahlen', () => {
    const text = explosionSummary({
      tntKg: 500,
      bodies: 3,
      fragments: 40,
      damagedBuildings: 2,
      crater: craterSize(500, 0),
      radiusM: 100,
    });
    expect(text).toContain('500 kg TNT');
    // 500 kg · 4,184 MJ/kg
    expect(text).toContain('2.092 MJ');
    expect(text).toMatch(/Krater \d+(,\d)? m/);
    expect(text).toContain('2 Gebäude');
    expect(text).not.toMatch(/Tote|Opfer|Verletzte/);
  });

  it('fasst mehrere Ladungen zusammen', () => {
    const c: CraterSize = craterSize(10, 0);
    const r = sumResults([
      { tntKg: 5, bodies: 1, fragments: 2, damagedBuildings: 1, crater: null, radiusM: 10 },
      { tntKg: 10, bodies: 2, fragments: 3, damagedBuildings: 0, crater: c, radiusM: 20 },
    ]);
    expect(r).toMatchObject({ tntKg: 15, bodies: 3, fragments: 5, damagedBuildings: 1 });
    expect(r.crater).toBe(c);
    expect(r.radiusM).toBe(20);
  });
});

describe('Fliegerbombe', () => {
  it('Fallzeit physikalisch: 500 m in rund 10 s', () => {
    expect(fallTime(500, 9.81)).toBeCloseTo(Math.sqrt(1000 / 9.81), 6);
    expect(fallTime(-5, 9.81)).toBe(0);
    expect(bombScale(500)).toBeCloseTo(1, 6);
  });
});

describe('Werkzeuge Stufe 3', () => {
  it('sind registriert und brauchen Physik', () => {
    const r = createDefaultRegistry();
    const ids = r.byTier(3).map((t) => t.id);
    expect(ids).toEqual(['grenade', 'aerial-bomb', 'demolition-charge', 'rocket']);
    for (const t of r.byTier(3)) expect(t.needsPhysics).toBe(true);
    const bomb = r.get('aerial-bomb')!;
    const charge = bomb.params.find((p) => p.key === 'charge')!;
    expect([charge.min, charge.max]).toEqual([50, 1_000]);
    const grenade = r.get('grenade')!.params.find((p) => p.key === 'charge')!;
    expect([grenade.min, grenade.max]).toEqual([0.2, 2]);
  });
});

describe('GPU-Partikel', () => {
  it('Ringpuffer: lebende Partikel, Ablauf und Überlauf', () => {
    const ps = new ParticleSystem(4, AdditiveBlending, 'test');
    const spec = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 1,
      vz: 0,
      life: 1,
      size0: 1,
      size1: 2,
      r: 1,
      g: 1,
      b: 1,
      a: 1,
      endTint: 1,
      gravity: 0,
      rise: 0,
      drag: 0,
      wind: 0,
      floor: -1e9,
    };
    for (let i = 0; i < 6; i++) ps.emit(spec);
    expect(ps.alive).toBe(4);
    ps.update(0.5);
    expect(ps.alive).toBe(4);
    ps.update(0.6);
    expect(ps.alive).toBe(0);
    ps.emit(spec);
    ps.clear();
    expect(ps.alive).toBe(0);
    ps.dispose();
  });
});

describe('Explosions-Dienst (Spec 7.3/7.4)', () => {
  async function setup(withCrater: boolean) {
    const world = new PhysicsWorld(R, { globe: new Group(), heightAt: () => 0, maxBodies: 500 });
    await world.ensureBubble(CENTER, 200);
    const events = createGameEvents();
    const destruction = new Destruction(world, {
      material: new MeshBasicMaterial(),
      hideInCell: () => undefined,
    });
    const added: CraterSize[] = [];
    const craters = withCrater
      ? ({
          add: (_g: unknown, s: CraterSize) => (added.push(s), added.length),
        } as unknown as CraterService)
      : null;
    const service = new ExplosionService({ physics: world, destruction, events, craters });
    return { world, events, service, added };
  }

  it('stößt Körper weg vom Zentrum, meldet das Ereignis und hinterlässt einen Krater', async () => {
    const { world, events, service, added } = await setup(true);
    const box = createBox(world, new Vector3(6, 0.5, 0), 1, 'wood');
    let event: unknown = null;
    events.on('explosion', (e) => (event = e));
    let crater: unknown = null;
    events.on('craterCreated', (e) => (crater = e));
    const r = service.detonate(new Vector3(0, 0.2, 0), 50);
    expect(r.bodies).toBe(1);
    const v = box.rb!.linvel();
    expect(v.x).toBeGreaterThan(1);
    expect(v.y).toBeGreaterThan(0);
    expect(event).toMatchObject({ tntEquivalentKg: 50 });
    expect(added.length).toBe(1);
    expect(r.crater?.radiusM).toBeGreaterThan(1);
    expect(crater).not.toBeNull();
    world.dispose();
  });

  it('kleine Ladungen und Luftdetonationen hinterlassen keinen Krater', async () => {
    const { world, service, added } = await setup(true);
    expect(service.detonate(new Vector3(0, 0, 0), MIN_CRATER_TNT_KG / 2).crater).toBeNull();
    expect(service.detonate(new Vector3(0, 60, 0), 50, { burstHeightM: 60 }).crater).toBeNull();
    expect(added.length).toBe(0);
    world.dispose();
  });
});
