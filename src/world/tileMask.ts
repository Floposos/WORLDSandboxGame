import {
  DataTexture,
  FloatType,
  Group,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { geodeticToEcef, LocalFrame } from '../core/geo';
import type { GeoPoint, Vec3 } from '../core/types';

/** Höchstens so viele Masken gleichzeitig (Spec 7.2). */
export const MAX_MASKS = 32;
/** Höchstens so viele Polygon-Ecken je Maske. */
export const MAX_MASK_VERTS = 64;
const TEX_W = 256;
const TEX_H = Math.ceil((MAX_MASKS * MAX_MASK_VERTS) / TEX_W);
/** Ab dieser Entfernung vom Anker werden alle Masken in einen neuen Anker umgerechnet. */
const REANCHOR_M = 20_000;

/** Maske in Geo-Koordinaten (bleibt beim Umankern erhalten). */
export interface MaskShape {
  id: number;
  kind: 'circle' | 'polygon';
  /** Kreis: Mitte; Polygon: beliebiger Punkt in der Nähe (für die Grobprüfung ungenutzt). */
  center: GeoPoint;
  radiusM: number;
  /** Polygon: lon/lat abwechselnd. */
  ring: number[] | null;
  /** Unter dieser Höhe (Ellipsoid, m) bleibt das Mesh sichtbar; −∞ für Krater. */
  minHeight: number;
}

interface LocalShape {
  cx: number;
  cz: number;
  bound: number;
  minY: number;
  /** Polygon im Anker-Frame (x, z abwechselnd) oder null für Kreise. */
  poly: Float32Array | null;
}

const PATCHED = Symbol('globebox-mask');
const _v: Vec3 = { x: 0, y: 0, z: 0 };
const _ecef: Vec3 = { x: 0, y: 0, z: 0 };
const _p = new Vector3();

/**
 * Maskierung der gestreamten Tiles (Spec 7.2, Schritt 2): Kreise (Krater) und Grundrisse
 * (zerstörte Gebäude) blenden das Tile-Mesh per Shader-Injection aus. Grundrisse nur oberhalb
 * ihrer Sockelhöhe, damit der Boden darunter sichtbar bleibt. Die Formen liegen in einem
 * eigenen ENU-Anker (Gruppe unter `globe`), Ursprungsverschiebungen berühren sie nicht.
 */
export class TileMask {
  readonly anchor = new Group();
  private frame: LocalFrame | null = null;
  private readonly shapes: MaskShape[] = [];
  private local: LocalShape[] = [];
  private nextId = 1;
  private readonly texData = new Float32Array(TEX_W * TEX_H * 4);
  private readonly texture = new DataTexture(this.texData, TEX_W, TEX_H, RGBAFormat, FloatType);
  private readonly uniforms = {
    maskCount: { value: 0 },
    maskMatrix: { value: new Matrix4() },
    maskA: { value: Array.from({ length: MAX_MASKS }, () => new Vector4()) },
    maskB: { value: Array.from({ length: MAX_MASKS }, () => new Vector4()) },
    maskVerts: { value: this.texture },
  };
  private readonly inverse = new Matrix4();

  constructor(globe: Object3D) {
    this.anchor.name = 'tile-mask-anchor';
    this.anchor.matrixAutoUpdate = false;
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    globe.add(this.anchor);
  }

  get count(): number {
    return this.shapes.length;
  }

  get all(): readonly MaskShape[] {
    return this.shapes;
  }

  addCircle(center: GeoPoint, radiusM: number): number {
    return this.push({
      id: this.nextId++,
      kind: 'circle',
      center: { ...center },
      radiusM,
      ring: null,
      minHeight: -1e9,
    });
  }

  /** Grundriss (lon/lat abwechselnd, ohne Wiederholung des ersten Punkts) ab `minHeight`. */
  addPolygon(ring: number[], minHeight: number, center: GeoPoint): number {
    const n = Math.min(MAX_MASK_VERTS, ring.length / 2);
    return this.push({
      id: this.nextId++,
      kind: 'polygon',
      center: { ...center },
      radiusM: 0,
      ring: ring.slice(0, n * 2),
      minHeight,
    });
  }

  remove(id: number): void {
    const i = this.shapes.findIndex((s) => s.id === id);
    if (i < 0) return;
    this.shapes.splice(i, 1);
    this.rebuild();
  }

  clear(): void {
    this.shapes.length = 0;
    this.rebuild();
  }

  private push(shape: MaskShape): number {
    this.shapes.push(shape);
    // SIMPLIFIED: bei Überlauf fällt die älteste Maske weg (das Mesh taucht dort wieder auf)
    if (this.shapes.length > MAX_MASKS) this.shapes.shift();
    if (!this.frame || this.distanceToAnchor(shape.center) > REANCHOR_M) {
      this.frame = new LocalFrame({ lat: shape.center.lat, lon: shape.center.lon, height: 0 });
      this.anchor.matrix.fromArray(this.frame.ecefToLocalMatrix()).invert();
      this.anchor.matrixWorldNeedsUpdate = true;
    }
    this.rebuild();
    return shape.id;
  }

  private distanceToAnchor(g: GeoPoint): number {
    if (!this.frame) return Infinity;
    this.frame.ecefToLocal(geodeticToEcef({ ...g, height: 0 }, _ecef), _v);
    return Math.hypot(_v.x, _v.z);
  }

  private toLocal(lat: number, lon: number, height: number): Vec3 {
    return this.frame!.ecefToLocal(geodeticToEcef({ lat, lon, height }, _ecef), _v);
  }

  /** Formen in den Anker-Frame umrechnen und Uniforms/Textur füllen. */
  private rebuild(): void {
    this.local = [];
    let vert = 0;
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i]!;
      const c = this.toLocal(s.center.lat, s.center.lon, s.minHeight > -1e8 ? s.minHeight : 0);
      let shape: LocalShape;
      if (s.kind === 'circle') {
        shape = { cx: c.x, cz: c.z, bound: s.radiusM, minY: -1e9, poly: null };
      } else {
        const ring = s.ring!;
        const n = ring.length / 2;
        const poly = new Float32Array(n * 2);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let minY = Infinity;
        for (let k = 0; k < n; k++) {
          const p = this.toLocal(ring[k * 2 + 1]!, ring[k * 2]!, s.minHeight);
          poly[k * 2] = p.x;
          poly[k * 2 + 1] = p.z;
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
          minY = Math.min(minY, p.y);
        }
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        shape = {
          cx,
          cz,
          bound: Math.hypot(maxX - cx, maxZ - cz) + 0.01,
          minY,
          poly,
        };
      }
      this.local.push(shape);
      const a = this.uniforms.maskA.value[i]!;
      const b = this.uniforms.maskB.value[i]!;
      a.set(shape.cx, shape.cz, shape.bound, shape.minY);
      const n = shape.poly ? shape.poly.length / 2 : 0;
      b.set(vert, n, shape.poly ? 1 : 0, 0);
      for (let k = 0; k < n; k++) {
        const t = (vert + k) * 4;
        this.texData[t] = shape.poly![k * 2]!;
        this.texData[t + 1] = shape.poly![k * 2 + 1]!;
      }
      vert += n;
    }
    this.uniforms.maskCount.value = this.shapes.length;
    this.texture.needsUpdate = true;
  }

  /** Pro Frame: Welt → Anker für den Shader. */
  update(): void {
    if (!this.frame) return;
    this.anchor.updateMatrixWorld();
    this.inverse.copy(this.anchor.matrixWorld).invert();
    this.uniforms.maskMatrix.value.copy(this.inverse);
  }

  /** Liegt ein Weltpunkt in einer Maske (für Raycasts auf das Tile-Mesh)? */
  contains(world: Vector3): boolean {
    if (!this.frame || this.local.length === 0) return false;
    this.anchor.updateMatrixWorld();
    this.inverse.copy(this.anchor.matrixWorld).invert();
    _p.copy(world).applyMatrix4(this.inverse);
    return this.local.some((s) => insideLocal(s, _p.x, _p.y, _p.z));
  }

  /** Ein Tile-Material um die Maske erweitern (idempotent, kettet vorhandene Hooks). */
  patch(material: Material): void {
    const m = material as Material & { [PATCHED]?: boolean };
    if (m[PATCHED]) return;
    m[PATCHED] = true;
    const previous = material.onBeforeCompile.bind(material);
    const previousKey = material.customProgramCacheKey.bind(material);
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          /void main\(\s*\)\s*\{/,
          (v) => `uniform mat4 maskMatrix;\nvarying vec3 vMaskPos;\n${v}`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>\nvMaskPos = (maskMatrix * modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        /void main\(\s*\)\s*\{/,
        (v) => `${MASK_GLSL}\n${v}\nif (globeboxMasked(vMaskPos)) discard;`,
      );
    };
    material.customProgramCacheKey = () => `${previousKey()}|mask`;
    material.needsUpdate = true;
  }

  /** Alle Materialien eines geladenen Tile-Modells erweitern. */
  patchObject(root: Object3D): void {
    root.traverse((o) => {
      const mat = (o as Object3D & { material?: Material | Material[] }).material;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach((x) => this.patch(x));
      else this.patch(mat);
    });
  }

  dispose(): void {
    this.anchor.removeFromParent();
    this.texture.dispose();
  }
}

function insideLocal(s: LocalShape, x: number, y: number, z: number): boolean {
  const dx = x - s.cx;
  const dz = z - s.cz;
  if (dx * dx + dz * dz > s.bound * s.bound || y < s.minY) return false;
  if (!s.poly) return true;
  return pointInPolygon(s.poly, x, z);
}

/** Gerade/ungerade-Regel auf einem flachen x/z-Array. */
export function pointInPolygon(poly: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!;
    const zi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!;
    const zj = poly[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const MASK_GLSL = /* glsl */ `
uniform int maskCount;
uniform vec4 maskA[${MAX_MASKS}];
uniform vec4 maskB[${MAX_MASKS}];
uniform sampler2D maskVerts;
varying vec3 vMaskPos;
vec2 globeboxVert(int k) {
  return texelFetch(maskVerts, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0).xy;
}
bool globeboxMasked(vec3 p) {
  for (int i = 0; i < ${MAX_MASKS}; i++) {
    if (i >= maskCount) break;
    vec4 a = maskA[i];
    vec2 d = p.xz - a.xy;
    if (dot(d, d) > a.z * a.z || p.y < a.w) continue;
    vec4 b = maskB[i];
    if (b.z < 0.5) return true;
    int start = int(b.x);
    int n = int(b.y);
    bool inside = false;
    vec2 vj = globeboxVert(start + n - 1);
    for (int k = 0; k < ${MAX_MASK_VERTS}; k++) {
      if (k >= n) break;
      vec2 vi = globeboxVert(start + k);
      if ((vi.y > p.z) != (vj.y > p.z) && p.x < (vj.x - vi.x) * (p.z - vi.y) / (vj.y - vi.y) + vi.x) {
        inside = !inside;
      }
      vj = vi;
    }
    if (inside) return true;
  }
  return false;
}
`;
