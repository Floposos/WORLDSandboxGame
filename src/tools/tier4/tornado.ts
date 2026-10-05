import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3 } from 'three';
import { breakSpeed, EF_SPEEDS, vortexWind, windAccel } from '../../physics/vortex';
import type { SimBody } from '../../physics/world';
import { t } from '../../ui/i18n';
import { num, type Tool, type ToolContext } from '../Tool';

/** Höhe des sichtbaren Trichters (m). */
const FUNNEL_HEIGHT_M = 450;
/** Zuggeschwindigkeit über Grund (m/s); reale Tornados ziehen mit 10 bis 20 m/s. */
export const TORNADO_SPEED_MS = 12;
/** So oft prüft der Tornado Gebäude in seiner Nähe (s). */
const DAMAGE_EVERY_S = 0.2;
/** Höchstens so viele Gebäude werden pro Prüfung neu gebrochen. */
const MAX_NEW_PER_CHECK = 3;

/** Trichter-Mesh: unten schmal, oben weit, mit Rauschstreifen im Shader, die sich drehen. */
function createFunnel(coreR: number): Mesh<BufferGeometry, ShaderMaterial> {
  const rings = 24;
  const seg = 32;
  const pos = new Float32Array((rings + 1) * (seg + 1) * 3);
  const uv = new Float32Array((rings + 1) * (seg + 1) * 2);
  for (let i = 0; i <= rings; i++) {
    const v = i / rings;
    const h = v * FUNNEL_HEIGHT_M;
    const r = coreR * (0.35 + 2.8 * v ** 2.2);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const k = i * (seg + 1) + j;
      pos[k * 3] = Math.cos(a) * r;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = Math.sin(a) * r;
      uv[k * 2] = j / seg;
      uv[k * 2 + 1] = v;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Trichter pendelt leicht
        p.x += sin(uTime * 0.7 + uv.y * 3.0) * uv.y * 25.0;
        p.z += cos(uTime * 0.5 + uv.y * 2.0) * uv.y * 18.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        // Streifen drehen sich um die Achse (u = Winkel)
        vec2 q = vec2(vUv.x * 12.0 + uTime * (2.5 - vUv.y), vUv.y * 6.0 - uTime * 0.6);
        float n = noise(q) * 0.6 + noise(q * 2.7) * 0.4;
        float a = (0.35 + 0.5 * n) * smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        vec3 col = mix(vec3(0.36, 0.33, 0.3), vec3(0.62, 0.6, 0.58), n);
        gl_FragColor = vec4(col, a * uFade);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geo, material);
  mesh.name = 'tornado';
  mesh.renderOrder = 3;
  return mesh;
}

export interface TornadoOptions {
  ef: number;
  coreR: number;
  durationS: number;
  /** Ziel (Pfad-Modus) oder null (zufällig). */
  end: Vector3 | null;
}

/** Laufender Tornado; `stop()` lässt ihn auslaufen. */
export interface TornadoHandle {
  readonly position: Vector3;
  stop(): void;
  readonly done: boolean;
}

const _air = new Vector3();
const _acc = new Vector3();
const _near: SimBody[] = [];
const _dir = new Vector3();
const _imp = { x: 0, y: 0, z: 0 };

/** Angriffsfläche eines Körpers (m²) aus Skalierung bzw. Volumen. */
function areaOf(b: SimBody): number {
  if (b.pool) return Math.max(0.05, Math.max(b.scale.x, b.scale.z) * b.scale.y);
  return Math.max(0.2, Math.cbrt(b.volume) ** 2);
}

/** Tornado an `start` (Blasen-Frame) starten. */
export function spawnTornado(ctx: ToolContext, start: Vector3, o: TornadoOptions): TornadoHandle {
  const physics = ctx.physics;
  const frame = physics.frame;
  const vmax = EF_SPEEDS[Math.min(5, Math.max(0, Math.round(o.ef)))]!;
  const funnel = createFunnel(o.coreR);
  const pos = start.clone();
  pos.y = physics.groundY(pos.x, pos.z);
  funnel.position.copy(pos);
  physics.group.add(funnel);
  const effects = ctx.effects;
  let heading = o.end ? Math.atan2(o.end.x - pos.x, o.end.z - pos.z) : ctx.rng.next() * Math.PI * 2;
  let time = 0;
  let damageAcc = 0;
  let dustAcc = 0;
  let stopping = false;
  let fade = 0;
  let done = false;
  const reach = Math.max(250, o.coreR * 6);

  const handle: TornadoHandle = {
    position: pos,
    stop: () => (stopping = true),
    get done() {
      return done;
    },
  };

  const finish = (): boolean => {
    funnel.removeFromParent();
    funnel.geometry.dispose();
    funnel.material.dispose();
    done = true;
    return true;
  };

  ctx.addTask((dt) => {
    if (physics.frame !== frame) return finish();
    time += dt;
    if (time > o.durationS) stopping = true;
    fade = stopping ? fade - dt / 3 : Math.min(1, fade + dt / 2);
    if (stopping && fade <= 0) return finish();
    const strength = Math.max(0, fade);

    // Zug über das Gelände: zufällig mit sanften Richtungswechseln, oder zum Ziel
    if (o.end) {
      const dx = o.end.x - pos.x;
      const dz = o.end.z - pos.z;
      if (Math.hypot(dx, dz) < 8) stopping = true;
      else heading = Math.atan2(dx, dz);
    } else {
      heading += (ctx.rng.next() - 0.5) * 0.8 * dt;
      // Am Rand der Blase zur Mitte zurückdrehen
      const r = Math.hypot(pos.x, pos.z);
      if (r > physics.radius * 0.8) {
        const back = Math.atan2(-pos.x, -pos.z);
        const diff = Math.atan2(Math.sin(back - heading), Math.cos(back - heading));
        heading += Math.sign(diff) * Math.min(Math.abs(diff), 1.2 * dt);
      }
    }
    pos.x += Math.sin(heading) * TORNADO_SPEED_MS * dt;
    pos.z += Math.cos(heading) * TORNADO_SPEED_MS * dt;
    pos.y = physics.groundY(pos.x, pos.z);
    funnel.position.copy(pos);
    funnel.material.uniforms.uTime!.value = time;
    funnel.material.uniforms.uFade!.value = strength;
    const v = vmax * strength;

    // Kraftfeld auf alle beweglichen Körper (auch losgerissene Bruchstücke)
    for (const b of physics.bodiesNear(pos, reach, _near)) {
      const rb = b.rb;
      if (!rb || b.pinned) continue;
      const dx = b.pos.x - pos.x;
      const dz = b.pos.z - pos.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      vortexWind(dx, b.pos.y - pos.y, dz, o.coreR, v, _air);
      if (b.frozen) {
        if (_air.lengthSq() < 15 * 15) continue;
        physics.unfreeze(b);
      }
      const mass = rb.mass();
      windAccel(_air, rb.linvel(), areaOf(b), mass, _acc);
      _imp.x = _acc.x * mass * dt;
      _imp.y = _acc.y * mass * dt;
      _imp.z = _acc.z * mass * dt;
      rb.applyImpulse(_imp, true);
    }

    // Gebäude: Bruchstücke reißen ab, wo der Wind stärker als ihr Halt ist
    damageAcc += dt;
    if (damageAcc >= DAMAGE_EVERY_S && v > 30) {
      damageAcc = 0;
      ctx.destruction?.damage(
        pos,
        reach,
        {
          building: (bd) => {
            const edge = Math.max(1, bd.dist - Math.sqrt(bd.areaM2) * 0.35);
            return vortexWind(edge, 5, 0, o.coreR, v, _air).length() >= breakSpeed(1);
          },
          fragment: (p, rel, dv) => {
            vortexWind(p.x - pos.x, p.y - pos.y, p.z - pos.z, o.coreR, v, _air);
            if (_air.length() < breakSpeed(rel)) return false;
            dv.copy(_air).multiplyScalar(0.25);
            dv.y = Math.max(dv.y, 3);
            return true;
          },
        },
        MAX_NEW_PER_CHECK,
      );
    }

    // Staubwirbel am Boden und Trümmer (sichtbare Drehung)
    dustAcc += dt * 40 * strength;
    while (dustAcc >= 1) {
      dustAcc -= 1;
      const a = effects.range(0, Math.PI * 2);
      const rr = o.coreR * effects.range(0.6, 1.6);
      _dir.set(Math.cos(a) * rr, 0.5, Math.sin(a) * rr).add(pos);
      // Tangential (gegen den Uhrzeiger) und nach oben
      const tx = Math.sin(a);
      const tz = -Math.cos(a);
      effects.emit('smoke', _dir, _air.set(tx * 0.9, 0.45, tz * 0.9), v * 0.35, {
        life: effects.range(2, 4),
        size0: 4,
        size1: effects.range(14, 24),
        r: 0.5,
        g: 0.45,
        b: 0.38,
        a: 0.55,
        drag: 0.4,
        rise: 6,
        floor: pos.y,
      });
      if (effects.range(0, 1) < 0.35) {
        effects.emit('smoke', _dir, _air.set(tx, 0.8, tz), v * 0.4, {
          life: effects.range(2, 5),
          size0: effects.range(0.2, 0.6),
          r: 0.15,
          g: 0.13,
          b: 0.11,
          a: 1,
          gravity: 0.5,
          drag: 0.3,
          floor: pos.y,
        });
      }
    }
    // Brausen (gedrosselt im Audio)
    const cam = physics.worldToBubble(ctx.view.position);
    ctx.audio.rumble(cam.distanceTo(pos), 0.6 + strength);
    return false;
  });
  return handle;
}

/**
 * `tornado` (Spec 8): wandert über das Gelände (zufällig oder von Klick zu Klick), Wirbel-
 * Kraftfeld aus Tangential-, Einström- und Aufwärtskomponente. Saugt Objekte und Trümmer an und
 * reißt Bruchstücke aus Gebäuden (Dach zuerst).
 */
export function createTornadoTool(): Tool {
  const tt = t.tools.tornado;
  let current: TornadoHandle | null = null;
  let pathStart: Vector3 | null = null;
  return {
    id: 'tornado',
    name: tt.name,
    tier: 4,
    icon: 'tornado',
    description: tt.description,
    needsPhysics: true,
    params: [
      {
        key: 'ef',
        label: tt.ef,
        type: 'select',
        options: EF_SPEEDS.map((s, i) => ({
          value: String(i),
          label: `EF${i} (${Math.round(s * 3.6)} km/h)`,
        })),
        default: '3',
      },
      {
        key: 'radius',
        label: tt.radius,
        type: 'number',
        min: 20,
        max: 150,
        step: 5,
        unit: 'm',
        default: 50,
      },
      {
        key: 'path',
        label: tt.path,
        type: 'select',
        options: [
          { value: 'random', label: tt.paths.random },
          { value: 'path', label: tt.paths.path },
        ],
        default: 'random',
      },
      {
        key: 'duration',
        label: tt.duration,
        type: 'number',
        min: 15,
        max: 120,
        step: 5,
        unit: 's',
        default: 60,
      },
    ],
    onDeselect() {
      pathStart = null;
    },
    onPointerDown(hit, ctx, params) {
      const p = hit.local.clone();
      const pathMode = params.path === 'path';
      if (pathMode && !pathStart) {
        pathStart = p;
        ctx.toast('info', tt.pickEnd);
        return;
      }
      const start = pathMode && pathStart ? pathStart : p;
      const end = pathMode ? p : null;
      pathStart = null;
      current?.stop();
      current = spawnTornado(ctx, start, {
        ef: Number(params.ef) || 0,
        coreR: num(params.radius, 50),
        durationS: num(params.duration, 60),
        end,
      });
      ctx.toast('info', tt.started);
    },
  };
}
