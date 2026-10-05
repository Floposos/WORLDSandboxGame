import {
  CircleGeometry,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { STANDARD_GRAVITY } from '../../core/constants';
import type { PhysicsWorld, SimBody } from '../../physics/world';

/** Dichte von Wasser (kg/m³). */
export const WATER_DENSITY = 1_000;
/** So schnell steigt bzw. sinkt der Wasserspiegel (m/s). */
export const FLOOD_RATE_MS = 2;
/** Größter einstellbarer Pegel über dem tiefsten Punkt der Blase (Spec 8). */
export const FLOOD_MAX_M = 50;

/**
 * Kachelbare Wellen-Normalmap (prozedural, keine Bilddatei): Summe von Sinuswellen mit ganzzahligen
 * Frequenzen, daher nahtlos. Die Normale kommt aus den analytischen Ableitungen.
 */
export function createWaterNormalMap(size = 256, seed = 7): DataTexture {
  const data = new Uint8Array(size * size * 4);
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((rnd() * 2 - 1) * (2 + i));
    const ky = Math.round((rnd() * 2 - 1) * (2 + i));
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / (1 + Math.hypot(kx, ky)), p: rnd() * Math.PI * 2 });
  }
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const ph = tau * ((w.kx * x) / size + (w.ky * y) / size) + w.p;
        const c = Math.cos(ph) * w.a * tau;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      // Normale (−dh/dx, 1, −dh/dy), Steilheit gedämpft
      const k = 0.035;
      let nx = -dx * k;
      let nz = -dy * k;
      const len = Math.hypot(nx, 1, nz);
      nx /= len;
      nz /= len;
      const ny = 1 / len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let sharedNormals: DataTexture | null = null;
const normals = (): DataTexture => (sharedNormals ??= createWaterNormalMap());

/**
 * Wasser-Shader (Spec 6.3): zwei gegeneinander laufende Lagen der Wellen-Normalmap, Fresnel
 * zwischen Wassertiefe und Himmel, Sonnenglanz. `uFoam` hellt auf (Brandung, Tsunami-Kamm).
 */
export function createWaterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uNormals: { value: normals() },
      uTime: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSky: { value: new Color(0x8db4e2) },
      uDeep: { value: new Color(0x0d3a4a) },
      uFoam: { value: 0 },
      uFlow: { value: new Vector2(0.03, 0.02) },
      uLight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vLocal;
      varying vec3 vUp;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vLocal = position;
        vUp = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNormals;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSky;
      uniform vec3 uDeep;
      uniform float uFoam;
      uniform vec2 uFlow;
      uniform float uLight;
      varying vec3 vWorld;
      varying vec3 vLocal;
      varying vec3 vUp;
      void main() {
        vec2 p = vWorld.xz;
        vec3 n1 = texture2D(uNormals, p / 38.0 + uFlow * uTime).xzy * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormals, p / 13.0 - uFlow.yx * uTime * 1.7).xzy * 2.0 - 1.0;
        vec3 tn = normalize(vec3(n1.x + n2.x, 1.0, n1.z + n2.z));
        // Tangentialraum: vUp ist die Flächennormale (Ebene: oben)
        vec3 t = normalize(cross(vUp, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
        vec3 b = normalize(cross(t, vUp));
        vec3 n = normalize(t * tn.x + vUp * tn.y + b * tn.z);
        vec3 v = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, v), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 r = reflect(-v, n);
        float sun = pow(max(dot(r, normalize(uSunDir)), 0.0), 180.0) * 3.0;
        float day = clamp(uSunDir.y * 3.0 + 0.3, 0.05, 1.0);
        vec3 col = mix(uDeep * day, uSky, fresnel) + vec3(1.0, 0.95, 0.85) * sun * day;
        col = mix(col, vec3(0.92, 0.95, 0.97) * day, clamp(uFoam, 0.0, 1.0));
        col *= uLight;
        float a = mix(0.82, 1.0, max(fresnel, uFoam));
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

const _impulse = { x: 0, y: 0, z: 0 };

/** Ungefähre halbe Höhe eines Körpers (m) für den eingetauchten Anteil. */
export function halfHeight(b: Pick<SimBody, 'pool' | 'scale' | 'volume'>): number {
  if (b.pool) return Math.max(0.05, b.scale.y * 0.5);
  return Math.max(0.1, Math.cbrt(Math.max(1e-3, b.volume)) * 0.5);
}

/** Eingetauchter Anteil 0…1 eines Körpers, dessen Mitte bei `y` liegt. */
export function submergedFraction(y: number, half: number, level: number): number {
  return Math.min(1, Math.max(0, (level - (y - half)) / (2 * half)));
}

/**
 * Auftrieb und Wasserwiderstand für alle beweglichen Körper unter dem Spiegel `level`
 * (Blasen-Frame). Leichte Körper (Holz, Bruchstücke) schwimmen, Beton sinkt. Optional zieht eine
 * Strömung (`flowX/flowZ`, m/s) die Körper mit (Tsunami).
 */
export function applyWater(
  physics: PhysicsWorld,
  level: number,
  dt: number,
  flowX = 0,
  flowZ = 0,
  flowFilter?: (b: SimBody) => boolean,
): number {
  let n = 0;
  const g = STANDARD_GRAVITY * physics.gravityScale;
  for (const b of physics.allBodies()) {
    const rb = b.rb;
    if (!rb || b.pinned) continue;
    const half = halfHeight(b);
    if (b.pos.y - half >= level) continue;
    const frac = submergedFraction(b.pos.y, half, level);
    if (frac <= 0) continue;
    if (b.frozen) physics.unfreeze(b);
    const mass = rb.mass();
    if (mass <= 0) continue;
    const v = rb.linvel();
    // Auftrieb: ρ · g · V_eingetaucht; Widerstand dämpft die Bewegung relativ zur Strömung
    const fx = flowFilter && !flowFilter(b) ? 0 : flowX;
    const fz = flowFilter && !flowFilter(b) ? 0 : flowZ;
    const lift = WATER_DENSITY * g * b.volume * frac * dt;
    const damp = Math.min(1, 1.6 * frac * dt) * mass;
    _impulse.x = (fx - v.x) * damp;
    _impulse.y = lift - v.y * damp;
    _impulse.z = (fz - v.z) * damp;
    rb.applyImpulse(_impulse, true);
    n++;
  }
  return n;
}

/**
 * Flut (Spec 6.3, Werkzeug `flood`): ein Wasserspiegel in der Blase steigt auf die Zielhöhe über
 * dem tiefsten Punkt des Geländes. SIMPLIFIED: eine runde Ebene im Blasenradius, das Gelände
 * verdeckt sie per Tiefentest („Clipping am Gelände“).
 */
export class FloodWater {
  readonly mesh: Mesh<CircleGeometry, ShaderMaterial>;
  private physics: PhysicsWorld | null = null;
  private frame: unknown = null;
  /** Tiefster Geländepunkt der Blase (Blasen-y). */
  private base = 0;
  /** Aktueller und Ziel-Pegel über `base` (m). */
  level = 0;
  target = 0;
  /** Zusätzliche Höhe über dem Pegel (Tsunami-Nachlauf), klingt über `surgeDecay` ab. */
  surge = 0;
  private time = 0;

  constructor() {
    const geo = new CircleGeometry(1, 96);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, createWaterMaterial());
    this.mesh.name = 'flood';
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Spiegelhöhe im Blasen-Frame (y). */
  get surfaceY(): number {
    return this.base + this.level + this.surge;
  }

  get baseY(): number {
    return this.base;
  }

  /** An die (neue) Blase hängen: Pegel zurück auf 0, tiefster Punkt aus dem Heightfield. */
  attach(physics: PhysicsWorld, parent: Object3D): void {
    this.physics = physics;
    this.frame = physics.frame;
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    // Neue Blase: Pegel und Ziel zurück (die Flut gehört zur Blase)
    this.level = 0;
    this.target = 0;
    this.surge = 0;
    this.base = lowestGround(physics);
    this.mesh.scale.set(physics.radius, 1, physics.radius);
  }

  setTarget(m: number): void {
    this.target = Math.min(FLOOD_MAX_M, Math.max(0, m));
  }

  /**
   * Fester Schritt: Pegel nachführen, Auftrieb anwenden. Eine neue Blase meldet der
   * ToolManager über {@link attach} (dort fällt der Pegel zurück).
   */
  step(dt: number, flowX = 0, flowZ = 0): void {
    const physics = this.physics;
    if (!physics?.frame || physics.frame !== this.frame) return;
    const d = this.target - this.level;
    this.level += Math.sign(d) * Math.min(Math.abs(d), FLOOD_RATE_MS * dt);
    this.surge = Math.max(0, this.surge - dt * 0.6);
    if (this.level + this.surge > 0.02) applyWater(physics, this.surfaceY, dt, flowX, flowZ);
  }

  /** Pro Frame (Spielzeit): Darstellung. */
  render(dt: number, sunDirWorld: Vector3, sky: Color, light: number): void {
    this.time += dt;
    const h = this.level + this.surge;
    this.mesh.visible = h > 0.02 && this.physics?.frame != null;
    if (!this.mesh.visible) return;
    this.mesh.position.y = this.surfaceY;
    const u = this.mesh.material.uniforms;
    u.uTime!.value = this.time;
    (u.uSunDir!.value as Vector3).copy(sunDirWorld);
    (u.uSky!.value as Color).copy(sky);
    u.uLight!.value = light;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Tiefster Punkt des groben Heightfields der Blase (Blasen-y), 0 ohne Gelände. */
export function lowestGround(physics: PhysicsWorld): number {
  const hf = physics.terrainData;
  if (!hf) return 0;
  // Nur innerhalb des Blasenkreises (das Raster ist quadratisch)
  let min = Infinity;
  const n = hf.n;
  const r = physics.radius;
  for (let ix = 0; ix <= n; ix++) {
    for (let iz = 0; iz <= n; iz++) {
      const x = hf.cx - hf.size / 2 + (ix / n) * hf.size;
      const z = hf.cz - hf.size / 2 + (iz / n) * hf.size;
      if (x * x + z * z > r * r) continue;
      min = Math.min(min, physics.groundY(x, z));
    }
  }
  return Number.isFinite(min) ? min : 0;
}
