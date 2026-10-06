import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { MushroomSize } from '../../physics/nuclear';

/** So lange steigt die Wolke auf (s Simulationszeit; real dauert es Minuten, SIMPLIFIED). */
export const MUSHROOM_RISE_S = 22;
/** Danach bleibt sie stehen und verweht langsam (s). */
export const MUSHROOM_HOLD_S = 150;
export const MUSHROOM_FADE_S = 60;

/** Aufstiegs-Fortschritt 0…1 (bremst zum Ende ab). */
export function mushroomRise(ageS: number): number {
  const k = Math.min(1, Math.max(0, ageS / MUSHROOM_RISE_S));
  return 1 - (1 - k) * (1 - k);
}

/** Deckkraft über die Lebenszeit: kurz einblenden, lange halten, ausblenden. */
export function mushroomOpacity(ageS: number): number {
  const fadeIn = Math.min(1, ageS / 0.6);
  const out = 1 - Math.min(1, Math.max(0, (ageS - MUSHROOM_HOLD_S) / MUSHROOM_FADE_S));
  return fadeIn * out;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBillow;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vDensity;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    // Quellende Wolke: Versatz entlang der Normale aus rollendem Rauschen
    vec3 p = position * 3.0 + vec3(0.0, -uTime * 0.08, uTime * 0.03);
    float d = noise(p) * 0.6 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.1;
    vec3 pos = position + normal * (d - 0.45) * uBillow;
    // Feinere Ballen für die Dichte: bricht glatte Flächen auf, damit nichts wie Glas wirkt
    vDensity = noise(p * 6.0 + vec3(uTime * 0.05)) * 0.6 + d * 0.4;
    vec4 w = modelMatrix * vec4(pos, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uUp;
  uniform float uFire;
  uniform float uOpacity;
  uniform float uDark;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vDensity;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float lambert = 0.35 + 0.65 * clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    // Unten dunkler (Eigenschatten), oben vom Himmel aufgehellt
    float up = clamp(dot(n, uUp) * 0.5 + 0.5, 0.0, 1.0);
    vec3 smoke = mix(vec3(0.33, 0.29, 0.26), vec3(0.78, 0.74, 0.7), up) * lambert;
    vec3 fire = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.85, 0.5), up);
    vec3 col = mix(smoke * (1.0 - 0.5 * uDark), fire, uFire) * (0.8 + 0.4 * vDensity);
    // Weiche Ränder: am Umriss durchsichtig
    // (ohne Restdeckkraft am Umriss, sonst wirken Stiel und Kragen wie harte Röhren)
    float rim = smoothstep(0.0, 0.6, abs(dot(n, v)));
    float density = smoothstep(0.15, 0.75, vDensity);
    gl_FragColor = vec4(col, uOpacity * rim * (0.45 + 0.55 * density));
  }
`;

/**
 * Stilisierte Pilzwolke (Spec 7.5): Stiel, Hut und Kondensationsring, rein visuell. Lebt im
 * ENU-Frame des Detonationsorts (x = Ost, y = oben), daher auch aus dem All sichtbar.
 */
export class MushroomCloud {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly stem: Mesh;
  private readonly cap: Mesh;
  private readonly ring: Mesh;
  private readonly skirt: Mesh;
  age = 0;

  constructor(
    readonly size: MushroomSize,
    sunDir: Vector3,
  ) {
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBillow: { value: 0.12 },
        uSunDir: { value: sunDir },
        uUp: { value: new Vector3(0, 1, 0) },
        uFire: { value: 1 },
        uOpacity: { value: 0 },
        uDark: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = (g: BufferGeometry): Mesh => {
      const m = new Mesh(g, this.material);
      m.raycast = () => undefined;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    // Einheitsgrößen, skaliert in update()
    this.stem = mesh(new CylinderGeometry(0.55, 1, 1, 28, 10, true).translate(0, 0.5, 0));
    this.cap = mesh(new SphereGeometry(1, 40, 20));
    this.ring = mesh(new TorusGeometry(1, 0.16, 12, 48).rotateX(Math.PI / 2));
    this.skirt = mesh(new TorusGeometry(1, 0.35, 10, 40).rotateX(Math.PI / 2));
    this.group.name = 'mushroom';
    this.update(0);
  }

  /** Weltrichtung „oben“ am Detonationsort (für die Schattierung). */
  setUp(up: Vector3): void {
    (this.material.uniforms.uUp!.value as Vector3).copy(up);
  }

  /** Liefert false, sobald die Wolke verweht ist. */
  update(dt: number): boolean {
    this.age += dt;
    const { heightM: H, capRadiusM: R, stemRadiusM: S } = this.size;
    const k = mushroomRise(this.age);
    const capY = H * (0.22 + 0.58 * k);
    const capR = R * (0.25 + 0.75 * k);
    const capH = H * (0.12 + 0.14 * k);
    this.cap.scale.set(capR, capH, capR);
    this.cap.position.set(0, capY, 0);
    // Stiel reicht bis unter den Hut
    this.stem.scale.set(S * (0.6 + 0.4 * k), capY - capH * 0.4, S * (0.6 + 0.4 * k));
    // Kondensationsring um den Stiel, erscheint während des Aufstiegs
    const ringK = Math.min(1, Math.max(0, (k - 0.25) / 0.4));
    this.ring.visible = ringK > 0;
    const ringR = Math.max(1, capR * 0.75 * ringK);
    this.ring.scale.set(ringR, H * 0.12, ringR);
    this.ring.position.set(0, capY * 0.62, 0);
    // Bodenwalze (Base Surge) breitet sich aus
    const skirtR = R * (0.3 + 0.9 * k);
    this.skirt.scale.set(skirtR, H * 0.11, skirtR);
    this.skirt.position.set(0, H * 0.02, 0);
    const u = this.material.uniforms;
    u.uTime!.value = this.age;
    u.uFire!.value = Math.exp(-this.age / 3.5);
    u.uDark!.value = Math.min(1, this.age / 40);
    u.uOpacity!.value = 0.92 * mushroomOpacity(this.age);
    return this.age < MUSHROOM_HOLD_S + MUSHROOM_FADE_S;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [this.stem, this.cap, this.ring, this.skirt]) m.geometry.dispose();
    this.material.dispose();
  }
}
