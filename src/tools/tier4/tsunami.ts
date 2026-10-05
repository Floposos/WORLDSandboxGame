import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  Group,
  Mesh,
  type ShaderMaterial,
  Vector3,
} from 'three';
import { STANDARD_GRAVITY } from '../../core/constants';
import { t } from '../../ui/i18n';
import { createWaterMaterial } from '../../world/water/water';
import { num, type Tool, type ToolContext } from '../Tool';

/** Länge des Rückens hinter dem Kamm (Vielfaches der Wellenhöhe, mindestens 60 m). */
export const backLength = (h: number): number => Math.max(60, 8 * h);

/**
 * Geschwindigkeit der Welle an Land (m/s): Flachwasserwelle √(g·h), zur Lesbarkeit verdoppelt
 * (SIMPLIFIED). 12 m hohe Welle ≈ 24 m/s.
 */
export function waveSpeed(h: number): number {
  return 2.2 * Math.sqrt(STANDARD_GRAVITY * Math.max(0.5, h));
}

/**
 * Wasserhöhe über dem Wellenfuß im Abstand `u` zur Wellenfront (positiv = vor dem Kamm):
 * steile Front bis 0,5 · H voraus, langer Rücken bis {@link backLength} dahinter.
 */
export function waveHeightAt(u: number, h: number): number {
  const front = 0.5 * h;
  if (u >= front) return 0;
  if (u >= 0) return h * (1 - u / front);
  const l = backLength(h);
  if (u <= -l) return 0;
  return h * (0.2 + 0.8 * (1 + u / l) ** 2);
}

/** Wellen-Mesh: Profil (Rücken, Kamm, überhängende Front) quer über die ganze Breite. */
function createWave(h: number, width: number): Mesh<BufferGeometry, ShaderMaterial> {
  const l = backLength(h);
  // (u, y) von hinten nach vorn
  const profile: [number, number][] = [
    [-l, 0.12 * h],
    [-0.7 * l, 0.3 * h],
    [-0.4 * l, 0.5 * h],
    [-0.15 * l, 0.78 * h],
    [-0.03 * l, 0.97 * h],
    [0.06 * h, 1.04 * h],
    [0.22 * h, 0.95 * h],
    [0.36 * h, 0.66 * h],
    [0.46 * h, 0.3 * h],
    [0.52 * h, -2],
  ];
  const seg = 48;
  const cols = seg + 1;
  const pos = new Float32Array(profile.length * cols * 3);
  for (let i = 0; i < profile.length; i++) {
    const [u, y] = profile[i]!;
    for (let j = 0; j <= seg; j++) {
      const k = (i * cols + j) * 3;
      pos[k] = (j / seg - 0.5) * width;
      pos[k + 1] = y;
      pos[k + 2] = u;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = createWaterMaterial();
  material.uniforms.uFoam!.value = 0.25;
  const mesh = new Mesh(geo, material);
  mesh.name = 'tsunami';
  mesh.renderOrder = 2;
  return mesh;
}

/** Richtung (Winkel in der Ebene x/z) mit dem tiefsten Gelände am Blasenrand: dort ist Wasser. */
export function lowestEdge(groundY: (x: number, z: number) => number, radius: number): number {
  let best = 0;
  let min = Infinity;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    let sum = 0;
    for (const f of [0.75, 0.88, 0.97])
      sum += groundY(Math.cos(a) * radius * f, Math.sin(a) * radius * f);
    if (sum < min) {
      min = sum;
      best = a;
    }
  }
  return best;
}

const _rel = new Vector3();
const _imp = { x: 0, y: 0, z: 0 };
const _front = new Vector3();

/** Tsunami Richtung `target` (Blasen-Frame) schicken; Herkunft = tiefster Blasenrand. */
export function startTsunami(ctx: ToolContext, target: Vector3, h: number): void {
  const physics = ctx.physics;
  const frame = physics.frame;
  const r = physics.radius;
  const a = lowestEdge((x, z) => physics.groundY(x, z), r);
  const start = new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  const dir = new Vector3(target.x - start.x, 0, target.z - start.z);
  if (dir.lengthSq() < 1) dir.set(-start.x, 0, -start.z);
  dir.normalize();
  const baseY = Math.min(ctx.water.surfaceY, ctx.water.baseY);
  const wave = createWave(h, r * 2.4);
  const group = new Group();
  group.add(wave);
  group.position.set(start.x, baseY, start.z);
  group.rotation.y = Math.atan2(dir.x, dir.z);
  physics.group.add(group);
  const speed = waveSpeed(h);
  const total = 2.3 * r;
  const l = backLength(h);
  let s = 0;
  let time = 0;
  let damageAcc = 0;
  let sprayAcc = 0;
  const effects = ctx.effects;
  const finish = (): boolean => {
    group.removeFromParent();
    wave.geometry.dispose();
    wave.material.dispose();
    return true;
  };
  ctx.addTask((dt) => {
    if (physics.frame !== frame) return finish();
    time += dt;
    s += speed * dt;
    if (s > total) {
      // Danach bleibt das Wasser eine Weile stehen und läuft ab
      ctx.water.surge = Math.max(ctx.water.surge, 0.35 * h);
      return finish();
    }
    _front.copy(start).addScaledVector(dir, s);
    group.position.set(_front.x, baseY, _front.z);
    wave.material.uniforms.uTime!.value = time;
    const wu = wave.material.uniforms;
    const fu = ctx.water.mesh.material.uniforms;
    (wu.uSunDir!.value as Vector3).copy(fu.uSunDir!.value as Vector3);
    (wu.uSky!.value as Color).copy(fu.uSky!.value as Color);
    wu.uLight!.value = fu.uLight!.value as number;

    // Kraftfeld: Körper im Wasserkörper der Welle werden mitgerissen und angehoben
    for (const b of physics.allBodies()) {
      const rb = b.rb;
      if (!rb || b.pinned) continue;
      _rel.subVectors(b.pos, _front);
      const u = _rel.x * dir.x + _rel.z * dir.z;
      if (u > 0.6 * h || u < -l) continue;
      const top = baseY + waveHeightAt(u, h);
      if (b.pos.y > top + 0.5) continue;
      if (b.frozen) physics.unfreeze(b);
      const v = rb.linvel();
      const m = rb.mass();
      const k = Math.min(1, 2.5 * dt) * m;
      const flow = u > -0.3 * l ? speed * 0.9 : speed * 0.4;
      _imp.x = (dir.x * flow - v.x) * k;
      _imp.y = (Math.max(2, top - b.pos.y) * 0.8 - v.y) * k * 0.5;
      _imp.z = (dir.z * flow - v.z) * k;
      rb.applyImpulse(_imp, true);
    }

    // Gebäude: Staudruck der Front (½ ρ v² ≈ 290 kPa bei 24 m/s) reißt untere Stücke heraus
    damageAcc += dt;
    if (damageAcc >= 0.25) {
      damageAcc = 0;
      ctx.destruction?.damage(
        _front,
        r * 1.3,
        {
          building: (bd) => {
            const u = (bd.x - _front.x) * dir.x + (bd.z - _front.z) * dir.z;
            const half = Math.sqrt(bd.areaM2) * 0.6;
            if (u > 0.5 * h + half || u < -20 - half) return false;
            return physics.groundY(bd.x, bd.z) < baseY + h * 0.8;
          },
          fragment: (p, _rel2, dv) => {
            const u = (p.x - _front.x) * dir.x + (p.z - _front.z) * dir.z;
            if (u > 0.6 * h || u < -0.3 * l) return false;
            if (p.y > baseY + waveHeightAt(Math.min(u, 0), h) * 0.9) return false;
            dv.copy(dir).multiplyScalar(speed * 0.5);
            dv.y = 1;
            return true;
          },
        },
        4,
      );
    }

    // Gischt am Kamm
    sprayAcc += dt * 30;
    while (sprayAcc >= 1) {
      sprayAcc -= 1;
      const off = effects.range(-1, 1) * r;
      _rel.set(-dir.z * off, 0, dir.x * off).add(_front);
      _rel.y = baseY + h * 1.02;
      effects.emit('smoke', _rel, dir, speed * effects.range(0.6, 1), {
        life: effects.range(1.5, 3),
        size0: h * 0.4,
        size1: h * 1.4,
        r: 0.9,
        g: 0.93,
        b: 0.95,
        a: 0.55,
        gravity: 0.4,
        drag: 0.8,
        wind: 0.5,
      });
    }
    if (time % 1 < dt) {
      const cam = physics.worldToBubble(ctx.view.position);
      ctx.audio.rumble(cam.distanceTo(_front), 1.5);
    }
    return false;
  });
}

/**
 * `tsunami` (Spec 8): Eine Welle läuft vom Wasser (tiefster Rand der Blase) aufs Land, Richtung
 * Klickpunkt. SIMPLIFIED: Wasserwand-Mesh plus Kraftfeld, keine Strömungssimulation.
 */
export function createTsunamiTool(): Tool {
  const tt = t.tools.tsunami;
  return {
    id: 'tsunami',
    name: tt.name,
    tier: 4,
    icon: 'tsunami',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'height',
        label: tt.height,
        type: 'number',
        min: 3,
        max: 30,
        step: 1,
        unit: 'm',
        default: 12,
      },
    ],
    onPointerDown(hit, ctx, params) {
      startTsunami(ctx, hit.local.clone(), num(params.height, 12));
      ctx.toast('info', tt.started);
    },
  };
}
