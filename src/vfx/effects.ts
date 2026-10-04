import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  PointLight,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { SPEED_OF_SOUND } from '../core/constants';
import { ParticleSystem, type ParticleSpec } from './particles';

/** Blitzlichter gleichzeitig (Pool, Spec 7.5). */
const LIGHTS = 4;
/** Schockwellen-Ringe gleichzeitig. */
const RINGS = 6;
/** Die Schockwelle läuft zur Lesbarkeit mit diesem Anteil der Schallgeschwindigkeit. */
export const SHOCK_SPEED_FACTOR = 0.5;

interface Emitter {
  until: number;
  rate: number;
  acc: number;
  spawn: () => void;
}

interface Ring {
  mesh: Mesh<RingGeometry, ShaderMaterial>;
  shell: Mesh<SphereGeometry, ShaderMaterial>;
  born: number;
  maxR: number;
  active: boolean;
}

const spec: ParticleSpec = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  life: 1,
  size0: 1,
  size1: 1,
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

/**
 * Effekte (Spec 7.5): Blitz, Feuerball, Rauchsäule, Funken, Trümmerpartikel, Staub beim
 * Einsturz, Feuer an Gebäuden und die Schockwelle als Ring. Alles im Frame der Blase.
 */
export class Effects {
  readonly group = new Group();
  readonly glow: ParticleSystem;
  readonly smoke: ParticleSystem;
  private readonly lights: { light: PointLight; born: number; peak: number; dur: number }[] = [];
  private readonly rings: Ring[] = [];
  private readonly emitters: Emitter[] = [];
  private time = 0;
  /** Bildschirmwackeln 0…1 (klingt ab). */
  shake = 0;
  random: () => number = Math.random;

  constructor(maxParticles: number) {
    this.group.name = 'vfx';
    const glowCap = Math.max(512, Math.floor(maxParticles * 0.35));
    const smokeCap = Math.max(1024, maxParticles - glowCap);
    this.glow = new ParticleSystem(glowCap, AdditiveBlending, 'vfx-glow');
    this.smoke = new ParticleSystem(smokeCap, NormalBlending, 'vfx-smoke');
    this.group.add(this.smoke.mesh, this.glow.mesh);
    for (let i = 0; i < LIGHTS; i++) {
      const light = new PointLight(0xffb060, 0, 0, 2);
      light.visible = false;
      this.group.add(light);
      this.lights.push({ light, born: -1e9, peak: 0, dur: 0.3 });
    }
    for (let i = 0; i < RINGS; i++) {
      const mesh = new Mesh(new RingGeometry(0.92, 1, 96, 1), ringMaterial());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      const shell = new Mesh(
        new SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        shellMaterial(),
      );
      shell.visible = false;
      shell.renderOrder = 4;
      this.group.add(mesh, shell);
      this.rings.push({ mesh, shell, born: -1e9, maxR: 1, active: false });
    }
  }

  /** In den Frame der Blase hängen (bei neuer Blase erneut aufrufen). */
  attach(parent: Object3D): void {
    if (this.group.parent !== parent) parent.add(this.group);
    this.clear();
  }

  get particleCount(): number {
    return this.glow.alive + this.smoke.alive;
  }

  setWind(x: number, z: number): void {
    this.smoke.setWind(x, 0, z);
    this.glow.setWind(x * 0.5, 0, z * 0.5);
  }

  private rnd(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** Zufällige Richtung auf der Kugel (oberer Halbraum bevorzugt mit `up`). */
  private dir(up: number, out: Vector3): Vector3 {
    const th = this.random() * Math.PI * 2;
    const y = this.rnd(-1 + up, 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    return out.set(Math.cos(th) * r, y, Math.sin(th) * r);
  }

  /**
   * Explosion mit `tntKg` an `pos` (Frame der Blase, Bodenhöhe `floor`). Größen skalieren mit
   * W^(1/3). Die Rauchsäule bleibt 20 bis 60 s stehen.
   */
  explosion(pos: Vector3, tntKg: number, floor: number, effectRadius: number): void {
    const s = Math.cbrt(Math.max(0.05, tntKg));
    const d = new Vector3();
    // Blitz
    this.flash(pos, 4e5 * s * s, 0.25 + 0.05 * s, s * 60);
    // Feuerball
    const fire = Math.min(400, Math.round(30 + 25 * s));
    for (let i = 0; i < fire; i++) {
      this.dir(0.2, d);
      const v = this.rnd(2, 7) * s;
      this.particle(this.glow, pos, d, v, {
        life: this.rnd(0.5, 1.1) * (0.7 + 0.08 * s),
        size0: 0.8 * s,
        size1: this.rnd(1.6, 2.6) * s,
        r: 1,
        g: this.rnd(0.45, 0.75),
        b: 0.15,
        a: 0.9,
        endTint: 0.35,
        drag: 3,
        rise: 1.5 * s,
        floor,
      });
    }
    // Funken
    const sparks = Math.min(300, Math.round(20 + 18 * s));
    for (let i = 0; i < sparks; i++) {
      this.dir(0.1, d);
      this.particle(this.glow, pos, d, this.rnd(10, 30) * Math.sqrt(s), {
        life: this.rnd(0.6, 1.8),
        size0: 0.25,
        size1: 0.08,
        r: 1,
        g: 0.8,
        b: 0.4,
        a: 1,
        endTint: 0.6,
        gravity: 1,
        drag: 0.6,
        floor,
      });
    }
    // Trümmerpartikel (dunkle Brocken, fallen ballistisch)
    const debris = Math.min(400, Math.round(25 + 25 * s));
    for (let i = 0; i < debris; i++) {
      this.dir(0.35, d);
      this.particle(this.smoke, pos, d, this.rnd(6, 22) * Math.sqrt(s), {
        life: this.rnd(2, 5),
        size0: this.rnd(0.15, 0.5),
        size1: this.rnd(0.15, 0.5),
        r: 0.16,
        g: 0.14,
        b: 0.12,
        a: 1,
        gravity: 1,
        drag: 0.2,
        floor: floor + 0.1,
      });
    }
    // Rauchwolke
    const puffs = Math.min(250, Math.round(20 + 20 * s));
    for (let i = 0; i < puffs; i++) {
      this.dir(0.3, d);
      this.particle(this.smoke, pos, d, this.rnd(1, 5) * s, {
        life: this.rnd(6, 16),
        size0: 1.5 * s,
        size1: this.rnd(4, 7) * s,
        r: 0.22,
        g: 0.2,
        b: 0.19,
        a: 0.75,
        drag: 1.2,
        rise: this.rnd(0.5, 1.5),
        wind: 0.8,
        floor,
      });
    }
    // Rauchsäule: steigt lange auf
    this.column(pos, s, this.rnd(20, 60), floor);
    // Schockwelle
    this.ring(pos, effectRadius);
  }

  /** Aufsteigende Rauchsäule an `pos` für `seconds` s (Spec 7.5: Lebensdauer 20–60 s). */
  column(pos: Vector3, s: number, seconds: number, floor: number): void {
    const p = pos.clone();
    const d = new Vector3();
    this.emitters.push({
      until: this.time + seconds,
      rate: Math.min(40, 6 + 3 * s),
      acc: 0,
      spawn: () => {
        d.set(this.rnd(-0.3, 0.3), 1, this.rnd(-0.3, 0.3));
        this.particle(this.smoke, p, d, this.rnd(2, 4) * Math.sqrt(s), {
          life: this.rnd(12, 24),
          size0: 1.2 * s,
          size1: this.rnd(5, 9) * s,
          r: 0.18,
          g: 0.17,
          b: 0.16,
          a: 0.55,
          drag: 0.15,
          rise: this.rnd(1.5, 3),
          wind: 1,
          floor,
        });
      },
    });
  }

  /** Feuer an einem getroffenen Gebäude (lokaler Emitter, erlischt nach `seconds`). */
  fire(pos: Vector3, seconds: number, size = 1): void {
    const p = pos.clone();
    const d = new Vector3();
    this.emitters.push({
      until: this.time + seconds,
      rate: 14 * size,
      acc: 0,
      spawn: () => {
        d.set(this.rnd(-0.4, 0.4), 1, this.rnd(-0.4, 0.4));
        this.particle(this.glow, p, d, this.rnd(0.5, 1.5), {
          life: this.rnd(0.5, 1),
          size0: 1.2 * size,
          size1: 0.4 * size,
          r: 1,
          g: this.rnd(0.4, 0.6),
          b: 0.1,
          a: 0.8,
          endTint: 0.4,
          rise: 2,
          drag: 0.5,
          wind: 0.4,
        });
        if (this.random() < 0.35) {
          this.particle(this.smoke, p, d, this.rnd(1, 2), {
            life: this.rnd(6, 12),
            size0: 1.5 * size,
            size1: 6 * size,
            r: 0.15,
            g: 0.14,
            b: 0.13,
            a: 0.5,
            rise: 2.5,
            drag: 0.3,
            wind: 1,
          });
        }
      },
    });
  }

  /** Staubwolke, wenn ein Bruchstück losbricht oder aufschlägt (Spec 7.2, Schritt 6). */
  dust(pos: Vector3, amount: number, floor: number): void {
    const n = Math.min(24, Math.max(2, Math.round(amount)));
    const d = new Vector3();
    for (let i = 0; i < n; i++) {
      this.dir(0.6, d);
      this.particle(this.smoke, pos, d, this.rnd(0.5, 3), {
        life: this.rnd(5, 12),
        size0: 2,
        size1: this.rnd(6, 10),
        r: 0.55,
        g: 0.5,
        b: 0.44,
        a: 0.45,
        drag: 0.8,
        rise: 0.4,
        wind: 0.9,
        floor,
      });
    }
  }

  /** Raucher Schweif (Rakete): ein Puff an `pos`. */
  trail(pos: Vector3): void {
    const d = new Vector3(0, 1, 0);
    this.particle(this.smoke, pos, d, 0.3, {
      life: this.rnd(2, 4),
      size0: 0.5,
      size1: 2.5,
      r: 0.7,
      g: 0.7,
      b: 0.7,
      a: 0.5,
      drag: 1,
      rise: 0.3,
      wind: 0.8,
    });
    this.particle(this.glow, pos, d, 0, {
      life: 0.15,
      size0: 0.9,
      size1: 0.3,
      r: 1,
      g: 0.7,
      b: 0.3,
      a: 1,
    });
  }

  private particle(
    sys: ParticleSystem,
    pos: Vector3,
    dir: Vector3,
    speed: number,
    o: Partial<ParticleSpec>,
  ): void {
    spec.x = pos.x;
    spec.y = pos.y;
    spec.z = pos.z;
    spec.vx = dir.x * speed;
    spec.vy = dir.y * speed;
    spec.vz = dir.z * speed;
    spec.life = o.life ?? 1;
    spec.size0 = o.size0 ?? 1;
    spec.size1 = o.size1 ?? spec.size0;
    spec.r = o.r ?? 1;
    spec.g = o.g ?? 1;
    spec.b = o.b ?? 1;
    spec.a = o.a ?? 1;
    spec.endTint = o.endTint ?? 1;
    spec.gravity = o.gravity ?? 0;
    spec.rise = o.rise ?? 0;
    spec.drag = o.drag ?? 0;
    spec.wind = o.wind ?? 0;
    spec.floor = o.floor ?? -1e9;
    sys.emit(spec);
  }

  /** Kurzes Punktlicht (Blitz). */
  flash(pos: Vector3, intensity: number, duration: number, distance: number): void {
    let slot = this.lights[0]!;
    for (const l of this.lights) if (l.born < slot.born) slot = l;
    slot.light.position.copy(pos).add(new Vector3(0, 2, 0));
    slot.light.distance = distance;
    slot.born = this.time;
    slot.peak = intensity;
    slot.dur = duration;
    slot.light.visible = true;
  }

  /** Expandierender Schockwellen-Ring bis `maxR`. */
  ring(pos: Vector3, maxR: number): void {
    let slot = this.rings[0]!;
    for (const r of this.rings) if (!r.active || r.born < slot.born) slot = r;
    slot.mesh.position.copy(pos);
    slot.mesh.position.y += 0.3;
    slot.shell.position.copy(pos);
    slot.born = this.time;
    slot.maxR = Math.max(5, maxR);
    slot.active = true;
    slot.mesh.visible = true;
    slot.shell.visible = true;
  }

  /** Bildschirmwackeln anstoßen (0…1). */
  addShake(amount: number): void {
    this.shake = Math.min(1, Math.max(this.shake, amount));
  }

  /** Pro Frame mit Spielzeit-dt (Pause hält Effekte an). */
  update(dt: number): void {
    this.time += dt;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]!;
      if (this.time >= e.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        e.spawn();
      }
    }
    for (const l of this.lights) {
      if (!l.light.visible) continue;
      const t = (this.time - l.born) / l.dur;
      if (t >= 1) {
        l.light.visible = false;
        l.light.intensity = 0;
      } else {
        l.light.intensity = l.peak * (1 - t) * (1 - t);
      }
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      const age = this.time - r.born;
      const radius = SPEED_OF_SOUND * SHOCK_SPEED_FACTOR * age;
      const t = radius / r.maxR;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        r.shell.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(Math.max(0.01, radius));
      r.mesh.material.uniforms.uFade!.value = 1 - t;
      r.shell.scale.setScalar(Math.max(0.01, radius * 0.6));
      r.shell.material.uniforms.uFade!.value = Math.max(0, 1 - t * 2.5);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  clear(): void {
    this.emitters.length = 0;
    this.glow.clear();
    this.smoke.clear();
    for (const l of this.lights) l.light.visible = false;
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
      r.shell.visible = false;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.glow.dispose();
    this.smoke.dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      r.shell.geometry.dispose();
      r.shell.material.dispose();
    }
  }
}

function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float a = uFade * 0.55;
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Halbkugel-Schale mit Fresnel-Rand: die Druckfront in der Luft. */
function shellMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
        float a = rim * uFade * 0.5;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
