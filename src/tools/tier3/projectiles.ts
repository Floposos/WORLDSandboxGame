import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { PhysicsWorld } from '../../physics/world';

/**
 * Gemeinsame, einmal erzeugte Geometrien und Materialien der Sprengkörper. Sie werden nie
 * freigegeben (wenige Dreiecke, leben so lange wie die Seite).
 */
let shared: {
  grenade: BufferGeometry;
  bombBody: BufferGeometry;
  bombNose: BufferGeometry;
  bombFin: BufferGeometry;
  rocketBody: BufferGeometry;
  rocketNose: BufferGeometry;
  charge: BufferGeometry;
  olive: Material;
  steel: Material;
  red: Material;
  orange: Material;
} | null = null;

function assets(): NonNullable<typeof shared> {
  shared ??= {
    grenade: new SphereGeometry(0.06, 12, 8),
    bombBody: new CylinderGeometry(0.25, 0.25, 1.6, 16),
    bombNose: new SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    bombFin: new BoxGeometry(0.75, 0.4, 0.04),
    rocketBody: new CylinderGeometry(0.06, 0.06, 0.9, 10),
    rocketNose: new ConeGeometry(0.06, 0.22, 10),
    charge: new BoxGeometry(0.3, 0.2, 0.08),
    olive: new MeshStandardMaterial({ color: 0x4b5320, roughness: 0.7, metalness: 0.2 }),
    steel: new MeshStandardMaterial({ color: 0x5a5f63, roughness: 0.5, metalness: 0.6 }),
    red: new MeshStandardMaterial({ color: 0x9b2420, roughness: 0.6 }),
    orange: new MeshStandardMaterial({
      color: 0xd9822b,
      roughness: 0.6,
      emissive: 0x401800,
    }),
  };
  return shared;
}

/** Handgranate als Physikkörper (Kugel, ~0,45 kg), fliegt mit `velocity`. */
export function createGrenade(physics: PhysicsWorld, pos: Vector3, velocity: Vector3) {
  const a = assets();
  const mesh = new Mesh(a.grenade, a.olive);
  mesh.name = 'grenade';
  const { rb, collider } = physics.createDynamic(
    pos.x,
    pos.y,
    pos.z,
    physics.R.ColliderDesc.ball(0.06).setDensity(500).setRestitution(0.3).setFriction(0.7),
    (d) => d.setCcdEnabled(true).setLinvel(velocity.x, velocity.y, velocity.z),
  );
  return physics.register('projectile', rb, [collider], { object: mesh }, 0.001);
}

/**
 * Fliegerbombe: Träger, dessen −z waagrecht liegt (für die Verfolgerkamera), darin die Bombe
 * mit der Spitze nach unten.
 */
export function createBombVisual(scale: number): Group {
  const a = assets();
  const carrier = new Group();
  carrier.name = 'aerial-bomb';
  const bomb = new Group();
  const body = new Mesh(a.bombBody, a.olive);
  const nose = new Mesh(a.bombNose, a.olive);
  nose.position.y = -0.8;
  nose.rotation.x = Math.PI;
  bomb.add(body, nose);
  for (let i = 0; i < 2; i++) {
    const fin = new Mesh(a.bombFin, a.steel);
    fin.position.y = 0.85;
    fin.rotation.y = (i * Math.PI) / 2;
    bomb.add(fin);
  }
  bomb.scale.setScalar(scale);
  carrier.add(bomb);
  return carrier;
}

/** Rakete (Spitze entlang −z des Objekts). */
export function createRocketVisual(): Group {
  const a = assets();
  const g = new Group();
  g.name = 'rocket';
  const body = new Mesh(a.rocketBody, a.steel);
  body.rotation.x = Math.PI / 2;
  const nose = new Mesh(a.rocketNose, a.red);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.56;
  g.add(body, nose);
  return g;
}

/** Sprengladung (flacher Block, Rückseite an der Wand). */
export function createChargeVisual(): Mesh {
  const a = assets();
  const m = new Mesh(a.charge, a.orange);
  m.name = 'demolition-charge';
  return m;
}

/** Bombenmaßstab aus der Masse (500 kg ≈ Faktor 1, Länge ≈ 2 m). */
export function bombScale(massKg: number): number {
  return Math.cbrt(massKg / 500);
}

/** Fallzeit aus `heightM` ohne Luftwiderstand: t = √(2h/g). */
export function fallTime(heightM: number, g: number): number {
  return Math.sqrt((2 * Math.max(0, heightM)) / g);
}

const _up = new Vector3(0, 1, 0);

/** Waagrechte Blickrichtung von `from` nach `to` (Fallback: Norden). */
export function horizontalDir(from: Vector3, to: Vector3, out = new Vector3()): Vector3 {
  out.set(to.x - from.x, 0, to.z - from.z);
  if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
  return out.normalize();
}

export { _up as UP };
