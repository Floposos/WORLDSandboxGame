import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { createBasis, type FloatingOrigin } from '../core/floatingOrigin';
import type { GeoPoint } from '../core/types';
import type { GroundService } from './ground';

export const RING_SEGMENTS = 64;
/** Nur unterhalb dieser Kamerahöhe wird der Zielkreis gezeigt. */
export const PREVIEW_MAX_CAMERA_HEIGHT_M = 50_000;
/** Kreis schwebt so weit über dem Gelände (gegen Z-Fighting, zusätzlich depthTest aus). */
const LIFT_M = 0.5;

/** Ringbreite in m: 4 % des Radius, mindestens 1 m. */
export function ringWidth(radiusM: number): number {
  return Math.max(1, radiusM * 0.04);
}

/** Punkte (Ost, Nord) in m eines Rings, abwechselnd innen/außen, für einen Dreiecksstreifen. */
export function ringOffsets(radiusM: number, segments = RING_SEGMENTS): Float64Array {
  const inner = Math.max(0, radiusM - ringWidth(radiusM));
  const out = new Float64Array((segments + 1) * 4);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.set([inner * c, inner * s, radiusM * c, radiusM * s], i * 4);
  }
  return out;
}

const _basis = createBasis();
const _q = new Vector3();
const _geo: GeoPoint = { lat: 0, lon: 0, height: 0 };

/**
 * Zielkreis-Vorschau: ein Ring mit dem Radius der Simulationsblase, auf das Gelände drapiert.
 * Liegt in der Gruppe `local` und wird bei Ursprungsverschiebungen mitgenommen.
 */
export class TargetPreview {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly positions: Float32Array;
  private radius = 0;
  private offsets: Float64Array = new Float64Array(0);

  constructor(
    parent: Object3D,
    private readonly origin: FloatingOrigin,
    private readonly ground: GroundService,
  ) {
    const vertexCount = (RING_SEGMENTS + 1) * 2;
    this.positions = new Float32Array(vertexCount * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    const index: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: 0xffc94d,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.name = 'targetPreview';
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    // Nicht von Raycasts (GlobeControls, Werkzeuge) getroffen werden
    this.mesh.raycast = () => undefined;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** Setzt den Ring um `center` (Welt) und drapiert ihn neu auf das Gelände. */
  show(center: Vector3, radiusM: number): void {
    if (radiusM !== this.radius) {
      this.radius = radiusM;
      this.offsets = ringOffsets(radiusM);
    }
    this.origin.basisAt(center, _basis);
    this.mesh.position.copy(center);
    this.mesh.quaternion.identity();
    const o = this.offsets;
    for (let i = 0; i < o.length / 2; i++) {
      const e = o[i * 2]!;
      const n = o[i * 2 + 1]!;
      _q.copy(center).addScaledVector(_basis.east, e).addScaledVector(_basis.north, n);
      // SIMPLIFIED: drapiert auf die Geländehöhe (ohne Raycast auf Gebäude), billig bei 10 Hz.
      const hit = this.ground.below(_q, 1_000, false);
      if (hit) {
        this.origin.worldToGeo(_q, _geo);
        this.origin.geoToWorld({ lat: _geo.lat, lon: _geo.lon, height: hit.height + LIFT_M }, _q);
      }
      _q.sub(center);
      this.positions.set([_q.x, _q.y, _q.z], i * 3);
    }
    const attr = this.mesh.geometry.getAttribute('position');
    attr.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
