import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Blending,
} from 'three';

/** Parameter eines einzelnen Partikels beim Ausstoß (alles im Frame der Gruppe). */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Lebensdauer in s. */
  life: number;
  /** Größe am Anfang und Ende in m. */
  size0: number;
  size1: number;
  /** Farbe am Anfang (linear 0…1) und Deckkraft; Ende = Anfang · `fade`. */
  r: number;
  g: number;
  b: number;
  a: number;
  /** Farbe am Ende (Multiplikator auf r/g/b, z. B. Feuer → Rauch). */
  endTint: number;
  /** Schwerkraft-Faktor (1 = Erdschwere), Auftrieb in m/s nach oben, Luftwiderstand 1/s. */
  gravity: number;
  rise: number;
  drag: number;
  /** Windeinfluss 0…1. */
  wind: number;
  /** Bodenhöhe (y), unter die das Partikel nicht fällt. */
  floor: number;
}

const FLOATS = {
  start: 3,
  vel: 3,
  time: 2, // birth, life
  size: 2,
  color: 4,
  phys: 4, // gravity, rise, drag, wind
  extra: 2, // floor, endTint
} as const;

/**
 * GPU-Partikelsystem (Spec 7.5): ein Instanced-Quad pro Partikel, Bewegung komplett im
 * Vertex-Shader aus Startwerten und Alter. Ein Ringpuffer fester Größe vermeidet Allokationen;
 * neue Partikel werden nur in den geänderten Bereich der Attribute hochgeladen.
 */
export class ParticleSystem {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly attrs: Record<keyof typeof FLOATS, InstancedBufferAttribute>;
  private next = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  private wrapped = false;
  private readonly deaths: Float32Array;
  time = 0;

  constructor(
    readonly capacity: number,
    blending: Blending,
    name: string,
  ) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const make = (n: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(35048); // DynamicDrawUsage
      return a;
    };
    this.attrs = {
      start: make(FLOATS.start),
      vel: make(FLOATS.vel),
      time: make(FLOATS.time),
      size: make(FLOATS.size),
      color: make(FLOATS.color),
      phys: make(FLOATS.phys),
      extra: make(FLOATS.extra),
    };
    // Alle Partikel starten „tot“ (Geburt weit in der Vergangenheit)
    const t = this.attrs.time.array as Float32Array;
    for (let i = 0; i < capacity; i++) {
      t[i * 2] = -1e9;
      t[i * 2 + 1] = 1;
    }
    for (const [k, a] of Object.entries(this.attrs)) geo.setAttribute(`a_${k}`, a);
    geo.instanceCount = capacity;
    this.deaths = new Float32Array(capacity).fill(-1e9);
    const additive = blending === AdditiveBlending;
    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new Vector3() },
        uGravity: { value: 9.81 },
      },
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_ADD : FRAG_SMOKE,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  /** Wind in m/s (Frame der Gruppe). */
  setWind(x: number, y: number, z: number): void {
    (this.mesh.material.uniforms.uWind!.value as Vector3).set(x, y, z);
  }

  /** Lebende Partikel (geschätzt über die Todeszeitpunkte). */
  get alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.deaths[i]! > this.time) n++;
    return n;
  }

  emit(p: ParticleSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.next === 0) this.wrapped = true;
    const a = this.attrs;
    const st = a.start.array as Float32Array;
    const ve = a.vel.array as Float32Array;
    const ti = a.time.array as Float32Array;
    const si = a.size.array as Float32Array;
    const co = a.color.array as Float32Array;
    const ph = a.phys.array as Float32Array;
    const ex = a.extra.array as Float32Array;
    st[i * 3] = p.x;
    st[i * 3 + 1] = p.y;
    st[i * 3 + 2] = p.z;
    ve[i * 3] = p.vx;
    ve[i * 3 + 1] = p.vy;
    ve[i * 3 + 2] = p.vz;
    ti[i * 2] = this.time;
    ti[i * 2 + 1] = p.life;
    si[i * 2] = p.size0;
    si[i * 2 + 1] = p.size1;
    co[i * 4] = p.r;
    co[i * 4 + 1] = p.g;
    co[i * 4 + 2] = p.b;
    co[i * 4 + 3] = p.a;
    ph[i * 4] = p.gravity;
    ph[i * 4 + 1] = p.rise;
    ph[i * 4 + 2] = p.drag;
    ph[i * 4 + 3] = p.wind;
    ex[i * 2] = p.floor;
    ex[i * 2 + 1] = p.endTint;
    this.deaths[i] = this.time + p.life;
    this.dirtyLo = Math.min(this.dirtyLo, i);
    this.dirtyHi = Math.max(this.dirtyHi, i);
  }

  /** Pro Frame: Zeit fortschreiben (Spielzeit, Pause hält an) und Änderungen hochladen. */
  update(dt: number): void {
    this.time += dt;
    this.mesh.material.uniforms.uTime!.value = this.time;
    if (this.dirtyHi < 0) return;
    for (const attr of Object.values(this.attrs)) {
      attr.clearUpdateRanges();
      if (this.wrapped) {
        // Über das Ende geschrieben: einfach alles hochladen
        attr.needsUpdate = true;
        continue;
      }
      attr.addUpdateRange(
        this.dirtyLo * attr.itemSize,
        (this.dirtyHi - this.dirtyLo + 1) * attr.itemSize,
      );
      attr.needsUpdate = true;
    }
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
    this.wrapped = false;
  }

  /** Alle Partikel sofort beenden. */
  clear(): void {
    const t = this.attrs.time.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) t[i * 2] = -1e9;
    this.deaths.fill(-1e9);
    this.attrs.time.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const VERT = /* glsl */ `
attribute vec3 a_start;
attribute vec3 a_vel;
attribute vec2 a_time;
attribute vec2 a_size;
attribute vec4 a_color;
attribute vec4 a_phys;
attribute vec2 a_extra;
uniform float uTime;
uniform vec3 uWind;
uniform float uGravity;
varying vec4 vColor;
varying vec2 vUv;
varying float vT;
void main() {
  float age = uTime - a_time.x;
  float t = age / a_time.y;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float drag = a_phys.z;
  float k = drag > 0.0001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = a_start + a_vel * k;
  p.y += a_phys.y * age - 0.5 * uGravity * a_phys.x * age * age;
  p += uWind * a_phys.w * age;
  p.y = max(p.y, a_extra.x);
  float size = mix(a_size.x, a_size.y, sqrt(t));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vec3 tint = mix(vec3(1.0), vec3(a_extra.y), smoothstep(0.0, 0.6, t));
  vColor = vec4(a_color.rgb * tint, a_color.a);
  vUv = uv;
  vT = t;
}
`;

/** Weiches, glühendes Sprite (Feuer, Funken, Blitz), additiv. */
const FRAG_ADD = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
varying float vT;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a * vColor.a * (1.0 - smoothstep(0.55, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/** Rauch und Staub: weiche Scheibe mit Rauschen, normal geblendet. */
const FRAG_SMOKE = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
varying float vT;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float n = noise(c * 5.0 + vT * 2.0) * 0.5 + noise(c * 11.0 - vT) * 0.25;
  float a = smoothstep(1.0, 0.25, d + n * 0.35);
  a *= vColor.a * smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.6, 1.0, vT));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * (0.85 + n * 0.3), a);
}
`;
