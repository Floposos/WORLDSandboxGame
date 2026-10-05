import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Precipitation as Kind } from '../../core/types';

/** Größe des Partikelvolumens um die Kamera (m): breit, hoch, tief. */
export const PRECIP_BOX = new Vector3(70, 45, 70);
/** Fallgeschwindigkeit in m/s (Regentropfen ≈ 9, Schneeflocken ≈ 1). */
export const RAIN_FALL_MS = 9;
export const SNOW_FALL_MS = 1.2;

/**
 * Regen und Schnee als Partikelvolumen um die Kamera (Spec 7.5). Die Position jedes Partikels
 * ergibt sich im Vertex-Shader aus Startversatz, Zeit und Geschwindigkeit und wird in einen
 * Würfel um die Kamera gefaltet: keine CPU-Arbeit pro Partikel und Frame.
 * SIMPLIFIED: Niederschlag fällt auch durch Dächer.
 */
export class PrecipitationVolume {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private time = 0;
  private kind: Kind = 'none';

  constructor(readonly capacity: number) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const offsets = new Float32Array(capacity * 4);
    // Feste Folge statt Math.random: gleiche Verteilung bei jedem Start
    let s = 0x2545f491;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1_000_000) / 1_000_000;
    };
    for (let i = 0; i < capacity * 4; i++) offsets[i] = rnd();
    geo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 4));
    geo.instanceCount = 0;
    const material = new ShaderMaterial({
      uniforms: {
        uCam: { value: new Vector3() },
        uBox: { value: PRECIP_BOX.clone() },
        uVel: { value: new Vector3(0, -RAIN_FALL_MS, 0) },
        uTime: { value: 0 },
        uSnow: { value: 0 },
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aOffset;
        uniform vec3 uCam;
        uniform vec3 uBox;
        uniform vec3 uVel;
        uniform float uTime;
        uniform float uSnow;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec3 vel = uVel * (0.85 + 0.3 * aOffset.w);
          vec3 p = aOffset.xyz * uBox + vel * uTime;
          // Schnee schaukelt seitlich
          p.x += uSnow * sin(uTime * 1.3 + aOffset.w * 40.0) * 0.6;
          p.z += uSnow * cos(uTime * 1.1 + aOffset.w * 30.0) * 0.6;
          vec3 lo = uCam - 0.5 * uBox;
          p = mod(p - lo, uBox) + lo;
          vec3 toCam = normalize(cameraPosition - p);
          vec3 axis;
          vec3 side;
          vec2 size;
          if (uSnow > 0.5) {
            // Flocke: zur Kamera gedrehtes Quadrat
            side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
            axis = cross(toCam, side);
            size = vec2(0.06 + 0.05 * aOffset.w);
          } else {
            // Tropfen: Strich entlang der Fallrichtung, zur Kamera gedreht
            axis = normalize(vel);
            side = normalize(cross(axis, toCam));
            size = vec2(0.012, 0.35 + 0.25 * aOffset.w);
          }
          vec3 world = p + side * position.x * size.x + axis * position.y * size.y;
          float d = length(p - uCam);
          vFade = 1.0 - smoothstep(0.55, 1.0, d / (0.5 * uBox.x));
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uSnow;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vec2 c = vUv - 0.5;
          float a;
          vec3 col;
          if (uSnow > 0.5) {
            a = 1.0 - smoothstep(0.2, 0.5, length(c));
            col = vec3(0.97);
          } else {
            a = (1.0 - smoothstep(0.0, 0.5, abs(c.x))) * smoothstep(-0.5, 0.2, c.y);
            col = vec3(0.72, 0.76, 0.82);
          }
          a *= uOpacity * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.name = 'precipitation';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  get count(): number {
    return this.mesh.visible ? this.mesh.geometry.instanceCount : 0;
  }

  /**
   * Art, Stärke (0…1) und Wind (Welt, m/s). `visible` = Kamera unter den Wolken.
   * Die Zeit läuft mit `dt` (Spielzeit: Pause friert den Regen ein).
   */
  update(
    dt: number,
    cam: Vector3,
    kind: Kind,
    intensity: number,
    windX: number,
    windZ: number,
    visible: boolean,
  ): void {
    this.time += dt;
    const n = kind === 'none' || !visible ? 0 : Math.round(this.capacity * Math.min(1, intensity));
    this.mesh.visible = n > 0;
    this.mesh.geometry.instanceCount = n;
    if (n === 0) return;
    const u = this.mesh.material.uniforms;
    const snow = kind === 'snow';
    if (kind !== this.kind) this.kind = kind;
    // Schnee folgt dem Wind fast ganz, Regen zur Hälfte (schwerer, schneller)
    const k = snow ? 0.8 : 0.5;
    (u.uVel!.value as Vector3).set(windX * k, snow ? -SNOW_FALL_MS : -RAIN_FALL_MS, windZ * k);
    (u.uCam!.value as Vector3).copy(cam);
    u.uTime!.value = this.time % 10_000;
    u.uSnow!.value = snow ? 1 : 0;
    u.uOpacity!.value = snow ? 0.9 : 0.35 + 0.25 * intensity;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
