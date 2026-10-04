import { Quaternion, Vector3 } from 'three';
import { MATERIALS, type MaterialId, type PhysicsWorld, type SimBody } from './world';

/**
 * Fabriken für Körper (Spec 4.1 `bodies.ts`). Positionen im Blasen-Frame
 * (x = Ost, y = Oben, z = −Nord), Größen in m.
 */

export interface SpawnOptions {
  /** Anfangsgeschwindigkeit (Blasen-Frame). */
  velocity?: Vector3;
  rotation?: Quaternion;
  /** Schlafend erzeugen (Mauern: stehen stabil, bis etwas sie trifft). */
  sleeping?: boolean;
}

function applyOptions(body: SimBody, opts: SpawnOptions): void {
  if (opts.velocity) body.rb?.setLinvel(opts.velocity, true);
}

export function createBox(
  world: PhysicsWorld,
  pos: Vector3,
  size: Vector3 | number,
  material: MaterialId,
  opts: SpawnOptions = {},
  kind: 'box' | 'brick' = 'box',
): SimBody {
  const s = typeof size === 'number' ? new Vector3(size, size, size) : size;
  const m = MATERIALS[material];
  const { rb, collider } = world.createDynamic(
    pos.x,
    pos.y,
    pos.z,
    world.R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2)
      .setDensity(m.density)
      .setFriction(m.friction)
      .setRestitution(m.restitution),
    (d) => {
      if (opts.rotation) d.setRotation(opts.rotation);
      if (opts.sleeping) d.setSleeping(true);
    },
  );
  const body = world.register(
    kind,
    rb,
    [collider],
    { pool: world.pools.box, color: m.color, scale: s },
    s.x * s.y * s.z,
  );
  applyOptions(body, opts);
  return body;
}

export function createBall(
  world: PhysicsWorld,
  pos: Vector3,
  radius: number,
  material: MaterialId,
  opts: SpawnOptions = {},
): SimBody {
  const m = MATERIALS[material];
  const { rb, collider } = world.createDynamic(
    pos.x,
    pos.y,
    pos.z,
    world.R.ColliderDesc.ball(radius)
      .setDensity(m.density)
      .setFriction(m.friction)
      .setRestitution(m.restitution),
    (d) => d.setAngularDamping(0.3),
  );
  const body = world.register(
    'ball',
    rb,
    [collider],
    { pool: world.pools.ball, color: m.color, scale: new Vector3(radius, radius, radius) },
    (4 / 3) * Math.PI * radius ** 3,
  );
  applyOptions(body, opts);
  return body;
}

/** NPC-Farben: gedeckte Kleidung, damit Gruppen lebendig wirken. */
const NPC_COLORS = [0x3d5a80, 0xc8553d, 0x5b8e7d, 0xe0a458, 0x6d597a, 0x355070, 0xb56576];

/** Abstrakte NPC-Kapsel (Spec 8 `place-npcs`): aufrecht, wandert, fällt bei Stößen um. */
export function createNpc(world: PhysicsWorld, pos: Vector3, colorIndex: number): SimBody {
  const { rb, collider } = world.createDynamic(
    pos.x,
    pos.y + 0.85,
    pos.z,
    // Masse ≈ 75 kg (Kapsel ist dicker als ein Mensch)
    world.R.ColliderDesc.capsule(0.6, 0.25).setDensity(250).setFriction(0.6),
    (d) => d.lockRotations().setLinearDamping(0.2),
  );
  const body = world.register(
    'npc',
    rb,
    [collider],
    { pool: world.pools.npc, color: NPC_COLORS[colorIndex % NPC_COLORS.length]! },
    0.3,
  );
  body.npc = { heading: world.random() * Math.PI * 2, nextTurn: 0, fallen: false };
  return body;
}

/** Ziegelmaß der Mauer (Länge × Höhe × Tiefe) in m. */
export const BRICK = { l: 1, h: 0.5, d: 0.5 } as const;

/**
 * Mauer aus stapelbaren Blöcken (Spec 8 `place-wall`) von `a` nach `b` (Fußpunkte im
 * Blasen-Frame), versetzter Verband. Blöcke starten schlafend, damit die Mauer steht.
 */
export function createWall(
  world: PhysicsWorld,
  a: Vector3,
  b: Vector3,
  heightM: number,
  material: MaterialId,
  groundY: (x: number, z: number) => number,
): SimBody[] {
  const dir = new Vector3(b.x - a.x, 0, b.z - a.z);
  const length = Math.min(40, dir.length());
  if (length < 0.5) return [];
  dir.normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const rows = Math.max(1, Math.round(heightM / BRICK.h));
  const count = Math.max(1, Math.round(length / BRICK.l));
  const step = length / count;
  const size = new Vector3(step * 0.98, BRICK.h * 0.98, BRICK.d);
  // Fuß der Mauer: höchster Geländepunkt entlang der Linie, damit kein Block im Boden steckt
  let base = -Infinity;
  for (let i = 0; i <= count; i++) {
    base = Math.max(base, groundY(a.x + dir.x * step * i, a.z + dir.z * step * i));
  }
  const out: SimBody[] = [];
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : step / 2;
    const n = r % 2 === 0 ? count : count - 1;
    for (let i = 0; i < n; i++) {
      const s = offset + step * (i + 0.5);
      const p = new Vector3(a.x + dir.x * s, base + BRICK.h * (r + 0.5) + 0.01, a.z + dir.z * s);
      out.push(createBox(world, p, size, material, { rotation: rot, sleeping: true }, 'brick'));
    }
  }
  return out;
}
