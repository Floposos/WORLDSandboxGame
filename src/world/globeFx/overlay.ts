import {
  FrontSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type Object3D,
} from 'three';
import { WGS84 } from '../../core/constants';

/** Höchstens so viele Ereignisse zeichnet die Hülle gleichzeitig (älteste fallen weg). */
export const OVERLAY_EVENTS = 8;
/** Höhe der Hülle über dem Ellipsoid (m): über jedem Gebirge, aus dem All nicht zu sehen. */
export const OVERLAY_HEIGHT_M = 10_000;
/** Mittlerer Erdradius für Winkel ↔ Bogenlänge (m). */
export const EARTH_RADIUS_M = 6_371_000;

/** Bogenlänge auf der Erdoberfläche (m) → Winkel am Erdmittelpunkt (rad). */
export const arcAngle = (m: number): number => Math.min(Math.PI, Math.max(0, m) / EARTH_RADIUS_M);

/** Ein Eintrag der Hülle: alle Winkel in rad, Deckkräfte 0…1. */
export interface OverlaySlot {
  /** Geodätische Normale am Einschlagort (ECEF, normiert). */
  normal: Vector3;
  fireball: number;
  heavy: number;
  light: number;
  ringsAlpha: number;
  shock: number;
  shockAlpha: number;
  dust: number;
  dustAlpha: number;
  crater: number;
  molten: number;
  moltenAlpha: number;
  flash: number;
}

export const emptySlot = (): OverlaySlot => ({
  normal: new Vector3(0, 0, 1),
  fireball: 0,
  heavy: 0,
  light: 0,
  ringsAlpha: 0,
  shock: 0,
  shockAlpha: 0,
  dust: 0,
  dustAlpha: 0,
  crater: 0,
  molten: 0,
  moltenAlpha: 0,
  flash: 0,
});

/** Schreibt Einträge in die Uniform-Felder (vier vec4 je Ereignis); der Rest wird abgeschaltet. */
export function packSlots(
  slots: readonly OverlaySlot[],
  center: Vector4[],
  rings: Vector4[],
  shock: Vector4[],
  scar: Vector4[],
): number {
  const n = Math.min(slots.length, center.length);
  for (let i = 0; i < center.length; i++) {
    const s = i < n ? slots[slots.length - n + i]! : null;
    if (!s) {
      center[i]!.set(0, 0, 1, 0);
      continue;
    }
    center[i]!.set(s.normal.x, s.normal.y, s.normal.z, 1);
    rings[i]!.set(s.fireball, s.heavy, s.light, s.ringsAlpha);
    shock[i]!.set(s.shock, s.shockAlpha, s.dust, s.dustAlpha);
    scar[i]!.set(s.crater, s.molten, s.moltenAlpha, s.flash);
  }
  return n;
}

/** Sichtbarkeit der Hülle nach Kamerahöhe: am Boden aus, ab ≈ 150 km voll. */
export function overlayFade(cameraHeightM: number): number {
  const t = Math.min(1, Math.max(0, (cameraHeightM - 30_000) / 120_000));
  return t * t * (3 - 2 * t);
}

const vec4s = (): Vector4[] => Array.from({ length: OVERLAY_EVENTS }, () => new Vector4());

/**
 * Effekt-Hülle um den Globus (Spec 8, Stufe 5): Wirkungsringe, Druckwelle, Krater, Glut,
 * Staubschleier und Lichtblitz als Shader auf einem Ellipsoid knapp über dem Gelände. So sind
 * die Folgen auch aus dem All zu sehen. Linien bleiben mindestens 1,5 Pixel breit.
 * SIMPLIFIED: Winkel über die geodätische Normale (Kugelnäherung), keine Geländefolge.
 */
export class GlobeOverlay {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly sunDirection = new Vector3(1, 0, 0);
  private readonly center = vec4s();
  private readonly rings = vec4s();
  private readonly shock = vec4s();
  private readonly scar = vec4s();

  constructor(parent: Object3D) {
    const k = 1 + OVERLAY_HEIGHT_M / WGS84.a;
    const geometry = new SphereGeometry(WGS84.a * k, 256, 128);
    // Wie die Atmosphäre: Pol auf ECEF-z, Ellipsoid stauchen
    geometry.rotateX(Math.PI / 2);
    geometry.scale(1, 1, WGS84.b / WGS84.a);
    const material = new ShaderMaterial({
      uniforms: {
        uCenter: { value: this.center },
        uRings: { value: this.rings },
        uShock: { value: this.shock },
        uScar: { value: this.scar },
        uVeil: { value: 0 },
        uFade: { value: 1 },
        uTime: { value: 0 },
        uSunDir: { value: this.sunDirection },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vNW;
        void main() {
          // Geodätische Normale aus der ECEF-Position (Ellipsoid)
          vN = normalize(vec3(position.xy / ${(WGS84.a * WGS84.a).toExponential(6)},
                              position.z / ${(WGS84.b * WGS84.b).toExponential(6)}));
          vNW = normalize(mat3(modelMatrix) * vN);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #define N ${OVERLAY_EVENTS}
        uniform vec4 uCenter[N];
        uniform vec4 uRings[N];
        uniform vec4 uShock[N];
        uniform vec4 uScar[N];
        uniform float uVeil;
        uniform float uFade;
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vN;
        varying vec3 vNW;

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
        float fbm(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.03;
            a *= 0.5;
          }
          return v;
        }
        // Linie im Winkelabstand r, mindestens 1,5 Pixel breit
        float line(float a, float r, float w, float px) {
          float ww = max(w, px * 1.5);
          return 1.0 - smoothstep(ww * 0.5, ww, abs(a - r));
        }
        void over(inout vec4 acc, vec3 c, float a) {
          a = clamp(a, 0.0, 1.0);
          acc.rgb = mix(acc.rgb, c, a);
          acc.a = acc.a + a * (1.0 - acc.a);
        }

        void main() {
          vec3 n = normalize(vN);
          float lit = 0.18 + 0.82 * smoothstep(-0.15, 0.35, dot(normalize(vNW), uSunDir));
          vec4 acc = vec4(0.0);
          float grain = fbm(n * 900.0 + vec3(uTime * 0.01));
          // Staubschleier über der ganzen Erde
          if (uVeil > 0.0) {
            over(acc, vec3(0.36, 0.3, 0.25) * lit, uVeil * (0.75 + 0.35 * grain));
          }
          for (int i = 0; i < N; i++) {
            vec4 c = uCenter[i];
            if (c.w <= 0.0) continue;
            // Über die Sehne statt acos: genau auch für Ringe von wenigen hundert Metern
            float a = 2.0 * asin(min(1.0, length(n - c.xyz) * 0.5));
            float px = fwidth(a);
            vec4 r = uRings[i];
            vec4 s = uShock[i];
            vec4 k = uScar[i];
            // Staubdecke
            if (s.w > 0.0 && a < s.z) {
              float edge = 1.0 - smoothstep(s.z * 0.55, s.z, a + (grain - 0.5) * s.z * 0.25);
              over(acc, vec3(0.32, 0.27, 0.23) * lit, s.w * edge);
            }
            // Krater: dunkle Schüssel mit hellem Wall
            if (k.x > 0.0) {
              float bowl = 1.0 - smoothstep(k.x * 0.92, k.x, a);
              over(acc, vec3(0.16, 0.12, 0.1) * lit, 0.9 * bowl);
              over(acc, vec3(0.62, 0.5, 0.4) * lit, 0.8 * line(a, k.x, k.x * 0.12, px));
            }
            // Glut (Lava, geschmolzene Kruste)
            if (k.z > 0.0 && a < k.y) {
              float edge = 1.0 - smoothstep(k.y * 0.7, k.y, a);
              float hot = 0.55 + 0.45 * fbm(n * 400.0 + vec3(uTime * 0.05));
              over(acc, mix(vec3(0.6, 0.08, 0.02), vec3(1.0, 0.55, 0.12), hot), k.z * edge);
            }
            // Wirkungsringe: Feuerball, schwere und leichte Zerstörung
            if (r.w > 0.0) {
              over(acc, vec3(1.0, 0.85, 0.4), r.w * 0.25 * (1.0 - smoothstep(r.x * 0.98, r.x, a)));
              over(acc, vec3(1.0, 0.9, 0.55), r.w * line(a, r.x, r.x * 0.05, px));
              over(acc, vec3(0.95, 0.2, 0.15), r.w * line(a, r.y, r.y * 0.025, px));
              over(acc, vec3(1.0, 0.6, 0.15), r.w * line(a, r.z, r.z * 0.02, px));
              over(acc, vec3(0.95, 0.35, 0.15), r.w * 0.12 * (1.0 - smoothstep(r.y * 0.98, r.y, a)));
            }
            // Druckwelle
            if (s.y > 0.0) {
              over(acc, vec3(0.92, 0.95, 1.0), s.y * line(a, s.x, s.x * 0.04, px * 1.5));
            }
            // Lichtblitz: mindestens 10 Pixel groß, damit er aus dem All auffällt
            if (k.w > 0.0) {
              float rad = max(r.x * 2.0, px * 10.0);
              over(acc, vec3(1.0, 0.97, 0.9), k.w * (1.0 - smoothstep(0.0, rad, a)));
            }
          }
          acc.a *= uFade;
          if (acc.a < 0.003) discard;
          gl_FragColor = vec4(acc.rgb, acc.a);
        }
      `,
      side: FrontSide,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'globe-overlay';
    this.mesh.raycast = () => undefined;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** Einträge, Schleier und Sichtbarkeit für diesen Frame übernehmen. */
  update(slots: readonly OverlaySlot[], veil: number, fade: number, time: number): void {
    const n = packSlots(slots, this.center, this.rings, this.shock, this.scar);
    const u = this.mesh.material.uniforms;
    u.uVeil!.value = veil;
    u.uFade!.value = fade;
    u.uTime!.value = time;
    this.mesh.visible = fade > 0.001 && (n > 0 || veil > 0.001);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
