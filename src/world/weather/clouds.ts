import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  type Vector3,
} from 'three';

/** Wolkenuntergrenze über dem Gelände unter der Kamera (m). */
export const CLOUD_BASE_AGL_M = 1_800;
/** Kantenlänge der Wolkendecke (m); sie folgt der Kamera. */
const DECK_SIZE_M = 60_000;
/** Über dieser Kamerahöhe (über Grund) wird die Decke ausgeblendet (Ansicht aus dem All). */
export const CLOUD_HIDE_AGL_M = 40_000;

/**
 * Wolkendecke (SIMPLIFIED): eine große waagerechte Ebene über der Kamera mit prozeduralem
 * Rauschen (fBm). Die Bewölkung (0…1) verschiebt die Schwelle, der Wind treibt das Muster.
 * Die Rauschkoordinaten sind am Boden verankert: Verschiebungen des Floating Origin werden
 * über `shift()` ausgeglichen.
 */
export class CloudDeck {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Summe aller Ursprungsverschiebungen (x, z) und des Windversatzes. */
  private readonly anchor = new Vector2();

  constructor() {
    const geo = new PlaneGeometry(DECK_SIZE_M, DECK_SIZE_M, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      uniforms: {
        uAnchor: { value: new Vector2() },
        uCenter: { value: new Vector2() },
        uCover: { value: 0.3 },
        uDark: { value: 0 },
        uLight: { value: new Color(1, 1, 1) },
        uSunUp: { value: 1 },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec2 uAnchor;
        uniform vec2 uCenter;
        uniform float uCover;
        uniform float uDark;
        uniform vec3 uLight;
        uniform float uSunUp;
        uniform float uOpacity;
        varying vec3 vWorld;
        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = p * 2.03 + vec2(17.1, 9.2);
            a *= 0.5;
          }
          return v;
        }
        void main() {
          // Rauschen in km, am Boden verankert (Wind und Ursprungsverschiebung in uAnchor)
          vec2 q = (vWorld.xz + uAnchor) / 2600.0;
          float n = fbm(q);
          float edge = 1.0 - uCover;
          float a = smoothstep(edge - 0.08, edge + 0.18, n + 0.25 * (uCover - 0.5));
          // Fast ganz bedeckt: geschlossene Decke
          a = max(a, smoothstep(0.85, 1.0, uCover) * 0.95);
          // Ränder der Ebene ausblenden
          float r = length(vWorld.xz - uCenter) / 30000.0;
          a *= 1.0 - smoothstep(0.55, 1.0, r);
          a *= uOpacity;
          if (a < 0.01) discard;
          // Dicke Stellen dunkler (Unterseite), Regenwolken grau
          float thick = smoothstep(edge, edge + 0.4, n);
          vec3 base = mix(vec3(0.97), vec3(0.62, 0.64, 0.68), max(thick * 0.6, uDark));
          float day = smoothstep(-0.15, 0.25, uSunUp);
          vec3 col = base * uLight * mix(0.08, 1.0, day);
          gl_FragColor = vec4(col, a * 0.92);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.name = 'clouds';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** Ursprung verschoben: Muster bleibt über dem Boden stehen. */
  shift(dx: number, dz: number): void {
    this.anchor.x += dx;
    this.anchor.y += dz;
  }

  /**
   * Pro Frame: Kamera (Welt), Höhe der Wolkenuntergrenze (Welt-y), Bewölkung, Wind (m/s) und
   * Sonnenhöhe (Skalarprodukt mit „oben“).
   */
  update(
    dt: number,
    cam: Vector3,
    baseY: number,
    cover: number,
    dark: number,
    windX: number,
    windZ: number,
    sunUp: number,
    camAgl: number,
  ): void {
    // Wind treibt die Wolken (in der Höhe etwas stärker)
    this.anchor.x -= windX * 1.5 * dt;
    this.anchor.y -= windZ * 1.5 * dt;
    const fade =
      1 - Math.min(1, Math.max(0, (camAgl - CLOUD_HIDE_AGL_M * 0.5) / (CLOUD_HIDE_AGL_M * 0.5)));
    this.mesh.visible = cover > 0.02 && fade > 0;
    if (!this.mesh.visible) return;
    this.mesh.position.set(cam.x, baseY, cam.z);
    const u = this.mesh.material.uniforms;
    (u.uAnchor!.value as Vector2).copy(this.anchor);
    (u.uCenter!.value as Vector2).set(cam.x, cam.z);
    u.uCover!.value = cover;
    u.uDark!.value = dark;
    u.uSunUp!.value = sunUp;
    u.uOpacity!.value = fade;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
