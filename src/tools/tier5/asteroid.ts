import {
  AdditiveBlending,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
  type BufferAttribute,
} from 'three';
import { TNT_J_PER_KG } from '../../core/constants';
import { haversineDistance } from '../../core/geo';
import type { GeoPoint } from '../../core/types';
import {
  finalCraterM,
  gloomFromEnergy,
  meteorEnergyJ,
  tntKgFromJoule,
  transientCraterM,
} from '../../physics/impact';
import { t } from '../../ui/i18n';
import { EARTH_RADIUS_M } from '../../world/globeFx/overlay';
import { formatEnergy, formatLength, formatTnt } from '../explosions';
import { num, type GlobeToolContext, type Tool } from '../Tool';
import { entryDirection } from '../tier4/meteor';

/** Anflug in der Darstellung (s; real wenige Minuten aus 6 000 km, SIMPLIFIED). */
export const ASTEROID_APPROACH_S = 7;
/** Der Anflug beginnt so weit vom Ziel entfernt (m). */
export const ASTEROID_START_M = 6_000_000;
/** Die Druckwelle läuft in dieser Zeit bis zu ihrem größten Radius (s). */
const SHOCK_S = 20;
/** Halber Erdumfang (m): größer kann ein Ring auf der Kugel nicht werden. */
const HALF_EARTH_M = Math.PI * EARTH_RADIUS_M;

export interface AsteroidImpact {
  energyJ: number;
  tntKg: number;
  /** Endkrater (m Durchmesser), Collins et al. (2005). */
  craterM: number;
  /** Größter Radius der sichtbaren Druckwelle auf dem Globus (m). */
  shockM: number;
  /** Staubdecke (m Radius): ab ≈ 10 km Durchmesser die ganze Erde. */
  dustM: number;
  /** Verdunkelung 0…1. */
  gloom: number;
}

/** Folgen eines Einschlags (Durchmesser in m, Geschwindigkeit in km/s, Winkel in Grad). */
export function asteroidImpact(
  diameterM: number,
  speedKms: number,
  angleDeg: number,
): AsteroidImpact {
  const energyJ = meteorEnergyJ(diameterM, speedKms);
  const craterM = finalCraterM(transientCraterM(diameterM, speedKms, angleDeg));
  const gloom = gloomFromEnergy(energyJ);
  // SIMPLIFIED, rein visuell: Druckwelle ≈ 25 Kraterradien, Staub mit der Verdunkelung
  const shockM = Math.min(HALF_EARTH_M * 0.95, Math.max(300_000, craterM * 12));
  const dustM = gloom >= 0.99 ? HALF_EARTH_M : Math.max(craterM * 3, gloom * HALF_EARTH_M);
  return { energyJ, tntKg: tntKgFromJoule(energyJ), craterM, shockM, dustM, gloom };
}

/** Bilanz für den Toast (ohne Opferzahlen). */
export function asteroidSummary(diameterM: number, a: AsteroidImpact): string {
  return t.tools.asteroid.summary
    .replace('{d}', formatLength(diameterM))
    .replace('{tnt}', formatTnt(a.tntKg))
    .replace('{energy}', formatEnergy(a.energyJ))
    .replace('{crater}', formatLength(a.craterM));
}

/** Zerklüfteter Gesteinsbrocken (Einheitsradius). */
function rockGeometry(seed: number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position') as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 3.1 + seed) *
      Math.sin(v.y * 2.7 + seed * 1.3) *
      Math.sin(v.z * 3.7 + seed * 0.7);
    v.multiplyScalar(0.82 + 0.18 * n + 0.06 * Math.sin(v.x * 9 + v.y * 7));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function createAsteroidVisual(): Group {
  const g = new Group();
  g.name = 'asteroid';
  const rock = new Mesh(rockGeometry(1.7), new MeshLambertMaterial({ color: 0x5b5148 }));
  const glow = new Mesh(
    new SphereGeometry(1.6, 24, 16),
    new MeshBasicMaterial({
      color: 0xff7a2a,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  // Plasmaschweif hinter dem Kopf (lokal +z = zurück)
  const tail = new Mesh(
    new ConeGeometry(1.4, 16, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 9),
    new MeshBasicMaterial({
      color: 0xffa050,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  for (const m of [rock, glow, tail]) m.raycast = () => undefined;
  g.add(rock, glow, tail);
  return g;
}

const _fwd = new Vector3(0, 0, -1);
const _cam = new Vector3();
const _world = new Vector3();

/**
 * `asteroid` (Spec 8, Stufe 5): 1 bis 50 km, aus der Globusansicht gezielt. Der Brocken fliegt
 * sichtbar an; der Einschlag zeigt Lichtblitz, Druckwellen-Ring, Krater (Collins et al., 2005,
 * mit komplexen Kratern) und eine Staubdecke, die bei großen Körpern die ganze Erde verdunkelt.
 * Liegt die Simulationsblase in Reichweite, wird sie ausgelöscht.
 */
export function createAsteroidTool(): Tool {
  const tt = t.tools.asteroid;
  return {
    id: 'asteroid',
    name: tt.name,
    tier: 5,
    icon: 'asteroid',
    description: tt.description,
    targetMode: 'globe',
    params: [
      {
        key: 'diameter',
        label: tt.diameter,
        type: 'number',
        min: 1,
        max: 50,
        step: 1,
        unit: 'km',
        default: 10,
      },
      {
        key: 'speed',
        label: tt.speed,
        type: 'number',
        min: 11,
        max: 72,
        step: 1,
        unit: 'km/s',
        default: 20,
      },
      {
        key: 'angle',
        label: tt.angle,
        type: 'number',
        min: 15,
        max: 90,
        step: 5,
        unit: '°',
        default: 45,
      },
    ],
    onGlobeTarget(target, ctx, params) {
      launchAsteroid(ctx, target.geo, {
        diameterM: num(params.diameter, 10) * 1_000,
        speedKms: num(params.speed, 20),
        angleDeg: num(params.angle, 45),
      });
    },
  };
}

export interface AsteroidOptions {
  diameterM: number;
  speedKms: number;
  angleDeg: number;
}

/** Asteroid auf `geo` schicken; Effekte laufen als Aufgabe der Globus-Effekte. */
export function launchAsteroid(
  ctx: GlobeToolContext,
  geo: GeoPoint,
  o: AsteroidOptions,
): AsteroidImpact {
  const fx = ctx.globeFx;
  const impact = asteroidImpact(o.diameterM, o.speedKms, o.angleDeg);
  const anchor = fx.anchor(geo);
  const visual = createAsteroidVisual();
  anchor.add(visual);
  // Von der Kamera aus schräg seitlich anfliegen, damit die Bahn quer durchs Bild zieht
  anchor.updateMatrixWorld(true);
  const camLocal = anchor.worldToLocal(_cam.copy(ctx.view.position));
  const toTarget = Math.atan2(-camLocal.x, camLocal.z);
  const dir = entryDirection(toTarget + (Math.PI / 180) * 70, o.angleDeg);
  const start = dir.clone().multiplyScalar(-ASTEROID_START_M);
  visual.quaternion.setFromUnitVectors(_fwd, dir);
  visual.position.copy(start);
  const r = o.diameterM / 2;
  ctx.toast(
    'info',
    t.tools.asteroid.incoming
      .replace('{tnt}', formatTnt(impact.tntKg))
      .replace('{energy}', formatEnergy(impact.tntKg * TNT_J_PER_KG)),
  );
  const glow = visual.children[1] as Mesh<SphereGeometry, MeshBasicMaterial>;
  const tail = visual.children[2] as Mesh<ConeGeometry, MeshBasicMaterial>;
  let time = 0;
  fx.addTask((dt) => {
    time += dt;
    const k = Math.min(1, time / ASTEROID_APPROACH_S);
    visual.position.copy(start).multiplyScalar(1 - k);
    // Aus der Ferne mindestens als heller Punkt sichtbar (≈ 0,5 % der Entfernung)
    visual.getWorldPosition(_world);
    const dist = _world.distanceTo(ctx.view.position);
    visual.scale.setScalar(Math.max(r, dist * 0.004));
    // Beim Eintritt in die Atmosphäre glüht der Brocken auf (Höhe über dem Ziel)
    const heat = Math.min(1, Math.max(0, 1 - (visual.position.y - 120_000) / 600_000));
    glow.material.opacity = 0.2 + 0.6 * heat;
    tail.material.opacity = 0.15 + 0.5 * heat;
    if (k < 1) return false;
    impactAt(ctx, geo, impact, o.diameterM);
    visual.traverse((m) => {
      if (m instanceof Mesh) {
        (m.geometry as IcosahedronGeometry).dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
    });
    fx.removeAnchor(anchor);
    return true;
  });
  return impact;
}

/** Einschlag: Effekte auf dem Globus, Verdunkelung, Blase auslöschen, Bilanz. */
function impactAt(
  ctx: GlobeToolContext,
  geo: GeoPoint,
  a: AsteroidImpact,
  diameterM: number,
): void {
  const fx = ctx.globeFx;
  const craterR = a.craterM / 2;
  fx.add({
    geo,
    flash: { seconds: 4 },
    shock: { maxM: a.shockM, speedMs: a.shockM / SHOCK_S },
    crater: { radiusM: craterR },
    molten: { maxM: craterR * 1.15, growS: 3, alpha: 0.85 },
    dust: { maxM: a.dustM, growS: 45, alpha: 0.7 },
  });
  fx.darken(a.gloom);
  const cam = ctx.view.position.distanceTo(ctx.origin.geoToWorld(geo));
  ctx.audio.explosion(cam, Math.min(a.tntKg, 1e12));
  ctx.effects.addShake(Math.min(1, 2e6 / Math.max(1, cam)));
  ctx.events.emit('impact', {
    posLocal: { x: 0, y: 0, z: 0 },
    energyJ: a.energyJ,
    source: 'asteroid',
  });
  // Simulationsblase in Reichweite: nichts bleibt stehen
  const physics = ctx.physics;
  if (physics?.frame) {
    const center = physics.bubbleToGeo(new Vector3());
    if (haversineDistance(center, geo) < Math.max(craterR * 12, 50_000)) {
      ctx.destruction?.vaporize(new Vector3(), physics.radius * 2);
      physics.clearBodies();
    }
  }
  ctx.toast('info', asteroidSummary(diameterM, a));
}
